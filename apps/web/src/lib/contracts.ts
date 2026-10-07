export const FEATURED_BUILDING = "995bfd6b-a401-45e9-8d74-5d61acfee1af";
export const FEATURED_COMMITMENT = "171aca09-c7c1-46bf-83de-d30bf18ff74a";
export const PROGRAM_ID = "3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Choice = "APPROVE" | "REJECT" | "ABSTAIN";
export interface Building { id: string; name: string; governanceThresholdBps: number; quorumBps: number }
export interface Unit { id: string; label: string; votingWeightBps: number }
export interface Version { id: string; version: number; title: string; description: string | null; monthlyAmountMinor: number; currency: string; billingPeriod: string; active: boolean; configJson: Record<string, unknown> }
export interface Service { id: string; name: string; category: string; active: boolean; versions: Version[] }
export interface Membership { id: string; unitId: string; role: string }
export interface Identity { residentId: string; buildingId: string; walletAddress: string; memberships: Membership[] }
export interface Proposal {
  id: string; buildingId: string; serviceId: string; title: string; description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "DRAFT";
  authorizationMode: "WALLET_SIGNED" | "UNSIGNED_DEMO"; signingHash: string | null;
  proposedVersion: Version;
  governanceSnapshot: { governanceThresholdBps: number; quorumBps: number; eligibleUnits: Array<{ unitId: string; votingWeightBps: number; members: Array<{ membershipId: string; residentId: string; walletAddress?: string }> }> };
  votes: Array<{ unitId: string; choice: Choice }>;
  tally: { approvalWeightBps: number; participationWeightBps: number; totalVotingWeightBps: number; voteCount: number; quorumMet: boolean; approvalMet: boolean };
}
export interface ChainVerification { verified: boolean; reason: string; network?: string; programId?: string; authority?: string; buildingPda?: string; commitmentPda?: string; readSlot?: number; recordedSlot?: string }
export interface Commitment {
  id: string; buildingId: string; proposalId: string; commitmentHash: string; status: string;
  authorizationMode: string; integrityVerified: boolean; authorizationVerified: boolean; enrollmentVerified: boolean;
  onChainVerified: boolean; canonicalPayload: string; payload: Record<string, unknown>; solanaSignature: string | null;
  chainVerification?: ChainVerification;
}
export interface Verification { integrityVerified: boolean; authorizationVerified: boolean; enrollmentVerified: boolean; onChainVerified: boolean; sourceMatches: boolean; versionHashMatches: boolean; chainVerification: ChainVerification }
export function money(minor: number, currency: string) {
  // This demo accepts currencies with two decimal places (GEL/USD/EUR).
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
export function percent(bps: number) { return `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`; }
export function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-6)}`; }
