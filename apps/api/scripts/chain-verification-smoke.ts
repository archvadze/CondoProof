import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { verifyOnChain } from "../src/solana/devnet-rpc.js";

const [id] = process.argv.slice(2);
assert.ok(id && /^[0-9a-f-]{36}$/i.test(id), "Usage: tsx scripts/chain-verification-smoke.ts <commitment-UUID>");
assert.ok(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const record = await prisma.commitment.findUniqueOrThrow({ where: { id } });
  const payload = (record.metadata as { payload: Record<string, unknown> }).payload;
  const independent = await verifyOnChain(payload, record.commitmentHash);
  assert.equal(independent.verified, true, independent.reason);
  assert.equal(record.status, "CONFIRMED");
  assert.equal(record.solanaSlot?.toString(), independent.recordedSlot);
  const apiOrigin = new URL(
    process.env.CONDOPROOF_API_ORIGIN ?? "http://127.0.0.1:3001",
  );
  assert.ok(
    apiOrigin.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(apiOrigin.hostname) &&
    !apiOrigin.username && !apiOrigin.password &&
    apiOrigin.pathname === "/" && !apiOrigin.search && !apiOrigin.hash,
    "A loopback HTTP API origin is required",
  );
  const path = `${apiOrigin.origin}/buildings/${record.buildingId}/commitments/${id}`;
  async function get(url: string, body?: unknown) {
    const response = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
    assert.equal(response.status, 200); return response.json();
  }
  const view = await get(path);
  const verification = await get(`${path}/verification`);
  for (const field of ["integrityVerified", "sourceMatches", "versionHashMatches", "authorizationVerified", "onChainVerified"]) assert.equal(verification[field], true, field);
  assert.equal(view.onChainVerified, true);
  const supplied = await get(`${path}/verify-payload`, { payload });
  assert.equal(supplied.onChainVerified, true);
  const wrong = structuredClone(payload) as { serviceVersion: { monthlyAmountMinor: number } };
  wrong.serviceVersion.monthlyAmountMinor++;
  const invalid = await get(`${path}/verify-payload`, { payload: wrong });
  assert.equal(invalid.onChainVerified, false); assert.equal(invalid.authorizationVerified, false);
  console.log(JSON.stringify({ status: "ok", commitmentId: id, onChainVerified: true, finalizedAccount: "verified",
    authorizationVerified: true, sourceAndVersionHashes: "match", tamperedPayload: "rejected",
    independentRpcCheck: "passed", chainVerification: independent }, null, 2));
} finally { await prisma.$disconnect(); }
