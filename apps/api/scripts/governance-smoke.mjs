import assert from "node:assert/strict";

const base = "http://127.0.0.1:3001";
const buildingId = "62871254-7b28-48c9-b333-3531e14edc9f";
const missingId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const root = `/buildings/${buildingId}`;
const runId = new Date().toISOString();

async function raw(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  return { status: response.status, body: await response.json() };
}
async function request(method, path, body, status = 200) {
  const response = await raw(method, path, body);
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(response.body)}`);
  return response.body;
}

const units = await request("GET", `${root}/units`);
const initialServices = await request("GET", `${root}/services`);
const members = units.map((unit) => {
  assert.equal(unit.unitResidents.length, 1, "Run this scenario against the five-owner demo fixture");
  return unit.unitResidents[0].id;
});
assert.equal(members.length, 5);
const currentProposals = await request("GET", `${root}/proposals`);
assert.equal(currentProposals.some((proposal) => proposal.status === "PENDING"), false,
  "An existing pending proposal must be resolved before rerunning this smoke scenario");

function payload(service) {
  const active = service.versions.filter((version) => version.active);
  assert.equal(active.length, 1);
  return {
    serviceId: service.id,
    createdByMembershipId: members[0],
    title: `${service.name} demo change ${runId}`,
    proposedVersion: {
      title: `${service.name} proposed terms`,
      monthlyAmountMinor: active[0].monthlyAmountMinor + 1000,
      currency: active[0].currency,
      billingPeriod: active[0].billingPeriod,
      configJson: { demo: true, scenario: "governance-smoke", runId },
    },
  };
}
async function create(service) {
  const proposal = await request("POST", `${root}/proposals`, payload(service), 201);
  assert.equal(proposal.status, "PENDING");
  assert.equal(proposal.proposedVersion.active, false);
  assert.equal(proposal.governanceSnapshot.totalVotingWeightBps, 10000);
  assert.equal(proposal.governanceSnapshot.quorumBps, 6000);
  assert.equal(proposal.governanceSnapshot.governanceThresholdBps, 6000);
  return proposal;
}
const votePath = (proposal) => `${root}/proposals/${proposal.id}/votes`;
const vote = (proposal, memberIndex, choice, status = 201) =>
  request("POST", votePath(proposal), { membershipId: members[memberIndex], choice }, status);

await request("POST", `${root}/proposals`, {}, 400);
await request("GET", `/buildings/not-a-uuid/proposals`, undefined, 400);
await request("GET", `/buildings/${missingId}/proposals`, undefined, 404);
const cleaning = initialServices.find((service) => service.name === "Cleaning");
const invalidService = payload(cleaning);
invalidService.serviceId = missingId;
await request("POST", `${root}/proposals`, invalidService, 404);
const invalidCreator = payload(cleaning);
invalidCreator.createdByMembershipId = missingId;
await request("POST", `${root}/proposals`, invalidCreator, 403);

// Approval plus concurrent votes from two different eligible units at the decision boundary.
let approved = await create(cleaning);
await request("POST", `${root}/proposals`, payload(cleaning), 409);
await request("POST", votePath(approved), { membershipId: missingId, choice: "APPROVE" }, 403);
await request("GET", `/buildings/${missingId}/proposals/${approved.id}`, undefined, 404);
approved = await vote(approved, 0, "APPROVE");
assert.equal(approved.status, "PENDING");
await vote(approved, 0, "APPROVE", 409);
approved = await vote(approved, 1, "APPROVE");
assert.equal(approved.tally.approvalWeightBps, 4000);
const racing = await Promise.all([
  raw("POST", votePath(approved), { membershipId: members[2], choice: "APPROVE" }),
  raw("POST", votePath(approved), { membershipId: members[3], choice: "APPROVE" }),
]);
assert.deepEqual(racing.map((result) => result.status).sort(), [201, 409]);
approved = await request("GET", `${root}/proposals/${approved.id}`);
assert.equal(approved.status, "APPROVED");
assert.equal(approved.votes.length, 3);
assert.equal(approved.tally.approvalWeightBps, 6000);
assert.equal(approved.proposedVersion.active, true);
await vote(approved, 4, "APPROVE", 409);

// Quorum alone is insufficient. Complete the ballot so the scenario leaves no pending proposal.
const security = initialServices.find((service) => service.name === "Security");
let quorumOnly = await create(security);
quorumOnly = await vote(quorumOnly, 0, "APPROVE");
quorumOnly = await vote(quorumOnly, 1, "APPROVE");
quorumOnly = await vote(quorumOnly, 2, "ABSTAIN");
assert.equal(quorumOnly.tally.quorumMet, true);
assert.equal(quorumOnly.tally.approvalMet, false);
assert.equal(quorumOnly.status, "PENDING");
quorumOnly = await vote(quorumOnly, 3, "REJECT");
assert.equal(quorumOnly.status, "PENDING");
quorumOnly = await vote(quorumOnly, 4, "REJECT");
assert.equal(quorumOnly.status, "REJECTED");
assert.equal(quorumOnly.proposedVersion.active, false);

// Reject early once remaining approval weight cannot reach the threshold.
const maintenance = initialServices.find((service) => service.name === "Maintenance");
let rejected = await create(maintenance);
rejected = await vote(rejected, 0, "REJECT");
rejected = await vote(rejected, 1, "REJECT");
assert.equal(rejected.status, "PENDING");
rejected = await vote(rejected, 2, "REJECT");
assert.equal(rejected.status, "REJECTED");
await vote(rejected, 3, "APPROVE", 409);

const finalServices = await request("GET", `${root}/services`);
for (const service of finalServices) {
  const active = service.versions.filter((version) => version.active);
  assert.equal(active.length, 1);
  if (service.id === cleaning.id) assert.equal(active[0].id, approved.proposedVersion.id);
  else {
    const original = initialServices.find((item) => item.id === service.id)
      .versions.find((version) => version.active);
    assert.equal(active[0].id, original.id);
  }
}

console.log(JSON.stringify({
  status: "ok", approvedProposalId: approved.id,
  approvedVersionId: approved.proposedVersion.id,
  approvalWeightBps: 6000, concurrentVoteStatuses: [201, 409],
  quorumWithoutApproval: "PENDING, then REJECTED after remaining votes",
  rejection: "REJECTED after three REJECT votes",
  validation: "400 / 403 / 404 / 409 verified",
  activeVersionPerService: 1,
  note: "Three demo proposals and their versions/votes were persisted",
}, null, 2));
