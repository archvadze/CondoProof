import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { validateWalletAddress } from "../src/wallet-auth/wallet-crypto.js";

const wallets = process.argv.slice(2);
assert.equal(wallets.length, 3, "Supply public wallet addresses for A, B and C");
assert.equal(new Set(wallets).size, 3, "Wallet addresses must be distinct");
wallets.forEach(validateWalletAddress);

assert.notEqual(process.env.NODE_ENV, "production", "Local registrar CLI only");
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
const database = new URL(process.env.DATABASE_URL);
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(database.hostname));
assert.equal(database.pathname, "/condoproof");

const participants = wallets.map((walletAddress, index) => ({
  walletAddress,
  name: ["Demo owner A", "Demo owner B", "Demo owner C"][index]!,
  label: ["DEMO-101", "DEMO-102", "DEMO-103"][index]!,
  weight: [5000, 3000, 2000][index]!,
}));

const fingerprint = createHash("sha256")
  .update(JSON.stringify(wallets))
  .digest("hex");
const buildingName = `CondoProof weighted browser demo ${fingerprint.slice(0, 8)}`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const result = await prisma.$transaction(async tx => {
    // Use the same enrollment locks as the single-owner registrar CLI.
    for (const wallet of [...wallets].sort()) {
      const lock = createHash("sha256")
        .update(`condoproof-web-demo:${wallet}`)
        .digest()
        .readBigInt64BE();
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(${lock})`;
    }

    const existing = await tx.resident.findMany({
      where: { walletAddress: { in: wallets } },
      include: { units: { include: { unit: true } } },
    });

    let buildingId: string;
    let status: "created" | "reused";

    if (existing.length) {
      assert.equal(existing.length, 3, "Partial/conflicting enrollment; no changes made");
      assert.equal(new Set(existing.map(r => r.buildingId)).size, 1,
        "Wallets belong to different buildings");

      buildingId = existing[0]!.buildingId;
      const building = await tx.building.findUniqueOrThrow({
        where: { id: buildingId },
      });

      assert.equal(building.name, buildingName, "Existing enrollment belongs to another demo");
      assert.equal(building.governanceThresholdBps, 8000);
      assert.equal(building.quorumBps, 6000);
      assert.equal(await tx.unit.count({ where: { buildingId } }), 3);
      assert.equal(await tx.resident.count({ where: { buildingId } }), 3);

      for (const participant of participants) {
        const resident = existing.find(r => r.walletAddress === participant.walletAddress)!;
        assert.equal(resident.units.length, 1);
        const membership = resident.units[0]!;
        assert.equal(membership.role, "OWNER");
        assert.equal(membership.unit.buildingId, buildingId);
        assert.equal(membership.unit.label, participant.label);
        assert.equal(membership.unit.votingWeightBps, participant.weight);
      }
      status = "reused";
    } else {
      const building = await tx.building.create({
        data: {
          name: buildingName,
          governanceThresholdBps: 8000,
          quorumBps: 6000,
        },
      });
      buildingId = building.id;

      for (const participant of participants) {
        const unit = await tx.unit.create({
          data: {
            buildingId,
            label: participant.label,
            votingWeightBps: participant.weight,
          },
        });
        const resident = await tx.resident.create({
          data: {
            buildingId,
            name: participant.name,
            walletAddress: participant.walletAddress,
          },
        });
        await tx.unitResident.create({
          data: {
            unitId: unit.id,
            residentId: resident.id,
            role: "OWNER",
          },
        });
      }

      for (const [name, amount] of [
        ["Cleaning", 10000],
        ["Security", 20000],
        ["Maintenance", 15000],
      ] as const) {
        const service = await tx.service.create({
          data: { buildingId, name, category: "DEMO" },
        });
        await tx.serviceVersion.create({
          data: {
            serviceId: service.id,
            version: 1,
            title: `${name} initial demo terms`,
            monthlyAmountMinor: amount,
            currency: "GEL",
            billingPeriod: "MONTHLY",
            configJson: { demo: true, participants: 3 },
            active: true,
          },
        });
      }
      status = "created";
    }

    const residents = await tx.resident.findMany({
      where: { buildingId },
      include: { units: { include: { unit: true } } },
    });
    const services = await tx.service.findMany({
      where: { buildingId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return {
      status,
      buildingId,
      buildingName,
      governanceThresholdBps: 8000,
      quorumBps: 6000,
      totalVotingWeightBps: 10000,
      participants: participants.map(participant => {
        const resident = residents.find(r => r.walletAddress === participant.walletAddress)!;
        const membership = resident.units[0]!;
        return {
          name: participant.name,
          walletAddress: participant.walletAddress,
          votingWeightBps: participant.weight,
          residentId: resident.id,
          unitId: membership.unitId,
          membershipId: membership.id,
        };
      }),
      services,
      note: "Controlled three-account demo; enrollment does not certify property ownership",
    };
  }, { timeout: 15000 });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof assert.AssertionError
    ? error.message
    : "Weighted demo enrollment failed; transaction rolled back");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
