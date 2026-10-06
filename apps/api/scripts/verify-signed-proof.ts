import { readFileSync, statSync } from "node:fs";
import { canonicalHash } from "../src/commitments/canonical-json.js";
import { verifySignedApprovalPayload } from "../src/commitments/signed-approval-payload.js";

const [path, expectedHash] = process.argv.slice(2);
if (!path || !expectedHash || !/^[0-9a-f]{64}$/.test(expectedHash)) {
  throw new Error("Usage: tsx scripts/verify-signed-proof.ts payload.json <trusted-commitment-hash>");
}
if (statSync(path).size > 1024 * 1024) throw new Error("Payload exceeds 1 MiB");
const payload: unknown = JSON.parse(readFileSync(path, "utf8"));
const computedHash = canonicalHash(payload);
const integrityVerified = computedHash === expectedHash;
const authorizationVerified = integrityVerified && verifySignedApprovalPayload(payload);
console.log(JSON.stringify({ computedHash, expectedHash, integrityVerified, authorizationVerified,
  enrollmentVerified: false, onChainVerified: false }, null, 2));
if (!authorizationVerified) process.exitCode = 1;
