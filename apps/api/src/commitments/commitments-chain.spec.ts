import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, it, vi } from "vitest";
import type { ApprovalRecord } from "./approval-payload.js";
import type { Commitment } from "../generated/prisma/client.js";
import { buildSignedApprovalPayload } from "./signed-approval-payload.js";
import { encodeBase58 } from "../wallet-auth/wallet-crypto.js";
import { ballotInput, signedBallotMessage, signedProposalHash } from "../signed-voting/signed-message.js";
import { CANONICALIZATION } from "./canonical-json.js";
import { CommitmentsService } from "./commitments.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { verifyOnChain } from "../solana/devnet-rpc.js";

vi.mock("../solana/devnet-rpc.js", () => ({ verifyOnChain: vi.fn() }));
vi.mock("../prisma/prisma.service.js", () => ({ PrismaService: class {} }));

function fixture(): ApprovalRecord {
  const keys = generateKeyPairSync("ed25519");
  const walletAddress = encodeBase58(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const source = {
    id: "p1", buildingId: "b1", serviceId: "s1", proposedVersionId: "v2", baseVersionId: "v1",
    title: "Cleaning", description: null, createdByResidentId: "r1", status: "APPROVED",
    authorizationMode: "WALLET_SIGNED", signingHash: null, requiredApprovals: 0,
    createdAt: new Date("2026-10-06T22:00:00.000Z"), updatedAt: new Date(),
    governanceSnapshot: { schemaVersion: 1, denominator: "TOTAL_ELIGIBLE_WEIGHT", totalVotingWeightBps: 10000,
      quorumBps: 6000, governanceThresholdBps: 6000, eligibleUnits: [{ unitId: "u1", votingWeightBps: 10000,
        members: [{ membershipId: "m1", residentId: "r1", walletAddress }] }] },
    proposedVersion: { id: "v2", serviceId: "s1", version: 2, title: "Cleaning v2", description: null,
      monthlyAmountMinor: 11000, currency: "GEL", billingPeriod: "MONTHLY", effectiveFrom: null,
      configJson: { weekly: true }, active: true, createdAt: new Date(), contentHash: null },
    votes: [],
  } as unknown as ApprovalRecord;
  source.signingHash = signedProposalHash(source);
  const message = signedBallotMessage(ballotInput(source, "m1", "APPROVE"));
  source.votes.push({ id: "vote1", proposalId: "p1", unitId: "u1", unitResidentId: "m1", residentId: "r1",
    choice: "APPROVE", votingWeightBps: 10000, walletAddress, signedMessage: message,
    signatureBase64: sign(null, Buffer.from(message), keys.privateKey).toString("base64"), createdAt: new Date() });
  return source;
}

function serviceFixture(status: "PENDING" | "CONFIRMED") {
  const source = fixture(); const proof = buildSignedApprovalPayload(source);
  source.proposedVersion.contentHash = proof.serviceVersionHash;
  const record = { id: "c1", buildingId: source.buildingId, proposalId: source.id, kind: "PROPOSAL", status,
    commitmentHash: proof.commitmentHash, solanaSignature: "untrusted-db-signature", solanaSlot: 999n, createdAt: new Date(),
    metadata: { canonicalization: CANONICALIZATION, authorizationMode: "WALLET_SIGNED", payload: proof.payload } } as unknown as Commitment;
  const prisma = { commitment: { findFirst: vi.fn().mockResolvedValue(record) }, proposal: { findFirst: vi.fn().mockResolvedValue(source) } };
  return { service: new CommitmentsService(prisma as unknown as PrismaService), source, record, proof };
}

describe("API derives chain verdict from live account verification", () => {
  beforeEach(() => vi.mocked(verifyOnChain).mockReset());
  it("does not trust CONFIRMED DB status or a stored signature", async () => {
    const { service } = serviceFixture("CONFIRMED");
    vi.mocked(verifyOnChain).mockResolvedValue({ verified: false, reason: "NOT_ANCHORED", network: "solana:devnet", programId: "p", authority: "a" });
    const result = await service.findOne("b1", "c1");
    assert.equal(result.status, "CONFIRMED"); assert.equal(result.onChainVerified, false);
  });
  it("can verify an anchored account while DB reconciliation is still pending", async () => {
    const { service } = serviceFixture("PENDING");
    vi.mocked(verifyOnChain).mockResolvedValue({ verified: true, reason: "VERIFIED", network: "solana:devnet", programId: "p", authority: "a" });
    const result = await service.findOne("b1", "c1");
    assert.equal(result.status, "PENDING"); assert.equal(result.onChainVerified, true);
  });
  it("keeps source checks separate from chain account checks", async () => {
    const { service, source } = serviceFixture("CONFIRMED"); source.proposedVersion.monthlyAmountMinor++;
    vi.mocked(verifyOnChain).mockResolvedValue({ verified: true, reason: "VERIFIED", network: "solana:devnet", programId: "p", authority: "a" });
    const result = await service.verification("b1", "c1");
    assert.equal(result.sourceMatches, false); assert.equal(result.authorizationVerified, true); assert.equal(result.onChainVerified, true);
  });
  it("checks supplied payload rather than substituting stored valid proof", async () => {
    const { service, proof } = serviceFixture("CONFIRMED");
    const supplied = structuredClone(proof.payload); supplied.serviceVersion.monthlyAmountMinor++;
    vi.mocked(verifyOnChain).mockResolvedValue({ verified: false, reason: "UNSUPPORTED_PROOF", network: "solana:devnet", programId: "p", authority: "a" });
    const result = await service.verifyPayload("b1", "c1", supplied);
    assert.equal(result.integrityVerified, false); assert.equal(result.authorizationVerified, false); assert.equal(result.onChainVerified, false);
    assert.deepEqual(vi.mocked(verifyOnChain).mock.calls[0], [supplied, proof.commitmentHash]);
  });
});
