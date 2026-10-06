import { describe, expect, it } from "vitest";
import { buildApprovalPayload } from "./approval-payload.js";
import type { ApprovalRecord } from "./approval-payload.js";

function fixture(): ApprovalRecord {
  return {
    id: "proposal-1", buildingId: "building-1", serviceId: "service-1",
    proposedVersionId: "version-2", baseVersionId: "version-1",
    createdByResidentId: "r0", title: "Cleaning change", description: null,
    status: "APPROVED", requiredApprovals: 0,
    createdAt: new Date("2026-10-06T21:00:00.000Z"), updatedAt: new Date("2026-10-06T21:05:00.000Z"),
    governanceSnapshot: {
      schemaVersion: 1, denominator: "TOTAL_ELIGIBLE_WEIGHT",
      totalVotingWeightBps: 10000, quorumBps: 6000, governanceThresholdBps: 6000,
      eligibleUnits: Array.from({ length: 5 }, (_, i) => ({
        unitId: `u${i}`, votingWeightBps: 2000, members: [{ membershipId: `m${i}`, residentId: `r${i}` }],
      })),
    },
    proposedVersion: {
      id: "version-2", serviceId: "service-1", version: 2,
      title: "Cleaning v2", description: null, monthlyAmountMinor: 11000,
      currency: "GEL", billingPeriod: "MONTHLY", effectiveFrom: null,
      contentHash: null, configJson: { frequency: "weekly" }, active: true,
      createdAt: new Date("2026-10-06T21:00:00.000Z"),
    },
    votes: Array.from({ length: 3 }, (_, i) => ({
      id: `vote${i}`, proposalId: "proposal-1", unitId: `u${i}`,
      unitResidentId: `m${i}`, residentId: `r${i}`, choice: "APPROVE",
      votingWeightBps: 2000, createdAt: new Date("2026-10-06T21:01:00.000Z"),
    })),
  };
}

describe("approval payload", () => {
  it("marks unsigned demo authorization explicitly", () => {
    expect(buildApprovalPayload(fixture()).payload.authorizationMode).toBe("UNSIGNED_DEMO");
  });
  it("does not depend on DB row ordering", () => {
    const original = fixture();
    const reordered = structuredClone(original);
    reordered.votes.reverse();
    const snapshot = reordered.governanceSnapshot as { eligibleUnits: unknown[] };
    snapshot.eligibleUnits.reverse();
    expect(buildApprovalPayload(original).commitmentHash).toBe(buildApprovalPayload(reordered).commitmentHash);
  });
  it("excludes mutable activation/contentHash/timestamps from version content", () => {
    const original = fixture();
    const later = structuredClone(original);
    later.proposedVersion.active = false;
    later.proposedVersion.contentHash = "stored-after-hashing";
    later.updatedAt = new Date("2026-11-01T00:00:00.000Z");
    later.proposedVersion.createdAt = new Date("2026-11-01T00:00:00.000Z");
    expect(buildApprovalPayload(original).commitmentHash).toBe(buildApprovalPayload(later).commitmentHash);
  });
  it("binds proposed service terms", () => {
    const original = fixture();
    const changed = structuredClone(original);
    changed.proposedVersion.monthlyAmountMinor++;
    expect(buildApprovalPayload(original).commitmentHash).not.toBe(buildApprovalPayload(changed).commitmentHash);
  });
  it("refuses pending/rejected proposals", () => {
    for (const status of ["PENDING", "REJECTED"] as const) {
      const proposal = fixture(); proposal.status = status;
      expect(() => buildApprovalPayload(proposal)).toThrow("Only approved");
    }
  });
  it("rechecks the frozen approval rule", () => {
    const proposal = fixture(); proposal.votes.pop();
    expect(() => buildApprovalPayload(proposal)).toThrow("do not satisfy");
  });
  it("refuses ballots with forged membership identities", () => {
    const proposal = fixture(); proposal.votes[0]!.residentId = "outsider";
    expect(() => buildApprovalPayload(proposal)).toThrow("membership");
  });
});
