import type { Commitment, Verification } from "./contracts";
export interface ProofStatus { label: string; kind: string; detail: string }
export function proofStatus(proof: Commitment | null, verification: Verification | null, loadError = false): ProofStatus {
  if (loadError) return { label: "Verification unavailable", kind: "unavailable", detail: "Could not refresh the evidence. Retry before relying on the displayed record." };
  if (!proof || !verification) return { label: "Checking Devnet", kind: "checking", detail: "Reading the proof and finalized program accounts." };
  const chain = verification.chainVerification;
  if (verification.onChainVerified && chain.verified) return { label: "Confirmed", kind: "confirmed", detail: "A finalized program account matches this evidence. This confirms chain inclusion, not property ownership." };
  if (chain.reason === "RPC_UNAVAILABLE") return { label: "Verification unavailable", kind: "unavailable", detail: "The RPC could not complete verification. This does not establish a failed transaction." };
  if (proof.status === "FAILED") return { label: "Failed", kind: "failed", detail: "The stored anchoring attempt failed. The decision evidence remains available." };
  if (chain.reason === "NOT_ANCHORED") {
    if (proof.solanaSignature && proof.status === "PENDING") return { label: "Pending", kind: "pending", detail: "A transaction signature is recorded, but finalized account inclusion is not yet verified." };
    return { label: "Not anchored", kind: "not-anchored", detail: "No matching finalized commitment account was found. An authorized operator can anchor this proof." };
  }
  return { label: "Verification failed", kind: "mismatch", detail: `The current account check did not validate this proof (${chain.reason}). This is distinct from a failed transaction.` };
}
