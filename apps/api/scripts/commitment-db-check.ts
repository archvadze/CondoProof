import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { canonicalHash } from "../src/commitments/canonical-json.js";
import { approvalInclude, buildApprovalPayload } from "../src/commitments/approval-payload.js";

if (process.env.NODE_ENV === "production") throw new Error("Demo DB check is prohibited in production");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const buildingId = "62871254-7b28-48c9-b333-3531e14edc9f";

try {
  const record = await prisma.commitment.findFirst({
    where: { buildingId, kind: "PROPOSAL" }, orderBy: { createdAt: "desc" },
  });
  assert.ok(record?.proposalId, "Run commitment-smoke.mjs first");
  const proposal = await prisma.proposal.findUniqueOrThrow({
    where: { id: record.proposalId }, include: approvalInclude,
  });
  const proof = buildApprovalPayload(proposal);
  const metadata = record.metadata as { payload: unknown };
  assert.equal(canonicalHash(metadata.payload), record.commitmentHash);
  assert.equal(proof.commitmentHash, record.commitmentHash);
  assert.equal(proposal.proposedVersion.contentHash, proof.serviceVersionHash);
  assert.equal(await prisma.commitment.count({
    where: { buildingId, proposalId: record.proposalId, kind: "PROPOSAL" },
  }), 1);
  assert.equal(record.status, "PENDING");
  assert.equal(record.solanaSignature, null);
  assert.equal(record.solanaSlot, null);
  console.log(JSON.stringify({
    status: "ok", commitmentsForProposal: 1,
    metadataHash: "matches", sourceHash: "matches", versionHash: "matches",
    chainState: "PENDING; no transaction submitted",
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
