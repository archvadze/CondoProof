import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo DB check is prohibited in production");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const buildingId = "62871254-7b28-48c9-b333-3531e14edc9f";

try {
  const proposal = await prisma.proposal.findFirst({
    where: { buildingId, status: "APPROVED", title: { contains: "demo change" } },
    orderBy: { createdAt: "desc" }, include: { votes: true, proposedVersion: true },
  });
  assert.ok(proposal, "Run governance-smoke.mjs first");
  assert.ok(proposal.governanceSnapshot);
  const snapshotBefore = JSON.stringify(proposal.governanceSnapshot);
  const amountBefore = proposal.proposedVersion.monthlyAmountMinor;
  const countBefore = await prisma.proposalVote.count({ where: { proposalId: proposal.id } });
  const membershipsBefore = await prisma.unitResident.count({ where: { unit: { buildingId } } });

  await assert.rejects(
    () => prisma.$executeRaw`
      UPDATE "Proposal" SET "governanceSnapshot" = jsonb_set("governanceSnapshot", '{quorumBps}', '1'::jsonb)
      WHERE id = ${proposal.id}::uuid
    `,
    /immutable/,
  );
  await assert.rejects(
    () => prisma.$executeRaw`
      UPDATE "ServiceVersion" SET "monthlyAmountMinor" = "monthlyAmountMinor" + 1
      WHERE id = ${proposal.proposedVersionId}::uuid
    `,
    /immutable/,
  );

  const firstVote = proposal.votes[0]!;
  const otherResident = await prisma.resident.findFirst({
    where: { buildingId, id: { not: firstVote.residentId } }, select: { id: true },
  });
  assert.ok(otherResident);
  // Both the temporary co-owner membership and duplicate vote must roll back.
  await assert.rejects(
    () => prisma.$transaction(async (tx) => {
      const coOwner = await tx.unitResident.create({
        data: { unitId: firstVote.unitId, residentId: otherResident.id, role: "OWNER" },
      });
      await tx.proposalVote.create({
        data: {
          proposalId: proposal.id, unitId: firstVote.unitId,
          unitResidentId: coOwner.id, residentId: otherResident.id,
          choice: "APPROVE", votingWeightBps: firstVote.votingWeightBps,
        },
      });
    }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );

  const after = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { proposedVersion: true } });
  assert.equal(JSON.stringify(after.governanceSnapshot), snapshotBefore);
  assert.equal(after.proposedVersion.monthlyAmountMinor, amountBefore);
  assert.equal(await prisma.proposalVote.count({ where: { proposalId: proposal.id } }), countBefore);
  assert.equal(await prisma.unitResident.count({ where: { unit: { buildingId } } }), membershipsBefore);
  console.log(JSON.stringify({
    status: "ok", proposalSnapshot: "immutable", proposedVersionTerms: "immutable",
    secondOwnerSameUnit: "P2002", rejectedWrites: "rolled back",
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
