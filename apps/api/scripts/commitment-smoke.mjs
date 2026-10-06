import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const base = "http://127.0.0.1:3001";
const buildingId = "62871254-7b28-48c9-b333-3531e14edc9f";
const missingId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const root = `/buildings/${buildingId}`;

async function request(method, path, body, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const value = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
const proposals = await request("GET", `${root}/proposals`);
const approved = proposals.find((proposal) => proposal.status === "APPROVED");
const rejected = proposals.find((proposal) => proposal.status === "REJECTED");
assert.ok(approved, "Run governance-smoke.mjs before this scenario");
assert.ok(rejected, "A rejected demo proposal is required");
const createPath = `${root}/proposals/${approved.id}/commitments`;
const [first, concurrent] = await Promise.all([
  request("POST", createPath), request("POST", createPath),
]);
assert.equal(first.id, concurrent.id);
assert.equal(first.commitmentHash, concurrent.commitmentHash);
const repeated = await request("POST", createPath);
assert.equal(repeated.reused, true);
assert.equal(repeated.id, first.id);
assert.equal(first.status, "PENDING");
assert.equal(first.authorizationMode, "UNSIGNED_DEMO");
assert.equal(first.authorizationVerified, false);
assert.equal(first.onChainVerified, false);
assert.equal(first.solanaSignature, null);
assert.equal(first.solanaSlot, null);
assert.match(first.commitmentHash, /^[0-9a-f]{64}$/);

function independentCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${independentCanonical(value[key])}`).join(",")}}`;
}
function reverseKeys(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(reverseKeys);
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
}
assert.equal(first.canonicalPayload, independentCanonical(first.payload));
assert.equal(createHash("sha256").update(first.canonicalPayload, "utf8").digest("hex"), first.commitmentHash);
const commitmentRoot = `${root}/commitments/${first.id}`;
const loaded = await request("GET", commitmentRoot);
assert.equal(loaded.commitmentHash, first.commitmentHash);
assert.equal(loaded.integrityVerified, true);
const verification = await request("GET", `${commitmentRoot}/verification`);
assert.equal(verification.integrityVerified, true);
assert.equal(verification.sourceMatches, true);
assert.equal(verification.versionHashMatches, true);
assert.equal(verification.authorizationVerified, false);
assert.equal(verification.onChainVerified, false);
const matching = await request("POST", `${commitmentRoot}/verify-payload`, { payload: first.payload });
assert.equal(matching.integrityVerified, true);
const reordered = await request("POST", `${commitmentRoot}/verify-payload`, { payload: reverseKeys(first.payload) });
assert.equal(reordered.integrityVerified, true);
const changed = structuredClone(first.payload);
changed.serviceVersion.monthlyAmountMinor++;
const tampered = await request("POST", `${commitmentRoot}/verify-payload`, { payload: changed });
assert.equal(tampered.integrityVerified, false);
assert.notEqual(tampered.computedHash, first.commitmentHash);
await request("POST", `${root}/proposals/${rejected.id}/commitments`, undefined, 409);
await request("POST", `${root}/proposals/${missingId}/commitments`, undefined, 404);
await request("GET", `${root}/commitments/not-a-uuid`, undefined, 400);
await request("GET", `/buildings/${missingId}/commitments/${first.id}`, undefined, 404);
await request("POST", `${commitmentRoot}/verify-payload`, { payload: [] }, 400);

const services = await request("GET", `${root}/services`);
const version = services.find((service) => service.id === approved.serviceId)
  .versions.find((item) => item.id === approved.proposedVersion.id);
assert.equal(version.contentHash, first.payload.serviceVersion.contentHash);
console.log(JSON.stringify({
  status: "ok", proposalId: approved.id, commitmentId: first.id,
  commitmentHash: first.commitmentHash, serviceVersionHash: version.contentHash,
  idempotent: true, concurrentRequestsSameRecord: true,
  independentHashCheck: "passed", sourceMatches: true,
  reorderedObjectKeys: "same hash", changedAmount: "verification failed as expected",
  rejectedProposal: "409", authorizationVerified: false, onChainVerified: false,
}, null, 2));
