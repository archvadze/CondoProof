import type { Prisma } from "../generated/prisma/client.js";
import { canonicalHash, canonicalJson } from "../commitments/canonical-json.js";
import { validateSnapshot } from "../proposals/governance-policy.js";
import type { Choice, GovernanceSnapshot } from "../proposals/governance-policy.js";
import { validateWalletAddress, verifyWalletSignature } from "../wallet-auth/wallet-crypto.js";

export const SIGNED_PROPOSAL_DOMAIN = "condoproof/proposal/wallet-signed/v1";
export const SIGNED_BALLOT_DOMAIN = "condoproof/ballot/wallet-signed/v1";
const chain = { network: "solana:devnet", programId: "3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF" };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export type SigningSource = {
  id: string; buildingId: string; serviceId: string; baseVersionId: string | null;
  title: string; description: string | null; createdByResidentId: string | null;
  governanceSnapshot: Prisma.JsonValue | null;
  proposedVersion: {
    id: string; serviceId: string; version: number; title: string; description: string | null;
    monthlyAmountMinor: number; currency: string; billingPeriod: string;
    effectiveFrom: Date | null; configJson: Prisma.JsonValue;
  };
};

export function signedProposalHash(source: SigningSource): string {
  const policy = source.governanceSnapshot as unknown as GovernanceSnapshot;
  validateSnapshot(policy);
  if (!source.baseVersionId || source.serviceId !== source.proposedVersion.serviceId) {
    throw new Error("Invalid proposal version linkage");
  }
  const electorate = [...policy.eligibleUnits].sort((a, b) => compare(a.unitId, b.unitId)).map((unit) => ({
    unitId: unit.unitId,
    votingWeightBps: unit.votingWeightBps,
    members: [...unit.members].sort((a, b) => compare(a.membershipId, b.membershipId)).map((member) => {
      if (!member.walletAddress) throw new Error("All owner wallets must be enrolled before opening a signed proposal");
      validateWalletAddress(member.walletAddress);
      return { membershipId: member.membershipId, residentId: member.residentId, walletAddress: member.walletAddress };
    }),
  }));
  const version = source.proposedVersion;
  return canonicalHash({
    domain: SIGNED_PROPOSAL_DOMAIN, schemaVersion: 1, chain,
    proposalId: source.id, buildingId: source.buildingId, serviceId: source.serviceId,
    baseVersionId: source.baseVersionId, createdByResidentId: source.createdByResidentId,
    title: source.title, description: source.description,
    governance: {
      denominator: policy.denominator, totalVotingWeightBps: policy.totalVotingWeightBps,
      quorumBps: policy.quorumBps, governanceThresholdBps: policy.governanceThresholdBps,
      eligibleUnits: electorate,
    },
    proposedVersion: {
      id: version.id, serviceId: version.serviceId, version: version.version,
      title: version.title, description: version.description,
      monthlyAmountMinor: version.monthlyAmountMinor, currency: version.currency,
      billingPeriod: version.billingPeriod, effectiveFrom: version.effectiveFrom?.toISOString() ?? null,
      configJson: version.configJson,
    },
  });
}

export type BallotMessageInput = {
  proposalId: string; proposalHash: string; buildingId: string; unitId: string;
  membershipId: string; residentId: string; walletAddress: string;
  votingWeightBps: number; choice: Choice;
};

export function signedBallotMessage(input: BallotMessageInput): string {
  if (!/^[0-9a-f]{64}$/.test(input.proposalHash)) throw new Error("Invalid proposal hash");
  validateWalletAddress(input.walletAddress);
  return canonicalJson({
    domain: SIGNED_BALLOT_DOMAIN, schemaVersion: 1, chain,
    proposalId: input.proposalId, proposalHash: input.proposalHash, buildingId: input.buildingId,
    unitId: input.unitId, membershipId: input.membershipId, residentId: input.residentId,
    walletAddress: input.walletAddress, votingWeightBps: input.votingWeightBps, choice: input.choice,
  });
}

export function verifySignedBallot(input: BallotMessageInput, signatureBase64: string): boolean {
  return verifyWalletSignature(input.walletAddress, signedBallotMessage(input), signatureBase64);
}

export type SignedSource = SigningSource & { authorizationMode: string; signingHash: string | null };

export function ballotInput(source: SignedSource, membershipId: string, choice: Choice): BallotMessageInput {
  if (source.authorizationMode !== "WALLET_SIGNED" || !source.signingHash) throw new Error("Proposal is not wallet-signed");
  if (signedProposalHash(source) !== source.signingHash) throw new Error("Stored signing hash does not match proposal content");
  const policy = source.governanceSnapshot as unknown as GovernanceSnapshot;
  const unit = policy.eligibleUnits.find((item) => item.members.some((member) => member.membershipId === membershipId));
  const member = unit?.members.find((item) => item.membershipId === membershipId);
  if (!unit || !member?.walletAddress) throw new Error("Membership is not in the signed electorate");
  return {
    proposalId: source.id, proposalHash: source.signingHash, buildingId: source.buildingId,
    unitId: unit.unitId, membershipId, residentId: member.residentId,
    walletAddress: member.walletAddress, votingWeightBps: unit.votingWeightBps, choice,
  };
}

export function verifyStoredSignedBallot(source: SignedSource, vote: {
  unitId: string; unitResidentId: string; residentId: string; choice: Choice;
  votingWeightBps: number; walletAddress: string | null; signatureBase64: string | null; signedMessage: string | null;
}): boolean {
  try {
    if (!vote.signatureBase64 || !vote.signedMessage || !vote.walletAddress) return false;
    const input = ballotInput(source, vote.unitResidentId, vote.choice);
    return vote.unitId === input.unitId && vote.residentId === input.residentId &&
      vote.walletAddress === input.walletAddress && vote.votingWeightBps === input.votingWeightBps &&
      vote.signedMessage === signedBallotMessage(input) && verifySignedBallot(input, vote.signatureBase64);
  } catch { return false; }
}
