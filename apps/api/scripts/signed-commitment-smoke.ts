import "dotenv/config";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { encodeBase58 } from "../src/wallet-auth/wallet-crypto.js";
import { canonicalHash } from "../src/commitments/canonical-json.js";
import { verifySignedApprovalPayload } from "../src/commitments/signed-approval-payload.js";
import { verifyStoredSignedBallot } from "../src/signed-voting/signed-message.js";

if (process.env.NODE_ENV === "production") throw new Error("Local demo smoke check only");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const base = "http://127.0.0.1:3001";
let fixtureBuildingId: string | undefined;
const keys = Array.from({ length: 5 }, () => generateKeyPairSync("ed25519"));
const addresses = keys.map((key) => encodeBase58(key.publicKey.export({ type: "spki", format: "der" }).subarray(-32)));

async function request(method: string, path: string, body?: unknown, expected = 200, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: unexpected HTTP status`);
  return value;
}
async function login(address: string, privateKey: typeof keys[number]["privateKey"]) {
  const challenge = await request("POST", "/auth/wallet/challenge", { walletAddress: address });
  const signatureBase64 = sign(null, Buffer.from(challenge.message, "utf8"), privateKey).toString("base64");
  return (await request("POST", "/auth/wallet/verify", { challengeId: challenge.challengeId, signatureBase64 })).token as string;
}

try {
  const legacy = await prisma.commitment.findMany({ where: { kind: "PROPOSAL" }, select: { id: true, commitmentHash: true } });
  const building = await prisma.building.create({ data: { name: "Signed voting smoke fixture", governanceThresholdBps: 6000, quorumBps: 6000 } });
  fixtureBuildingId = building.id;
  const residents: { id: string; membershipId: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const resident = await prisma.resident.create({ data: { buildingId: building.id, name: `Signed smoke owner ${i + 1}`, walletAddress: addresses[i]! } });
    const unit = await prisma.unit.create({ data: { buildingId: building.id, label: String(101 + i), votingWeightBps: 2000 } });
    const membership = await prisma.unitResident.create({ data: { unitId: unit.id, residentId: resident.id, role: "OWNER" } });
    residents.push({ id: resident.id, membershipId: membership.id });
  }
  const service = await prisma.service.create({ data: { buildingId: building.id, name: "Cleaning", category: "DEMO" } });
  await prisma.serviceVersion.create({ data: { serviceId: service.id, version: 1, title: "Cleaning v1", monthlyAmountMinor: 10000, currency: "GEL", configJson: { demo: true }, active: true } });
  const tokens: string[] = [];
  for (let i = 0; i < 5; i++) tokens.push(await login(addresses[i]!, keys[i]!.privateKey));
  const root = `/buildings/${building.id}/signed-proposals`;
  const createBody = {
    serviceId: service.id, createdByMembershipId: residents[0]!.membershipId, title: "Signed Cleaning change",
    proposedVersion: { title: "Cleaning new terms", monthlyAmountMinor: 11000, currency: "GEL", billingPeriod: "MONTHLY", configJson: { demo: true, signed: true } },
  };
  await request("POST", root, createBody, 401);
  await request("POST", root, { ...createBody, createdByMembershipId: residents[1]!.membershipId }, 403, tokens[0]);
  await request("POST", "/buildings/62871254-7b28-48c9-b333-3531e14edc9f/signed-proposals", createBody, 403, tokens[0]);
  await prisma.resident.update({ where: { id: residents[4]!.id }, data: { walletAddress: null } });
  await request("POST", root, createBody, 409, tokens[0]);
  assert.equal(await prisma.serviceVersion.count({ where: { serviceId: service.id } }), 1);
  await prisma.resident.update({ where: { id: residents[4]!.id }, data: { walletAddress: addresses[4]! } });

  const proposal = await request("POST", root, createBody, 201, tokens[0]);
  await request("POST", `${root}/${proposal.id}/commitments`, undefined, 409, tokens[0]);
  assert.equal(proposal.authorizationMode, "WALLET_SIGNED");
  assert.match(proposal.signingHash, /^[0-9a-f]{64}$/);
  await request("POST", `/buildings/${building.id}/proposals/${proposal.id}/votes`,
    { membershipId: residents[0]!.membershipId, choice: "APPROVE" }, 403);

  const extraKey = generateKeyPairSync("ed25519");
  const extraAddress = encodeBase58(extraKey.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
  await prisma.resident.update({ where: { id: residents[4]!.id }, data: { walletAddress: extraAddress } });
  const changedWalletToken = await login(extraAddress, extraKey.privateKey);
  await request("POST", `${root}/${proposal.id}/ballot-message`,
    { membershipId: residents[4]!.membershipId, choice: "APPROVE" }, 403, changedWalletToken);
  await prisma.resident.update({ where: { id: residents[4]!.id }, data: { walletAddress: addresses[4]! } });

  async function signedVoteBody(proposalId: string, index: number, choice: "APPROVE" | "REJECT" | "ABSTAIN") {
    const message = await request("POST", `${root}/${proposalId}/ballot-message`,
      { membershipId: residents[index]!.membershipId, choice }, 200, tokens[index]);
    return { membershipId: residents[index]!.membershipId, choice,
      signatureBase64: sign(null, Buffer.from(message.message, "utf8"), keys[index]!.privateKey).toString("base64") };
  }
  const first = await signedVoteBody(proposal.id, 0, "APPROVE");
  await request("POST", `${root}/${proposal.id}/votes`, { ...first, choice: "REJECT" }, 403, tokens[0]);
  await request("POST", `${root}/${proposal.id}/votes`, first, 403, tokens[1]);
  let updated = await request("POST", `${root}/${proposal.id}/votes`, first, 201, tokens[0]);
  assert.equal(updated.status, "PENDING");
  await request("POST", `${root}/${proposal.id}/votes`, first, 409, tokens[0]);
  // Two valid signed approvals reach the decision boundary with the next vote.
  await request("POST", `${root}/${proposal.id}/votes`, await signedVoteBody(proposal.id, 1, "APPROVE"), 201, tokens[1]);
  const third = await signedVoteBody(proposal.id, 2, "APPROVE");
  const fourth = await signedVoteBody(proposal.id, 3, "APPROVE");
  const racing = await Promise.all([
    fetch(`${base}${root}/${proposal.id}/votes`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[2]}` }, body: JSON.stringify(third), signal: AbortSignal.timeout(25000) }),
    fetch(`${base}${root}/${proposal.id}/votes`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens[3]}` }, body: JSON.stringify(fourth), signal: AbortSignal.timeout(25000) }),
  ]);
  assert.deepEqual(racing.map((response) => response.status).sort(), [201, 409]);
  const approved = await request("GET", `${root}/${proposal.id}`, undefined, 200, tokens[0]);
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.votes.length, 3);
  assert.equal(approved.proposedVersion.active, true);
  const stored = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { proposedVersion: true, votes: true } });
  assert.ok(stored.votes.every((vote) => verifyStoredSignedBallot(stored, vote)));
  await request("POST", `/buildings/${building.id}/proposals/${proposal.id}/commitments`, undefined, 409);
  await assert.rejects(() => prisma.$executeRaw`UPDATE "Proposal" SET "signingHash" = ${"f".repeat(64)} WHERE id = ${proposal.id}::uuid`, /immutable/);
  await assert.rejects(() => prisma.$executeRaw`UPDATE "ProposalVote" SET choice = 'REJECT' WHERE id = ${stored.votes[0]!.id}::uuid`, /immutable/);

  const writePath = `${root}/${proposal.id}/commitments`;
  await request("POST", writePath, undefined, 401);
  const created = await Promise.all([
    request("POST", writePath, undefined, 200, tokens[0]),
    request("POST", writePath, undefined, 200, tokens[1]),
  ]);
  assert.equal(created[0].id, created[1].id);
  assert.deepEqual(created.map(c => c.reused).sort(), [false, true]);
  const commitment = created[0];
  assert.equal(commitment.authorizationVerified, true);
  assert.equal(commitment.enrollmentVerified, false);
  assert.equal(commitment.onChainVerified, false);
  assert.equal(commitment.status, "PENDING");
  assert.equal(commitment.solanaSignature, null);
  assert.equal(canonicalHash(commitment.payload), commitment.commitmentHash);
  assert.equal(verifySignedApprovalPayload(JSON.parse(JSON.stringify(commitment.payload))), true);
  const verifyPath = `/buildings/${building.id}/commitments/${commitment.id}`;
  const checked = await request("GET", `${verifyPath}/verification`);
  for (const field of ["integrityVerified", "sourceMatches", "versionHashMatches", "authorizationVerified"]) assert.equal(checked[field], true);
  const reordered = Object.fromEntries(Object.entries(commitment.payload).reverse());
  assert.equal((await request("POST", `${verifyPath}/verify-payload`, { payload: reordered })).authorizationVerified, true);
  const tampered = structuredClone(commitment.payload);
  tampered.ballots[0].signatureBase64 = Buffer.alloc(64).toString("base64");
  assert.equal(verifySignedApprovalPayload(tampered), false);
  const failed = await request("POST", `${verifyPath}/verify-payload`, { payload: tampered });
  assert.equal(failed.integrityVerified, false); assert.equal(failed.authorizationVerified, false);
  assert.equal(await prisma.commitment.count({ where: { proposalId: proposal.id } }), 1);
  const row = await prisma.commitment.findUniqueOrThrow({ where: { id: commitment.id } });
  assert.equal(row.solanaSlot, null); assert.equal(row.solanaSignature, null);
  assert.equal((row.metadata as { authorizationMode: string }).authorizationMode, "WALLET_SIGNED");
  // Historical consent is verified against the frozen electorate, not today's enrollment.
  await prisma.resident.update({ where: { id: residents[0]!.id }, data: { walletAddress: null } });
  const historical = await request("GET", `${verifyPath}/verification`);
  assert.equal(historical.authorizationVerified, true); assert.equal(historical.sourceMatches, true);
  await prisma.resident.update({ where: { id: residents[0]!.id }, data: { walletAddress: addresses[0]! } });

  const second = await request("POST", root, { ...createBody, title: "Second signed proposal" }, 201, tokens[0]);
  await request("POST", `${root}/${second.id}/votes`, first, 403, tokens[0]);
  let rejected;
  for (let i = 0; i < 3; i++) rejected = await request("POST", `${root}/${second.id}/votes`, await signedVoteBody(second.id, i, "REJECT"), 201, tokens[i]);
  assert.equal(rejected.status, "REJECTED");
  await request("POST", `${root}/${second.id}/commitments`, undefined, 409, tokens[0]);
  for (const old of legacy) {
    assert.equal((await prisma.commitment.findUniqueOrThrow({ where: { id: old.id } })).commitmentHash, old.commitmentHash);
  }
  console.log(JSON.stringify({ status: "ok", concurrentCreate: "one record; reused false/true",
    exportedProof: "independently verified", signaturesAndPolicy: "verified", tamperedSignature: "rejected",
    frozenEnrollmentAfterRegistryChange: "verified", sourceAndVersionHashes: "match",
    pendingOrRejected: "409", unsignedHashes: "unchanged", enrollmentVerified: false, onChainVerified: false,
    chainState: "PENDING; no transaction submitted", note: "Temporary fixture cleanup follows" }, null, 2));
} finally {
  if (fixtureBuildingId) {
    await prisma.commitment.deleteMany({ where: { buildingId: fixtureBuildingId } });
    await prisma.proposal.deleteMany({ where: { buildingId: fixtureBuildingId } });
    await prisma.building.deleteMany({ where: { id: fixtureBuildingId } });
  }
  await prisma.$disconnect();
}
