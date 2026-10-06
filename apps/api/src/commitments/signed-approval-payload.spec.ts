import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "vitest";
import type { ApprovalRecord } from "./approval-payload.js";
import { encodeBase58 } from "../wallet-auth/wallet-crypto.js";
import { ballotInput, signedBallotMessage, signedProposalHash } from "../signed-voting/signed-message.js";
import { buildSignedApprovalPayload, verifySignedApprovalPayload } from "./signed-approval-payload.js";
import { canonicalHash } from "./canonical-json.js";

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

describe("independent signed approval proof", () => {
  it("verifies a JSON export without database state", () => {
    const proof = buildSignedApprovalPayload(fixture());
    const exported = JSON.parse(JSON.stringify(proof.payload));
    assert.equal(verifySignedApprovalPayload(exported), true);
    assert.equal(canonicalHash(exported), proof.commitmentHash);
  });
  it("rejects altered terms even when the attacker recomputes the outer hash", () => {
    const p = buildSignedApprovalPayload(fixture()).payload;
    p.serviceVersion.monthlyAmountMinor++;
    p.serviceVersion.contentHash = "a".repeat(64);
    assert.equal(verifySignedApprovalPayload(p), false);
  });
  it("rejects replaced wallet/signature and changed message bytes", () => {
    const original = buildSignedApprovalPayload(fixture()).payload;
    for (const change of [
      (p: typeof original) => { p.ballots[0]!.signatureBase64 = Buffer.alloc(64).toString("base64"); },
      (p: typeof original) => { p.ballots[0]!.signedMessage += "\n"; },
      (p: typeof original) => { p.ballots[0]!.residentId = "r2"; },
      (p: typeof original) => { p.ballots[0]!.choice = "REJECT"; },
    ]) { const p = structuredClone(original); change(p); assert.equal(verifySignedApprovalPayload(p), false); }
  });
  it("rejects duplicate units and insufficient approval", () => {
    const original = buildSignedApprovalPayload(fixture()).payload;
    const duplicated = structuredClone(original); duplicated.ballots.push({ ...duplicated.ballots[0]!, id: "duplicate" });
    assert.equal(verifySignedApprovalPayload(duplicated), false);
    const empty = structuredClone(original); empty.ballots = [];
    assert.equal(verifySignedApprovalPayload(empty), false);
  });
  it("binds identity, chain, domain, policy and computed result", () => {
    const original = buildSignedApprovalPayload(fixture()).payload;
    for (const change of [
      (p: typeof original) => { p.buildingId = "b2"; },
      (p: typeof original) => { p.proposal.id = "p2"; },
      (p: typeof original) => { p.chain.network = "solana:mainnet"; },
      (p: typeof original) => { p.domain = "unsigned"; },
      (p: typeof original) => { p.governance.quorumBps = 5000; },
      (p: typeof original) => { p.result.approvalWeightBps = 1; },
    ]) { const p = structuredClone(original); change(p); assert.equal(verifySignedApprovalPayload(p), false); }
  });
  it("rejects malformed JSON structures and unknown fields", () => {
    for (const p of [null, [], {}, { domain: "x" }]) assert.equal(verifySignedApprovalPayload(p), false);
    const p = { ...buildSignedApprovalPayload(fixture()).payload, unexpected: true };
    assert.equal(verifySignedApprovalPayload(p), false);
  });
  it("is independent of activation and current wallet registry", () => {
    const source = fixture(); const before = buildSignedApprovalPayload(source);
    source.proposedVersion.active = false; source.proposedVersion.contentHash = before.serviceVersionHash;
    source.updatedAt = new Date("2030-01-01T00:00:00Z");
    assert.equal(buildSignedApprovalPayload(source).commitmentHash, before.commitmentHash);
  });
  it("rejects unsigned source and missing signature evidence", () => {
    const source = fixture(); source.votes[0]!.signatureBase64 = null;
    assert.throws(() => buildSignedApprovalPayload(source), /ballot evidence/);
    source.authorizationMode = "UNSIGNED_DEMO";
    assert.throws(() => buildSignedApprovalPayload(source), /content\/hash mismatch/);
  });
});
