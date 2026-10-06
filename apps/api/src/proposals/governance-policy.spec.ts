import { describe, expect, it } from "vitest";
import { tally, validateSnapshot } from "./governance-policy.js";
import type { Ballot, Choice, GovernanceSnapshot } from "./governance-policy.js";

const policy: GovernanceSnapshot = {
  schemaVersion: 1, denominator: "TOTAL_ELIGIBLE_WEIGHT",
  totalVotingWeightBps: 10000, quorumBps: 6000, governanceThresholdBps: 6000,
  eligibleUnits: Array.from({ length: 5 }, (_, i) => ({
    unitId: String(i), votingWeightBps: 2000,
    members: [{ membershipId: `m${i}`, residentId: `r${i}` }],
  })),
};
const ballots = (choices: Choice[]): Ballot[] => choices.map((choice, i) => ({
  unitId: String(i), votingWeightBps: 2000, choice,
}));

describe("weighted governance policy", () => {
  it("requires both quorum and approval weight", () => {
    expect(tally(policy, ballots(["APPROVE", "APPROVE"])).decision).toBe("PENDING");
    const result = tally(policy, ballots(["APPROVE", "APPROVE", "APPROVE"]));
    expect(result.decision).toBe("APPROVED");
    expect(result.approvalWeightBps).toBe(6000);
  });
  it("counts abstention for quorum only", () => {
    const result = tally(policy, ballots(["APPROVE", "APPROVE", "ABSTAIN"]));
    expect(result.quorumMet).toBe(true);
    expect(result.approvalMet).toBe(false);
    expect(result.decision).toBe("PENDING");
  });
  it("rejects when approval is mathematically impossible", () => {
    expect(tally(policy, ballots(["REJECT", "REJECT"])).decision).toBe("PENDING");
    expect(tally(policy, ballots(["REJECT", "REJECT", "REJECT"])).decision).toBe("REJECTED");
  });
  it("rejects an exhausted ballot without enough approval", () => {
    expect(tally(policy, ballots(["APPROVE", "APPROVE", "ABSTAIN", "REJECT", "REJECT"])).decision)
      .toBe("REJECTED");
  });
  it("uses the frozen policy, not a later building configuration", () => {
    const frozen = structuredClone(policy);
    const changed = { ...policy, governanceThresholdBps: 8000 };
    expect(tally(frozen, ballots(["APPROVE", "APPROVE", "APPROVE"])).decision).toBe("APPROVED");
    expect(tally(changed, ballots(["APPROVE", "APPROVE", "APPROVE"])).decision).toBe("PENDING");
  });
  it("does not count two owner memberships as two unit votes", () => {
    expect(() => tally(policy, [
      { unitId: "0", votingWeightBps: 2000, choice: "APPROVE" },
      { unitId: "0", votingWeightBps: 2000, choice: "REJECT" },
    ])).toThrow("Duplicate or invalid unit ballot");
  });
  it("rejects forged vote weight", () => {
    expect(() => tally(policy, [{ unitId: "0", votingWeightBps: 6000, choice: "APPROVE" }]))
      .toThrow("Duplicate or invalid unit ballot");
  });
  it("rejects votes from units outside the electorate", () => {
    expect(() => tally(policy, [{ unitId: "outsider", votingWeightBps: 2000, choice: "APPROVE" }]))
      .toThrow("Duplicate or invalid unit ballot");
  });
  it("requires complete positive unit weights and owner eligibility", () => {
    const missingOwner = structuredClone(policy);
    missingOwner.eligibleUnits[0]!.members = [];
    expect(() => validateSnapshot(missingOwner)).toThrow();
    const wrongTotal = structuredClone(policy);
    wrongTotal.eligibleUnits[0]!.votingWeightBps = 1000;
    expect(() => validateSnapshot(wrongTotal)).toThrow();
  });
  it("uses integer cross-multiplication at threshold boundaries", () => {
    const unequal = structuredClone(policy);
    unequal.eligibleUnits[0]!.votingWeightBps = 5999;
    unequal.eligibleUnits[1]!.votingWeightBps = 1001;
    unequal.eligibleUnits[2]!.votingWeightBps = 1000;
    unequal.eligibleUnits[3]!.votingWeightBps = 1000;
    unequal.eligibleUnits[4]!.votingWeightBps = 1000;
    expect(tally(unequal, [{ unitId: "0", votingWeightBps: 5999, choice: "APPROVE" }]).decision)
      .toBe("PENDING");
    unequal.eligibleUnits[0]!.votingWeightBps = 6000;
    unequal.eligibleUnits[1]!.votingWeightBps = 1000;
    expect(tally(unequal, [{ unitId: "0", votingWeightBps: 6000, choice: "APPROVE" }]).decision)
      .toBe("APPROVED");
  });
});
