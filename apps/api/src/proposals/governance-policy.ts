export type Choice = "APPROVE" | "REJECT" | "ABSTAIN";
export type Decision = "PENDING" | "APPROVED" | "REJECTED";

export interface EligibleUnit {
  unitId: string;
  votingWeightBps: number;
  members: { membershipId: string; residentId: string; walletAddress?: string }[];
}

export interface GovernanceSnapshot {
  schemaVersion: 1;
  denominator: "TOTAL_ELIGIBLE_WEIGHT";
  totalVotingWeightBps: number;
  quorumBps: number;
  governanceThresholdBps: number;
  eligibleUnits: EligibleUnit[];
}

export interface Ballot {
  unitId: string;
  choice: Choice;
  votingWeightBps: number;
}

export function validateSnapshot(snapshot: GovernanceSnapshot): void {
  if (snapshot.schemaVersion !== 1 ||
      snapshot.denominator !== "TOTAL_ELIGIBLE_WEIGHT" ||
      snapshot.totalVotingWeightBps !== 10000 ||
      !Number.isInteger(snapshot.quorumBps) ||
      !Number.isInteger(snapshot.governanceThresholdBps) ||
      snapshot.quorumBps < 1 || snapshot.quorumBps > 10000 ||
      snapshot.governanceThresholdBps < 1 || snapshot.governanceThresholdBps > 10000) {
    throw new Error("Invalid governance policy");
  }

  const ids = new Set<string>();
  let total = 0;
  for (const unit of snapshot.eligibleUnits) {
    if (ids.has(unit.unitId) || !Number.isInteger(unit.votingWeightBps) ||
        unit.votingWeightBps <= 0 || unit.members.length === 0) {
      throw new Error("Invalid eligible unit");
    }
    ids.add(unit.unitId);
    total += unit.votingWeightBps;
  }
  if (total !== snapshot.totalVotingWeightBps) {
    throw new Error("Eligible voting weights must sum to 10000");
  }
}

export function tally(snapshot: GovernanceSnapshot, ballots: Ballot[]) {
  validateSnapshot(snapshot);
  const weights = new Map(snapshot.eligibleUnits.map((unit) => [unit.unitId, unit.votingWeightBps]));
  const votedUnits = new Set<string>();
  let participationWeightBps = 0;
  let approvalWeightBps = 0;
  let rejectionWeightBps = 0;
  let abstentionWeightBps = 0;

  for (const ballot of ballots) {
    if (votedUnits.has(ballot.unitId) || weights.get(ballot.unitId) !== ballot.votingWeightBps) {
      throw new Error("Duplicate or invalid unit ballot");
    }
    votedUnits.add(ballot.unitId);
    participationWeightBps += ballot.votingWeightBps;
    switch (ballot.choice) {
      case "APPROVE": approvalWeightBps += ballot.votingWeightBps; break;
      case "REJECT": rejectionWeightBps += ballot.votingWeightBps; break;
      case "ABSTAIN": abstentionWeightBps += ballot.votingWeightBps; break;
      default: throw new Error("Invalid vote choice");
    }
  }

  const total = snapshot.totalVotingWeightBps;
  const quorumMet = participationWeightBps * 10000 >= total * snapshot.quorumBps;
  const approvalMet = approvalWeightBps * 10000 >= total * snapshot.governanceThresholdBps;
  const remainingWeightBps = total - participationWeightBps;
  const approvalStillPossible = (approvalWeightBps + remainingWeightBps) * 10000 >=
    total * snapshot.governanceThresholdBps;
  let decision: Decision = "PENDING";
  if (quorumMet && approvalMet) decision = "APPROVED";
  else if (!approvalStillPossible || remainingWeightBps === 0) decision = "REJECTED";

  return {
    decision, voteCount: ballots.length, totalVotingWeightBps: total,
    participationWeightBps, approvalWeightBps, rejectionWeightBps,
    abstentionWeightBps, remainingWeightBps, quorumMet, approvalMet,
  };
}
