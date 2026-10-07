import "dotenv/config";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { encodeBase58 } from "../src/wallet-auth/wallet-crypto.js";
import { verifySignedApprovalPayload } from "../src/commitments/signed-approval-payload.js";
import { canonicalHash } from "../src/commitments/canonical-json.js";

if (process.env.NODE_ENV === "production") throw new Error("Local Devnet demo fixture only");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const NAME = "CondoProof Devnet signed proof demo";
let buildingId: string | undefined;
let keep = false;
async function request(path: string, body: unknown, expected: number, token?: string) {
  const response = await fetch(`http://127.0.0.1:3001${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `Unexpected HTTP status at ${path}`);
  return value;
}
try {
  const existing = await prisma.commitment.findFirst({ where: { kind: "PROPOSAL", building: { name: NAME } }, orderBy: { createdAt: "desc" } });
  const oldPayload = (existing?.metadata as { payload?: unknown } | null)?.payload;
  if (existing && verifySignedApprovalPayload(oldPayload) && canonicalHash(oldPayload) === existing.commitmentHash) {
    console.log(JSON.stringify({ status: "prepared", reused: true, buildingId: existing.buildingId,
      proposalId: existing.proposalId, commitmentId: existing.id, commitmentHash: existing.commitmentHash }, null, 2));
  } else {
    const keys = Array.from({ length: 5 }, () => generateKeyPairSync("ed25519"));
    const wallets = keys.map(key => encodeBase58(key.publicKey.export({ type: "spki", format: "der" }).subarray(-32)));
    const building = await prisma.building.create({ data: { name: NAME, governanceThresholdBps: 6000, quorumBps: 6000 } });
    buildingId = building.id;
    const memberships: string[] = [], tokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      const resident = await prisma.resident.create({ data: { buildingId, name: `Demo owner ${i + 1}`, walletAddress: wallets[i]! } });
      const unit = await prisma.unit.create({ data: { buildingId, label: String(101 + i), votingWeightBps: 2000 } });
      const member = await prisma.unitResident.create({ data: { unitId: unit.id, residentId: resident.id, role: "OWNER" } });
      memberships.push(member.id);
      const challenge = await request("/auth/wallet/challenge", { walletAddress: wallets[i] }, 200);
      const signatureBase64 = sign(null, Buffer.from(challenge.message), keys[i]!.privateKey).toString("base64");
      tokens.push((await request("/auth/wallet/verify", { challengeId: challenge.challengeId, signatureBase64 }, 200)).token);
    }
    const service = await prisma.service.create({ data: { buildingId, name: "Cleaning", category: "DEMO" } });
    await prisma.serviceVersion.create({ data: { serviceId: service.id, version: 1, title: "Cleaning v1", monthlyAmountMinor: 10000, currency: "GEL", configJson: { demo: true }, active: true } });
    const root = `/buildings/${buildingId}/signed-proposals`;
    const proposal = await request(root, { serviceId: service.id, createdByMembershipId: memberships[0], title: "Devnet signed Cleaning approval",
      proposedVersion: { title: "Cleaning v2", monthlyAmountMinor: 11000, currency: "GEL", billingPeriod: "MONTHLY", configJson: { demo: true, weekly: true } } }, 201, tokens[0]);
    for (let i = 0; i < 3; i++) {
      const input = { membershipId: memberships[i], choice: "APPROVE" };
      const message = await request(`${root}/${proposal.id}/ballot-message`, input, 200, tokens[i]);
      const signatureBase64 = sign(null, Buffer.from(message.message), keys[i]!.privateKey).toString("base64");
      await request(`${root}/${proposal.id}/votes`, { ...input, signatureBase64 }, 201, tokens[i]);
    }
    const proof = await request(`${root}/${proposal.id}/commitments`, {}, 200, tokens[0]);
    assert.equal(proof.authorizationVerified, true);
    assert.equal(verifySignedApprovalPayload(proof.payload), true);
    keep = true;
    console.log(JSON.stringify({ status: "prepared", reused: false, buildingId, proposalId: proposal.id,
      commitmentId: proof.id, commitmentHash: proof.commitmentHash,
      note: "Isolated signed demo fixture retained for anchoring; no Devnet transaction submitted; signing keys discarded" }, null, 2));
  }
} finally {
  if (buildingId) {
    if (keep) {
      await prisma.walletSession.deleteMany({ where: { buildingId } });
      await prisma.walletChallenge.deleteMany({ where: { buildingId } });
    } else {
      await prisma.commitment.deleteMany({ where: { buildingId } });
      await prisma.proposal.deleteMany({ where: { buildingId } });
      await prisma.building.deleteMany({ where: { id: buildingId } });
    }
  }
  await prisma.$disconnect();
}
