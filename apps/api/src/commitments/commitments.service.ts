import { verifyOnChain } from "../solana/devnet-rpc.js";
import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../generated/prisma/client.js";
import type { Commitment } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { buildSignedApprovalPayload, verifySignedApprovalPayload } from "./signed-approval-payload.js";
import { approvalInclude, buildApprovalPayload } from "./approval-payload.js";
import { CANONICALIZATION, canonicalHash, canonicalJson } from "./canonical-json.js";

@Injectable()
export class CommitmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private payload(record: Commitment): Record<string, unknown> {
    const metadata = record.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        metadata.canonicalization !== CANONICALIZATION || (metadata.authorizationMode !== "UNSIGNED_DEMO" && metadata.authorizationMode !== "WALLET_SIGNED") ||
        !metadata.payload || typeof metadata.payload !== "object" || Array.isArray(metadata.payload)) {
      throw new ConflictException("Commitment metadata is incompatible with this proof version");
    }
    const payload = metadata.payload as Record<string, unknown>;
    const proposal = payload.proposal as Record<string, unknown> | undefined;
    if (payload.authorizationMode !== metadata.authorizationMode || payload.buildingId !== record.buildingId ||
        proposal?.id !== record.proposalId) throw new ConflictException("Commitment payload identity/mode mismatch");
    return payload;
  }

  private present(record: Commitment) {
    const payload = this.payload(record);
    return {
      id: record.id,
      buildingId: record.buildingId,
      proposalId: record.proposalId,
      kind: record.kind,
      status: record.status,
      commitmentHash: record.commitmentHash,
      canonicalization: CANONICALIZATION,
      authorizationMode: payload.authorizationMode,
      authorizationVerified: canonicalHash(payload) === record.commitmentHash && verifySignedApprovalPayload(payload),
      enrollmentVerified: false,
      onChainVerified: false,
      solanaSignature: record.solanaSignature,
      solanaSlot: record.solanaSlot?.toString() ?? null,
      createdAt: record.createdAt,
      payload,
      canonicalPayload: canonicalJson(payload),
      integrityVerified: canonicalHash(payload) === record.commitmentHash,
    };
  }

  private async requireCommitment(buildingId: string, commitmentId: string) {
    const record = await this.prisma.commitment.findFirst({
      where: { id: commitmentId, buildingId, kind: "PROPOSAL" },
    });
    if (!record) throw new NotFoundException("Commitment not found in this building");
    return record;
  }

  async create(buildingId: string, proposalId: string, mode: "UNSIGNED_DEMO" | "WALLET_SIGNED" = "UNSIGNED_DEMO") {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Building" WHERE id = ${buildingId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException("Building not found");
      const proposal = await tx.proposal.findFirst({
        where: { id: proposalId, buildingId }, include: approvalInclude,
      });
      if (!proposal) throw new NotFoundException("Proposal not found in this building");
      let proof: ReturnType<typeof buildApprovalPayload>;
      try {
        if (proposal.authorizationMode !== mode) throw new Error("Proposal authorization mode does not match this endpoint");
        proof = mode === "WALLET_SIGNED" ? buildSignedApprovalPayload(proposal) : buildApprovalPayload(proposal);
      }
      catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "Cannot build approval payload");
      }
      const existingVersionHash = proposal.proposedVersion.contentHash;
      if (existingVersionHash && existingVersionHash !== proof.serviceVersionHash) {
        throw new ConflictException("Stored service version contentHash differs from its canonical content");
      }
      if (!existingVersionHash) {
        await tx.serviceVersion.update({
          where: { id: proposal.proposedVersionId }, data: { contentHash: proof.serviceVersionHash },
        });
      }
      const existing = await tx.commitment.findUnique({ where: { commitmentHash: proof.commitmentHash } });
      if (existing) {
        if (existing.buildingId !== buildingId || existing.proposalId !== proposalId || existing.kind !== "PROPOSAL" ||
            canonicalHash(this.payload(existing)) !== proof.commitmentHash) {
          throw new ConflictException("Commitment identity/metadata mismatch");
        }
        return { ...this.present(existing), reused: true };
      }
      const other = await tx.commitment.findFirst({
        where: { buildingId, proposalId, kind: "PROPOSAL" }, select: { id: true },
      });
      if (other) throw new ConflictException("Proposal already has a different commitment");

      const created = await tx.commitment.create({
        data: {
          buildingId, proposalId, kind: "PROPOSAL", status: "PENDING",
          commitmentHash: proof.commitmentHash,
          metadata: {
            schemaVersion: 1,
            canonicalization: CANONICALIZATION,
            authorizationMode: mode,
            payload: proof.payload as unknown as Prisma.InputJsonObject,
          },
        },
      });
      return { ...this.present(created), reused: false };
    }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 15000 });
  }

  async findOne(buildingId: string, commitmentId: string) {
    const record = await this.requireCommitment(buildingId, commitmentId);
    const stored = this.present(record);
    const chainVerification = await verifyOnChain(stored.payload, record.commitmentHash);
    return { ...stored, onChainVerified: chainVerification.verified, chainVerification };
  }

  async verification(buildingId: string, commitmentId: string) {
    const record = await this.requireCommitment(buildingId, commitmentId);
    const stored = this.present(record);
    const proposal = record.proposalId ? await this.prisma.proposal.findFirst({
      where: { id: record.proposalId, buildingId }, include: approvalInclude,
    }) : null;
    let sourceMatches = false;
    let versionHashMatches = false;
    if (proposal) {
      try {
        const source = proposal.authorizationMode === "WALLET_SIGNED" ? buildSignedApprovalPayload(proposal) : buildApprovalPayload(proposal);
        sourceMatches = source.commitmentHash === record.commitmentHash;
        versionHashMatches = source.serviceVersionHash === proposal.proposedVersion.contentHash;
      } catch { /* Inconsistent source records fail verification. */ }
    }
    const chainVerification = await verifyOnChain(stored.payload, record.commitmentHash);
    return {
      commitmentId: record.id,
      commitmentHash: record.commitmentHash,
      integrityVerified: stored.integrityVerified,
      sourceMatches,
      versionHashMatches,
      authorizationMode: stored.authorizationMode,
      authorizationVerified: stored.authorizationVerified,
      enrollmentVerified: false,
      onChainVerified: chainVerification.verified,
      chainVerification,
      status: record.status,
    };
  }

  async verifyPayload(buildingId: string, commitmentId: string, payload: Record<string, unknown>) {
    const record = await this.requireCommitment(buildingId, commitmentId);
    let computedHash: string;
    try { computedHash = canonicalHash(payload); }
    catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Invalid canonical payload");
    }
    const chainVerification = await verifyOnChain(payload, record.commitmentHash);
    return {
      commitmentId: record.id,
      expectedHash: record.commitmentHash,
      computedHash,
      integrityVerified: computedHash === record.commitmentHash,
      authorizationVerified: computedHash === record.commitmentHash && verifySignedApprovalPayload(payload),
      enrollmentVerified: false,
      onChainVerified: chainVerification.verified,
      chainVerification,
    };
  }
}
