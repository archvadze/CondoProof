import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { BillingPeriod, PrismaClient } from "./generated/prisma/client.js";

const BUILDING_ID = "62871254-7b28-48c9-b333-3531e14edc9f";
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is required.");
if (process.env.NODE_ENV === "production") {
  throw new Error("Demo seeding is disabled in production.");
}

const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const services = [
  { name: "Cleaning", category: "CLEANING", amountMinor: 10_000 },
  { name: "Security", category: "SECURITY", amountMinor: 20_000 },
  { name: "Maintenance", category: "MAINTENANCE", amountMinor: 15_000 },
];

// UUID v5: the existing building UUID is the namespace.
function fixtureId(name: string): string {
  const namespace = Buffer.from(BUILDING_ID.replaceAll("-", ""), "hex");
  const bytes = createHash("sha1").update(namespace).update(name, "utf8").digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

async function seedDemo() {
  return prisma.$transaction(async (tx) => {
    // Serialize repeated runs of this fixture without touching application locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(62871254, 1001)`;

    const building = await tx.building.findUnique({
      where: { id: BUILDING_ID },
      include: { _count: { select: { proposals: true, invoices: true, commitments: true } } },
    });
    if (!building) throw new Error("Expected Demo Building was not found. No replacement building was created.");

    const policyChanged = building.governanceThresholdBps !== 6000 || building.quorumBps !== 6000;
    if (policyChanged) {
      if (building._count.proposals + building._count.invoices + building._count.commitments > 0) {
        throw new Error("Existing business records prevent changing the demo governance policy.");
      }
      await tx.building.update({
        where: { id: BUILDING_ID },
        data: { governanceThresholdBps: 6000, quorumBps: 6000 },
      });
    }

    const participants = [];
    for (let index = 1; index <= 5; index += 1) {
      const label = String(100 + index);
      const unit = await tx.unit.upsert({
        where: { buildingId_label: { buildingId: BUILDING_ID, label } },
        update: {},
        create: { id: fixtureId(`unit:${label}`), buildingId: BUILDING_ID, label, votingWeightBps: 2000 },
      });
      if (unit.votingWeightBps !== 2000) {
        throw new Error(`Unit ${label} already has a different voting weight. Existing data was preserved.`);
      }

      const residentId = fixtureId(`resident:${label}`);
      const email = `resident${index}@condoproof.invalid`;
      const existingEmail = await tx.resident.findFirst({
        where: { buildingId: BUILDING_ID, email },
        select: { id: true },
      });
      if (existingEmail && existingEmail.id !== residentId) {
        throw new Error(`The demo email for unit ${label} already belongs to another record.`);
      }
      const resident = await tx.resident.upsert({
        where: { id: residentId },
        update: {},
        create: {
          id: residentId, buildingId: BUILDING_ID,
          name: `Demo Resident ${index}`, email, walletAddress: null,
        },
      });
      if (resident.buildingId !== BUILDING_ID) throw new Error("Resident namespace conflict.");

      const membership = await tx.unitResident.upsert({
        where: { unitId_residentId: { unitId: unit.id, residentId: resident.id } },
        update: {},
        create: {
          id: fixtureId(`membership:${label}`),
          unitId: unit.id, residentId: resident.id, role: "OWNER",
        },
      });
      if (membership.role !== "OWNER") throw new Error(`Unit ${label} has a different membership role.`);
      participants.push({ unitId: unit.id, label, residentId: resident.id, membershipId: membership.id });
    }

    const initialVersions = [];
    for (const definition of services) {
      const service = await tx.service.upsert({
        where: { buildingId_name: { buildingId: BUILDING_ID, name: definition.name } },
        update: {},
        create: {
          id: fixtureId(`service:${definition.name}`),
          buildingId: BUILDING_ID, name: definition.name, category: definition.category,
        },
      });
      const activeVersionCount = await tx.serviceVersion.count({
        where: { serviceId: service.id, active: true },
      });
      const version = await tx.serviceVersion.upsert({
        where: { serviceId_version: { serviceId: service.id, version: 1 } },
        update: {},
        create: {
          id: fixtureId(`service-version:${definition.name}:1`),
          serviceId: service.id, version: 1,
          title: `${definition.name} — initial terms`,
          description: "Synthetic demo data. No payment or on-chain commitment is created.",
          monthlyAmountMinor: definition.amountMinor,
          currency: "GEL", billingPeriod: BillingPeriod.MONTHLY,
          effectiveFrom: new Date("2026-10-01T00:00:00+04:00"),
          contentHash: null,
          configJson: { demo: true, fixture: "condoproof-demo-v1", scope: "shared-building" },
          // A rerun must not reactivate v1 after a later version is approved.
          active: activeVersionCount === 0,
        },
      });
      initialVersions.push({ serviceId: service.id, name: service.name, versionId: version.id, version: version.version });
    }

    const units = await tx.unit.findMany({
      where: { buildingId: BUILDING_ID }, select: { id: true, votingWeightBps: true },
    });
    const residents = await tx.resident.count({ where: { buildingId: BUILDING_ID } });
    const memberships = await tx.unitResident.count({ where: { unit: { buildingId: BUILDING_ID } } });
    const serviceCount = await tx.service.count({ where: { buildingId: BUILDING_ID } });
    const versionCount = await tx.serviceVersion.count({ where: { service: { buildingId: BUILDING_ID } } });
    const totalWeightBps = units.reduce((sum, unit) => sum + unit.votingWeightBps, 0);

    if (units.length !== 5 || residents !== 5 || memberships !== 5 || serviceCount !== 3 || totalWeightBps !== 10_000) {
      throw new Error("Demo fixture counts or voting weights differ from the expected 5/5/5/3 and 10000 bps. Transaction rolled back.");
    }

    return {
      buildingId: BUILDING_ID,
      governanceThresholdBps: 6000, quorumBps: 6000,
      units: units.length, residents, unitResidents: memberships,
      services: serviceCount, initialServiceVersions: initialVersions.length,
      totalServiceVersions: versionCount, totalVotingWeightBps: totalWeightBps,
      participants, initialVersions,
    };
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function main() {
  const first = await seedDemo();
  const second = await seedDemo();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error("The second seed run changed the fixture snapshot.");
  }
  console.log(JSON.stringify({
    status: "ok", seedRuns: 2, idempotent: true,
    fingerprint: createHash("sha256").update(JSON.stringify(second)).digest("hex"),
    ...second,
  }, null, 2));
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown seeding error.";
    console.error(connectionString ? message.replaceAll(connectionString, "[redacted]") : message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } finally { await pool.end(); }
  });
