import assert from "node:assert/strict";
import { test } from "node:test";
import { proofStatus } from "../src/lib/proof-status.ts";
const proof = { status: "PENDING", solanaSignature: null };
const status = reason => ({ onChainVerified: false, chainVerification: { verified: false, reason } });
test("an unsubmitted proof is not a pending transaction", () => {
  assert.equal(proofStatus(proof, status("NOT_ANCHORED")).label, "Not anchored");
  assert.equal(proofStatus({ ...proof, solanaSignature: "signature" }, status("NOT_ANCHORED")).label, "Pending");
});
test("database confirmation alone cannot confirm current chain inclusion", () => {
  assert.equal(proofStatus({ ...proof, status: "CONFIRMED" }, status("HASH_MISMATCH")).label, "Verification failed");
  assert.equal(proofStatus(proof, { onChainVerified: true, chainVerification: { verified: true, reason: "VERIFIED" } }).label, "Confirmed");
});
test("RPC and refresh failures do not imply a failed transaction", () => {
  assert.equal(proofStatus({ ...proof, status: "CONFIRMED" }, status("RPC_UNAVAILABLE")).label, "Verification unavailable");
  assert.equal(proofStatus(proof, status("NOT_ANCHORED"), true).label, "Verification unavailable");
  assert.equal(proofStatus({ ...proof, status: "FAILED" }, status("NOT_ANCHORED")).label, "Failed");
});
test("missing evidence has a loading state", () => {
  assert.equal(proofStatus(null, null).label, "Checking Devnet");
});
