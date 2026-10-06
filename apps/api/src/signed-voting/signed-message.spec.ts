import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeBase58 } from "../wallet-auth/wallet-crypto.js";
import {
  ballotInput, signedBallotMessage, signedProposalHash, verifySignedBallot, verifyStoredSignedBallot,
} from "./signed-message.js";
import type { SignedSource } from "./signed-message.js";

function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const address = encodeBase58(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const source: SignedSource = {
    id: "p1", buildingId: "b1", serviceId: "s1", baseVersionId: "v1",
    title: "Cleaning", description: null, createdByResidentId: "r1",
    authorizationMode: "WALLET_SIGNED", signingHash: null,
    governanceSnapshot: {
      schemaVersion: 1, denominator: "TOTAL_ELIGIBLE_WEIGHT", totalVotingWeightBps: 10000,
      quorumBps: 6000, governanceThresholdBps: 6000,
      eligibleUnits: [{ unitId: "u1", votingWeightBps: 10000,
        members: [{ membershipId: "m1", residentId: "r1", walletAddress: address }] }],
    },
    proposedVersion: { id: "v2", serviceId: "s1", version: 2, title: "Cleaning v2", description: null,
      monthlyAmountMinor: 11000, currency: "GEL", billingPeriod: "MONTHLY", effectiveFrom: null, configJson: { weekly: true } },
  };
  source.signingHash = signedProposalHash(source);
  const input = ballotInput(source, "m1", "APPROVE");
  const message = signedBallotMessage(input);
  const signatureBase64 = sign(null, Buffer.from(message, "utf8"), keys.privateKey).toString("base64");
  const vote = { unitId: "u1", unitResidentId: "m1", residentId: "r1", choice: "APPROVE" as const,
    votingWeightBps: 10000, walletAddress: address, signatureBase64, signedMessage: message };
  return { source, input, signatureBase64, vote };
}

describe("signed proposal and ballot domains", () => {
  it("verifies exact ballot message bytes", () => {
    const { input, signatureBase64 } = fixture();
    expect(verifySignedBallot(input, signatureBase64)).toBe(true);
  });
  it("does not reuse approval signature for rejection", () => {
    const { input, signatureBase64 } = fixture();
    expect(verifySignedBallot({ ...input, choice: "REJECT" }, signatureBase64)).toBe(false);
  });
  it("binds proposal identity, hash, unit and building", () => {
    const { input, signatureBase64 } = fixture();
    for (const changed of [
      { ...input, proposalId: "p2" }, { ...input, proposalHash: "f".repeat(64) },
      { ...input, unitId: "u2" }, { ...input, buildingId: "b2" },
    ]) expect(verifySignedBallot(changed, signatureBase64)).toBe(false);
  });
  it("refuses changed proposal terms under an old signing hash", () => {
    const { source } = fixture();
    source.proposedVersion.monthlyAmountMinor++;
    expect(() => ballotInput(source, "m1", "APPROVE")).toThrow("signing hash");
  });
  it("requires enrolled frozen wallets", () => {
    const { source } = fixture();
    const snapshot = source.governanceSnapshot as { eligibleUnits: { members: { walletAddress?: string }[] }[] };
    delete snapshot.eligibleUnits[0]!.members[0]!.walletAddress;
    expect(() => signedProposalHash(source)).toThrow("wallets must be enrolled");
  });
  it("checks stored signer identity, weight and exact message", () => {
    const { source, vote } = fixture();
    expect(verifyStoredSignedBallot(source, vote)).toBe(true);
    expect(verifyStoredSignedBallot(source, { ...vote, residentId: "r2" })).toBe(false);
    expect(verifyStoredSignedBallot(source, { ...vote, votingWeightBps: 9999 })).toBe(false);
    expect(verifyStoredSignedBallot(source, { ...vote, signedMessage: vote.signedMessage + "\n" })).toBe(false);
  });
  it("does not relabel an unsigned proposal as signed", () => {
    const { source } = fixture(); source.authorizationMode = "UNSIGNED_DEMO";
    expect(() => ballotInput(source, "m1", "APPROVE")).toThrow("not wallet-signed");
  });
  it("rejects unknown memberships", () => {
    const { source } = fixture();
    expect(() => ballotInput(source, "m2", "APPROVE")).toThrow("electorate");
  });
});
