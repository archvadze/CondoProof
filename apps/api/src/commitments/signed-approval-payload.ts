import type { ApprovalRecord } from "./approval-payload.js";
import { buildApprovalPayload } from "./approval-payload.js";
import { canonicalHash } from "./canonical-json.js";
import { signedProposalHash, verifyStoredSignedBallot } from "../signed-voting/signed-message.js";
import type { GovernanceSnapshot } from "../proposals/governance-policy.js";

export const SIGNED_APPROVAL_DOMAIN = "condoproof/approved-service-version/wallet-signed/v1";

export function buildSignedApprovalPayload(proposal: ApprovalRecord) {
  if (proposal.authorizationMode !== "WALLET_SIGNED" || !proposal.signingHash ||
      signedProposalHash(proposal) !== proposal.signingHash) {
    throw new Error("Signed proposal content/hash mismatch");
  }
  const snapshot = proposal.governanceSnapshot as unknown as GovernanceSnapshot;
  const memberships = new Set<string>();
  for (const unit of snapshot.eligibleUnits) for (const member of unit.members) {
    if (memberships.has(member.membershipId)) throw new Error("Duplicate electorate membership");
    memberships.add(member.membershipId);
  }
  if (!snapshot.eligibleUnits.some(unit => unit.members.some(member => member.residentId === proposal.createdByResidentId))) {
    throw new Error("Proposal creator is outside the frozen electorate");
  }
  if (!proposal.votes.every(vote => verifyStoredSignedBallot(proposal, vote))) {
    throw new Error("Invalid signed ballot evidence");
  }
  // Reuse the established content encoding and weighted policy without changing v1 unsigned proofs.
  const base = buildApprovalPayload({ ...proposal, authorizationMode: "UNSIGNED_DEMO" });
  const votes = new Map(proposal.votes.map(vote => [vote.id, vote]));
  const payload = {
    ...base.payload,
    domain: SIGNED_APPROVAL_DOMAIN,
    authorizationMode: "WALLET_SIGNED" as const,
    proposal: { ...base.payload.proposal, signingHash: proposal.signingHash },
    ballots: base.payload.ballots.map(ballot => {
      const vote = votes.get(ballot.id)!;
      return { ...ballot, walletAddress: vote.walletAddress!, signatureBase64: vote.signatureBase64!, signedMessage: vote.signedMessage! };
    }),
  };
  return { payload, commitmentHash: canonicalHash(payload), serviceVersionHash: base.serviceVersionHash };
}

// Untrusted JSON is reconstructed, cryptographically checked, and compared with the complete canonical schema.
// No database, active session, or current membership lookup is needed.
export function verifySignedApprovalPayload(input: unknown): boolean {
  try {
    const p = input as ReturnType<typeof buildSignedApprovalPayload>["payload"];
    if (p.domain !== SIGNED_APPROVAL_DOMAIN || p.authorizationMode !== "WALLET_SIGNED" || p.schemaVersion !== 1) return false;
    const v = p.serviceVersion;
    const source = {
      id: p.proposal.id, buildingId: p.buildingId, serviceId: p.serviceId,
      proposedVersionId: v.serviceVersionId, baseVersionId: p.proposal.baseVersionId,
      createdByResidentId: p.proposal.createdByResidentId, title: p.proposal.title, description: p.proposal.description,
      createdAt: new Date(p.proposal.createdAt), status: p.proposal.status,
      authorizationMode: p.authorizationMode, signingHash: p.proposal.signingHash,
      governanceSnapshot: p.governance,
      proposedVersion: { ...v, id: v.serviceVersionId, effectiveFrom: v.effectiveFrom === null ? null : new Date(v.effectiveFrom) },
      votes: p.ballots.map(ballot => ({ ...ballot, proposalId: p.proposal.id, unitResidentId: ballot.membershipId })),
    } as unknown as ApprovalRecord;
    return canonicalHash(input) === buildSignedApprovalPayload(source).commitmentHash;
  } catch { return false; }
}
