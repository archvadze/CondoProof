import "dotenv/config";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { encodeBase58, sessionTokenHash } from "../src/wallet-auth/wallet-crypto.js";

if (process.env.NODE_ENV === "production") throw new Error("Local demo smoke check only");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const base = "http://127.0.0.1:3001";
const buildingId = "62871254-7b28-48c9-b333-3531e14edc9f";
const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const address = encodeBase58(keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
const otherAddress = encodeBase58(otherKeys.publicKey.export({ type: "spki", format: "der" }).subarray(-32));
let fixtureId: string | undefined;

async function raw(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
async function request(method: string, path: string, body?: unknown, expected = 200, token?: string) {
  const result = await raw(method, path, body, token);
  // Never print response bodies: a successful login response contains a session token.
  assert.equal(result.status, expected, `${method} ${path}: unexpected HTTP status`);
  return result.body;
}
const challenge = () => request("POST", "/auth/wallet/challenge", { walletAddress: address });
const signature = (message: string) => sign(null, Buffer.from(message, "utf8"), keys.privateKey).toString("base64");

try {
  const resident = await prisma.resident.create({ data: { buildingId, name: "Wallet auth smoke fixture", walletAddress: address } });
  fixtureId = resident.id;
  const unit = await prisma.unit.findFirstOrThrow({ where: { buildingId }, orderBy: { label: "asc" } });
  const membership = await prisma.unitResident.create({ data: { unitId: unit.id, residentId: resident.id, role: "OWNER" } });

  await request("GET", "/auth/me", undefined, 401);
  await request("GET", "/auth/me", undefined, 401, randomBytes(32).toString("base64url"));
  await request("POST", "/auth/wallet/challenge", { walletAddress: otherAddress }, 401);
  await request("POST", "/auth/wallet/challenge", { walletAddress: "0".repeat(32) }, 400);
  const first = await challenge();
  assert.ok(first.message.includes("CondoProof wallet authentication v1"));
  assert.ok(first.message.includes(`Wallet: ${address}`));
  const wrongSignature = sign(null, Buffer.from(first.message, "utf8"), otherKeys.privateKey).toString("base64");
  await request("POST", "/auth/wallet/verify", { challengeId: first.challengeId, signatureBase64: wrongSignature }, 401);
  await request("POST", "/auth/wallet/verify", { challengeId: first.challengeId, signatureBase64: signature(first.message + "\n") }, 401);

  const loginBody = { challengeId: first.challengeId, signatureBase64: signature(first.message) };
  const attempts = await Promise.all([raw("POST", "/auth/wallet/verify", loginBody), raw("POST", "/auth/wallet/verify", loginBody)]);
  assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), [200, 401]);
  const login = attempts.find((attempt) => attempt.status === 200)!.body;
  assert.equal(login.residentId, resident.id);
  assert.equal(login.buildingId, buildingId);
  assert.equal(login.walletAddress, address);
  const stored = await prisma.walletSession.findUniqueOrThrow({ where: { tokenHash: sessionTokenHash(login.token) } });
  assert.notEqual(stored.tokenHash, login.token);
  assert.equal(stored.tokenHash.length, 64);
  assert.ok((await prisma.walletChallenge.findUniqueOrThrow({ where: { id: first.challengeId } })).consumedAt);
  await request("POST", "/auth/wallet/verify", loginBody, 401);
  const me = await request("GET", "/auth/me", undefined, 200, login.token);
  assert.equal(me.residentId, resident.id);
  assert.equal(me.memberships[0].id, membership.id);
  for (const field of ["name", "email"]) assert.equal(Object.hasOwn(me, field), false);

  await prisma.resident.update({ where: { id: resident.id }, data: { walletAddress: otherAddress } });
  await request("GET", "/auth/me", undefined, 401, login.token);
  await prisma.resident.update({ where: { id: resident.id }, data: { walletAddress: address } });
  await request("POST", "/auth/logout", undefined, 200, login.token);
  await request("GET", "/auth/me", undefined, 401, login.token);

  const expired = await challenge();
  await prisma.walletChallenge.update({ where: { id: expired.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await request("POST", "/auth/wallet/verify", { challengeId: expired.challengeId, signatureBase64: signature(expired.message) }, 401);
  const fresh = await challenge();
  const secondLogin = await request("POST", "/auth/wallet/verify", { challengeId: fresh.challengeId, signatureBase64: signature(fresh.message) });
  await prisma.walletSession.update({ where: { tokenHash: sessionTokenHash(secondLogin.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await request("GET", "/auth/me", undefined, 401, secondLogin.token);

  for (let i = 0; i < 5; i++) await challenge();
  await request("POST", "/auth/wallet/challenge", { walletAddress: address }, 429);
  console.log(JSON.stringify({
    status: "ok", ed25519Signature: "verified", wrongWalletAndChangedMessage: "401",
    concurrentChallengeReuse: [200, 401], replay: "401", expiredChallengeAndSession: "401",
    enrollmentChange: "401", logout: "session revoked", storedToken: "SHA-256 only",
    activeChallengeLimit: "429", privateFields: "excluded",
    note: "Ephemeral test keys stayed in memory; fixture cleanup follows",
  }, null, 2));
} finally {
  if (fixtureId) await prisma.resident.deleteMany({ where: { id: fixtureId } });
  await prisma.$disconnect();
}
