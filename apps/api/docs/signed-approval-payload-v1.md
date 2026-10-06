# Signed approval proof v1

Domain: `condoproof/approved-service-version/wallet-signed/v1`.
Canonicalization: existing `condoproof-jcs-v1`, SHA-256 UTF-8 canonical JSON.
Unsigned v1 encoding and hashes are unchanged.

## Creation

`POST /buildings/:buildingId/signed-proposals/:proposalId/commitments`.
Requires demo mode and an authenticated wallet session in the same building.
Only APPROVED WALLET_SIGNED proposals are accepted. Creation rechecks frozen proposal hash,
every ballot's Ed25519 signature, identity, exact message bytes, one vote per unit,
and weighted quorum/approval. A building row lock serializes concurrent requests.
Existing source contentHash must match; repeated requests return the same commitment.

## Exported verification

The payload includes the frozen electorate/wallets, full service terms, proposal signingHash,
ballots/signatures/messages and computed result. `verifySignedApprovalPayload` reconstructs
source from JSON, verifies cryptography/policy, rebuilds the complete canonical payload,
and compares hashes; unknown fields or inconsistent domains/results fail.
This pure function requires no database or live sessions. Check the outer hash against a
trusted published commitment to establish proof identity.

`tsx scripts/verify-signed-proof.ts payload.json <trusted-commitment-hash>` exits 1 on failure.
Existing GET commitment, GET verification and POST verify-payload endpoints support both modes.
`authorizationVerified` is true only if supplied/stored payload matches the expected commitment
hash AND independent signed-proof verification succeeds. `sourceMatches` is a separate DB check.

## Trust boundaries

Authorization means consent by keys registered in the frozen electorate under that policy.
It does not certify real-world property ownership or correctness of registrar enrollment.
`enrollmentVerified` remains false. The proposal creator authenticates via wallet session;
this proof contains signed ballots, not a separate creator signature.
`onChainVerified` remains false, chain status PENDING, signature/slot null: no RPC submission.
The exported electorate includes linkable UUIDs and public wallet keys. Keep the full payload
off chain; publish only hashes in the later anchoring step. Demo endpoints remain loopback-only.
