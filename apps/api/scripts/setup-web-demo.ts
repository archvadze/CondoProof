import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { validateWalletAddress } from "../src/wallet-auth/wallet-crypto.js";

// Explicit local registrar action. Accept a PUBLIC wallet address only.
const [walletAddress, ...extra] = process.argv.slice(2);
if (!walletAddress || extra.length) throw new Error("Usage: tsx scripts/setup-web-demo.ts <public-Phantom-wallet-address>");
validateWalletAddress(walletAddress);
if (process.env.NODE_ENV === "production") throw new Error("Local demonstration only");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) throw new Error("Demo setup requires a loopback database");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const result = await prisma.$transaction(async tx => {
    // Serialize enrollment for this public address; repeat runs preserve all votes/terms.
    const lock = createHash("sha256").update(`condoproof-web-demo:${walletAddress}`).digest().readBigInt64BE();
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${lock})`;
    const existing = await tx.resident.findUnique({ where: { walletAddress }, include: { building: true, units: true } });
    if (existing) return { status: "reused", buildingId: existing.buildingId, buildingName: existing.building.name, residentId: existing.id,
      membershipIds: existing.units.map(m => m.id), note: "Existing enrollment preserved; no building policy or service terms changed" };
    const buildingId = randomUUID();
    const building = await tx.building.create({ data: { id: buildingId, name: `CondoProof single-owner browser demo ${walletAddress.slice(0, 6)}`,
      governanceThresholdBps: 10000, quorumBps: 10000 } });
    const unit = await tx.unit.create({ data: { buildingId, label: "DEMO-101", votingWeightBps: 10000 } });
    const resident = await tx.resident.create({ data: { buildingId, name: "Browser demo participant", walletAddress } });
    const membership = await tx.unitResident.create({ data: { residentId: resident.id, unitId: unit.id, role: "OWNER" } });
    for (const [name, amount] of [["Cleaning", 10000], ["Security", 20000], ["Maintenance", 15000]] as const) {
      const service = await tx.service.create({ data: { buildingId, name, category: "DEMO" } });
      await tx.serviceVersion.create({ data: { serviceId: service.id, version: 1, title: `${name} initial demo terms`, monthlyAmountMinor: amount,
        currency: "GEL", billingPeriod: "MONTHLY", configJson: { demo: true, participants: 1 }, active: true } });
    }
    return { status: "created", buildingId, buildingName: building.name, residentId: resident.id, membershipIds: [membership.id],
      participants: 1, totalVotingWeightBps: 10000, note: "Single-owner demonstration only; registrar enrollment does not certify property ownership" };
  }, { timeout: 15000 });
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
