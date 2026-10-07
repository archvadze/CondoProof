import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "vitest";
import type { ApprovalRecord } from "../commitments/approval-payload.js";
import { buildSignedApprovalPayload } from "../commitments/signed-approval-payload.js";
import { encodeBase58 } from "../wallet-auth/wallet-crypto.js";
import { ballotInput, signedBallotMessage, signedProposalHash } from "../signed-voting/signed-message.js";
import {
  PROGRAM_ID, PROGRAM_LOADER, BUILDING_AUTHORITY, DEVNET_GENESIS, BUILDING_TAG, COMMITMENT_TAG,
  proofContext, validateChainAccounts, verifyWithReader,
} from "./chain-proof.js";
import type { ChainAccount, ChainReader } from "./chain-proof.js";

function fixture(): ApprovalRecord {
  const keys = generateKeyPairSync("ed25519");
  const walletAddress = encodeBase58(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  const source = {
    id: "p1", buildingId: "62871254-7b28-48c9-b333-3531e14edc9f", serviceId: "s1", proposedVersionId: "v2", baseVersionId: "v1",
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

function chainFixture() {
  const proof = buildSignedApprovalPayload(fixture());
  const context = proofContext(proof.payload, proof.commitmentHash);
  const buildingData = Buffer.concat([BUILDING_TAG, context.authority.toBuffer(), context.buildingHash, Buffer.from([context.buildingBump])]);
  const slot = Buffer.alloc(8); slot.writeBigUInt64LE(100n);
  const commitmentData = Buffer.concat([COMMITMENT_TAG, Buffer.from([1]), context.building.toBuffer(), context.proposalHash,
    context.commitmentHash, context.serviceVersionHash, slot, Buffer.from([context.commitmentBump])]);
  const accounts: (ChainAccount | null)[] = [
    { owner: PROGRAM_LOADER, executable: true, data: Buffer.alloc(36) },
    { owner: PROGRAM_ID, executable: false, data: buildingData },
    { owner: PROGRAM_ID, executable: false, data: commitmentData },
  ];
  const response = { slot: 110, accounts };
  const reader: ChainReader = { genesis: async () => DEVNET_GENESIS, accounts: async addresses => {
    assert.deepEqual(addresses, [PROGRAM_ID, context.building.toBase58(), context.commitment.toBase58()]);
    return response;
  } };
  return { proof, context, response, reader };
}

describe("finalized Devnet proof verification", () => {
  it("verifies owner, authority, complete digest linkage and serialized slot", async () => {
    const { proof, reader } = chainFixture();
    const verified = await verifyWithReader(proof.payload, proof.commitmentHash, reader);
    assert.equal(verified.verified, true); assert.equal(verified.recordedSlot, "100");
    assert.equal(verified.authority, BUILDING_AUTHORITY);
  });
  it("binds PDA namespace to the configured authority and immutable proposal", () => {
    const { proof, context } = chainFixture();
    assert.equal(context.building.toBase58(), proofContext(proof.payload, proof.commitmentHash).building.toBase58());
    assert.notEqual(context.building.toBase58(), context.commitment.toBase58());
    assert.throws(() => proofContext(proof.payload, "0".repeat(64)));
  });
  for (const [name, accountIndex, offset] of [
    ["building discriminator", 1, 0], ["building authority", 1, 8], ["building digest", 1, 40], ["building bump", 1, 72],
    ["commitment discriminator", 2, 0], ["schema version", 2, 8], ["building linkage", 2, 9], ["proposal digest", 2, 41],
    ["commitment digest", 2, 73], ["service version digest", 2, 105], ["commitment bump", 2, 145],
  ] as const) it(`rejects modified ${name}`, () => {
    const { context, response } = chainFixture(); response.accounts[accountIndex]!.data[offset]! ^= 1;
    assert.equal(validateChainAccounts(context, response).reason, "INVALID_ACCOUNTS");
  });
  it("rejects forged owner, executable flag, size and unrecognized program loader", () => {
    for (const index of [0, 1, 2]) {
      const { context, response } = chainFixture(); response.accounts[index]!.owner = "11111111111111111111111111111111";
      assert.equal(validateChainAccounts(context, response).verified, false);
    }
    for (const index of [1, 2]) {
      const { context, response } = chainFixture(); response.accounts[index]!.executable = true;
      assert.equal(validateChainAccounts(context, response).verified, false);
      response.accounts[index]!.executable = false;
      response.accounts[index]!.data = response.accounts[index]!.data.subarray(1);
      assert.equal(validateChainAccounts(context, response).verified, false);
    }
  });
  it("rejects creation slot beyond the finalized snapshot and zero slot", () => {
    for (const slot of [0n, 111n]) {
      const { context, response } = chainFixture(); response.accounts[2]!.data.writeBigUInt64LE(slot, 137);
      assert.equal(validateChainAccounts(context, response).verified, false);
    }
  });
  it("distinguishes an absent commitment from invalid existing state", () => {
    const { context, response } = chainFixture(); response.accounts[2] = null;
    assert.equal(validateChainAccounts(context, response).reason, "NOT_ANCHORED");
    response.accounts[1] = null;
    assert.equal(validateChainAccounts(context, response).reason, "NOT_ANCHORED");
  });
  it("refuses another cluster before account reads", async () => {
    const { proof } = chainFixture();
    const reader: ChainReader = { genesis: async () => "mainnet", accounts: async () => { throw new Error("must not read"); } };
    assert.equal((await verifyWithReader(proof.payload, proof.commitmentHash, reader)).reason, "WRONG_CLUSTER");
  });
  it("RPC failure never produces a successful chain verdict", async () => {
    const { proof, reader } = chainFixture(); reader.accounts = async () => { throw new Error("RPC disconnected"); };
    assert.equal((await verifyWithReader(proof.payload, proof.commitmentHash, reader)).reason, "RPC_UNAVAILABLE");
  });
  it("invalid/unsigned proofs never query RPC", async () => {
    const reader: ChainReader = { genesis: async () => { throw new Error("must not query"); }, accounts: async () => { throw new Error("must not query"); } };
    assert.equal((await verifyWithReader({ authorizationMode: "UNSIGNED_DEMO" }, "0".repeat(64), reader)).reason, "UNSUPPORTED_PROOF");
    const { proof } = chainFixture(); proof.payload.ballots[0]!.signedMessage += "changed";
    assert.equal((await verifyWithReader(proof.payload, proof.commitmentHash, reader)).reason, "UNSUPPORTED_PROOF");
  });
});
