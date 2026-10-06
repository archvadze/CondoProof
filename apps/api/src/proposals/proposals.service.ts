import {
  BadRequestException, ConflictException, ForbiddenException,
  Injectable, InternalServerErrorException, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateProposalDto } from "./dto/create-proposal.dto.js";
import { CastVoteDto } from "./dto/cast-vote.dto.js";
import { tally, validateSnapshot } from "./governance-policy.js";
import type { GovernanceSnapshot } from "./governance-policy.js";

const proposalInclude = {
  proposedVersion: true,
  votes: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ProposalInclude;

type ProposalRecord = Prisma.ProposalGetPayload<{ include: typeof proposalInclude }>;

@Injectable()
export class ProposalsService {
  constructor(private readonly prisma: PrismaService) {}

  private snapshot(value: Prisma.JsonValue | null): GovernanceSnapshot {
    if (!value) throw new ConflictException("Legacy proposal has no governance snapshot");
    try {
      const snapshot = value as unknown as GovernanceSnapshot;
      validateSnapshot(snapshot);
      return snapshot;
    } catch {
      throw new InternalServerErrorException("Stored governance snapshot is invalid");
    }
  }

  private present(proposal: ProposalRecord) {
    return {
      id: proposal.id,
      buildingId: proposal.buildingId,
      serviceId: proposal.serviceId,
      baseVersionId: proposal.baseVersionId,
      status: proposal.status,
      title: proposal.title,
      description: proposal.description,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
      governanceSnapshot: proposal.governanceSnapshot,
      proposedVersion: proposal.proposedVersion,
      votes: proposal.votes,
      tally: tally(this.snapshot(proposal.governanceSnapshot), proposal.votes),
    };
  }

  private async lockBuilding(tx: Prisma.TransactionClient, buildingId: string) {
    // Every governance write takes this lock before reading proposal/service state.
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Building" WHERE id = ${buildingId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Building not found");
  }

  async findAll(buildingId: string) {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId }, select: { id: true },
    });
    if (!building) throw new NotFoundException("Building not found");
    const proposals = await this.prisma.proposal.findMany({
      where: { buildingId }, include: proposalInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 100,
    });
    return proposals.map((proposal) => this.present(proposal));
  }

  async findOne(buildingId: string, proposalId: string) {
    const proposal = await this.prisma.proposal.findFirst({
      where: { id: proposalId, buildingId }, include: proposalInclude,
    });
    if (!proposal) throw new NotFoundException("Proposal not found in this building");
    return this.present(proposal);
  }

  async create(buildingId: string, dto: CreateProposalDto) {
    // JSON size is bounded before entering the transaction.
    if (Buffer.byteLength(JSON.stringify(dto.proposedVersion.configJson), "utf8") > 32768) {
      throw new BadRequestException("configJson exceeds 32 KiB");
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockBuilding(tx, buildingId);
      const building = await tx.building.findUniqueOrThrow({
        where: { id: buildingId },
        include: {
          units: {
            orderBy: { id: "asc" },
            include: {
              unitResidents: {
                where: { role: "OWNER", resident: { buildingId } },
                orderBy: { id: "asc" },
              },
            },
          },
        },
      });

      const policy: GovernanceSnapshot = {
        schemaVersion: 1,
        denominator: "TOTAL_ELIGIBLE_WEIGHT",
        totalVotingWeightBps: 10000,
        quorumBps: building.quorumBps,
        governanceThresholdBps: building.governanceThresholdBps,
        eligibleUnits: building.units.map((unit) => ({
          unitId: unit.id, votingWeightBps: unit.votingWeightBps,
          members: unit.unitResidents.map((membership) => ({
            membershipId: membership.id, residentId: membership.residentId,
          })),
        })),
      };
      try { validateSnapshot(policy); }
      catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "Invalid building policy");
      }

      const creator = policy.eligibleUnits.flatMap((unit) => unit.members)
        .find((member) => member.membershipId === dto.createdByMembershipId);
      if (!creator) throw new ForbiddenException("Creator is not an eligible owner in this building");

      const service = await tx.service.findFirst({
        where: { id: dto.serviceId, buildingId, active: true },
        include: { versions: { orderBy: { version: "desc" } } },
      });
      if (!service) throw new NotFoundException("Active service not found in this building");
      const activeVersions = service.versions.filter((version) => version.active);
      if (activeVersions.length !== 1) {
        throw new ConflictException("Service must have exactly one active base version");
      }
      if (await tx.proposal.findFirst({
        where: { serviceId: service.id, status: "PENDING" }, select: { id: true },
      })) {
        throw new ConflictException("Service already has a pending proposal");
      }

      const version = await tx.serviceVersion.create({
        data: {
          serviceId: service.id,
          version: (service.versions[0]?.version ?? 0) + 1,
          title: dto.proposedVersion.title,
          description: dto.proposedVersion.description,
          monthlyAmountMinor: dto.proposedVersion.monthlyAmountMinor,
          currency: dto.proposedVersion.currency,
          billingPeriod: dto.proposedVersion.billingPeriod,
          configJson: dto.proposedVersion.configJson as Prisma.InputJsonObject,
          active: false,
        },
      });
      const proposal = await tx.proposal.create({
        data: {
          buildingId, serviceId: service.id, proposedVersionId: version.id,
          baseVersionId: activeVersions[0]!.id,
          createdByResidentId: creator.residentId,
          title: dto.title, description: dto.description, status: "PENDING",
          // Deprecated count rule: decision-making uses the weighted snapshot only.
          requiredApprovals: 0,
          governanceSnapshot: policy as unknown as Prisma.InputJsonObject,
        },
        include: proposalInclude,
      });
      return this.present(proposal);
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
  }

  async castVote(buildingId: string, proposalId: string, dto: CastVoteDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockBuilding(tx, buildingId);
      const proposal = await tx.proposal.findFirst({
        where: { id: proposalId, buildingId }, include: proposalInclude,
      });
      if (!proposal) throw new NotFoundException("Proposal not found in this building");
      if (proposal.status !== "PENDING") throw new ConflictException("Proposal is closed");
      const policy = this.snapshot(proposal.governanceSnapshot);
      const eligibleUnit = policy.eligibleUnits.find((unit) =>
        unit.members.some((member) => member.membershipId === dto.membershipId));
      const eligibleMember = eligibleUnit?.members.find((member) => member.membershipId === dto.membershipId);
      if (!eligibleUnit || !eligibleMember) {
        throw new ForbiddenException("Membership was not eligible when the proposal opened");
      }
      const membership = await tx.unitResident.findFirst({
        where: {
          id: dto.membershipId, unitId: eligibleUnit.unitId,
          residentId: eligibleMember.residentId, role: "OWNER",
          unit: { buildingId }, resident: { buildingId },
        }, select: { id: true },
      });
      if (!membership) throw new ForbiddenException("Owner membership is no longer valid");
      if (proposal.votes.some((vote) => vote.unitId === eligibleUnit.unitId)) {
        throw new ConflictException("This unit has already voted");
      }

      await tx.proposalVote.create({
        data: {
          proposalId, unitId: eligibleUnit.unitId, unitResidentId: membership.id,
          residentId: eligibleMember.residentId, choice: dto.choice,
          votingWeightBps: eligibleUnit.votingWeightBps,
        },
      });
      const ballots = await tx.proposalVote.findMany({ where: { proposalId } });
      const result = tally(policy, ballots);
      if (result.decision === "APPROVED") {
        const service = await tx.service.findFirst({
          where: { id: proposal.serviceId, buildingId, active: true },
          include: { versions: { where: { active: true } } },
        });
        if (!service || service.versions.length !== 1 ||
            service.versions[0]!.id !== proposal.baseVersionId ||
            proposal.proposedVersion.serviceId !== service.id ||
            proposal.proposedVersion.active) {
          throw new ConflictException("Base version changed; approval cannot be applied");
        }
        await tx.serviceVersion.update({
          where: { id: proposal.baseVersionId! }, data: { active: false },
        });
        await tx.serviceVersion.update({
          where: { id: proposal.proposedVersionId }, data: { active: true },
        });
      }
      const updated = await tx.proposal.update({
        where: { id: proposalId }, data: { status: result.decision }, include: proposalInclude,
      });
      return this.present(updated);
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
  }
}
