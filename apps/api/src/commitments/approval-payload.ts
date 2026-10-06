import type { Prisma } from "../generated/prisma/client.js";
import { tally, validateSnapshot } from "../proposals/governance-policy.js";
import type { GovernanceSnapshot } from "../proposals/governance-policy.js";
import { canonicalHash } from "./canonical-json.js";

export const APPROVAL_DOMAIN = "condoproof/approved-service-version/unsigned-demo/v1";
export const VERSION_DOMAIN = "condoproof/service-version/v1";
const PROGRAM_ID = "3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF";

export const approvalInclude = {
  proposedVersion: true,
  votes: true,
} satisfies Prisma.ProposalInclude;
export type ApprovalRecord = Prisma.ProposalGetPayload<{ include: typeof approvalInclude }>;
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function buildApprovalPayload(proposal: ApprovalRecord) {
  if (proposal.status !== "APPROVED") throw new Error("Only approved proposals can be committed");
  if (!proposal.governanceSnapshot || !proposal.baseVersionId) throw new Error("Proposal has no frozen policy/base version");
  if (proposal.proposedVersion.serviceId !== proposal.serviceId) throw new Error("Version belongs to another service");
  const snapshot = proposal.governanceSnapshot as unknown as GovernanceSnapshot;
  validateSnapshot(snapshot);
  const result = tally(snapshot, proposal.votes);
  if (result.decision !== "APPROVED") throw new Error("Stored ballots do not satisfy the frozen approval policy");
  for (const vote of proposal.votes) {
    const unit = snapshot.eligibleUnits.find((item) => item.unitId === vote.unitId);
    if (!unit?.members.some((member) =>
      member.membershipId === vote.unitResidentId && member.residentId === vote.residentId)) {
      throw new Error("Ballot membership does not match the frozen electorate");
    }
  }

  const version = proposal.proposedVersion;
  const versionPayload = {
    domain: VERSION_DOMAIN,
    buildingId: proposal.buildingId,
    serviceId: proposal.serviceId,
    serviceVersionId: version.id,
    version: version.version,
    title: version.title,
    description: version.description,
    monthlyAmountMinor: version.monthlyAmountMinor,
    currency: version.currency,
    billingPeriod: version.billingPeriod,
    effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
    configJson: version.configJson,
  };
  const serviceVersionHash = canonicalHash(versionPayload);
  const payload = {
    domain: APPROVAL_DOMAIN,
    schemaVersion: 1,
    authorizationMode: "UNSIGNED_DEMO",
    chain: { network: "solana:devnet", programId: PROGRAM_ID },
    buildingId: proposal.buildingId,
    serviceId: proposal.serviceId,
    proposal: {
      id: proposal.id,
      title: proposal.title,
      description: proposal.description,
      createdByResidentId: proposal.createdByResidentId,
      createdAt: proposal.createdAt.toISOString(),
      baseVersionId: proposal.baseVersionId,
      status: "APPROVED",
    },
    serviceVersion: { ...versionPayload, contentHash: serviceVersionHash },
    governance: {
      schemaVersion: snapshot.schemaVersion,
      denominator: snapshot.denominator,
      totalVotingWeightBps: snapshot.totalVotingWeightBps,
      quorumBps: snapshot.quorumBps,
      governanceThresholdBps: snapshot.governanceThresholdBps,
      eligibleUnits: [...snapshot.eligibleUnits].sort((a, b) => compareIds(a.unitId, b.unitId)).map((unit) => ({
        unitId: unit.unitId,
        votingWeightBps: unit.votingWeightBps,
        members: [...unit.members].sort((a, b) => compareIds(a.membershipId, b.membershipId)),
      })),
    },
    ballots: [...proposal.votes].sort((a, b) => compareIds(a.unitId, b.unitId)).map((vote) => ({
      id: vote.id,
      unitId: vote.unitId,
      membershipId: vote.unitResidentId,
      residentId: vote.residentId,
      choice: vote.choice,
      votingWeightBps: vote.votingWeightBps,
    })),
    result: {
      decision: result.decision,
      participationWeightBps: result.participationWeightBps,
      approvalWeightBps: result.approvalWeightBps,
    },
  };
  return { payload, commitmentHash: canonicalHash(payload), serviceVersionHash };
}
