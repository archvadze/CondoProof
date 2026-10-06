# CondoProof commitment payload v1

This version is an unsigned local demo proof. It binds database content and
records the frozen weighted approval result. It does not establish wallet
authorization and has not been anchored to Solana.

## Canonical serialization

Profile identifier: `condoproof-jcs-v1`. Serialize a validated JSON data model
with recursively sorted object property names (UTF-16 code-unit order), no
whitespace, ECMAScript JSON primitive serialization and preserved array order.
Do not normalize Unicode. Reject lone surrogates, non-finite numbers,
unsupported JavaScript values, sparse arrays, accessors and cycles. Enforce
depth/node limits. SHA-256 input is the UTF-8 encoding of the canonical string.
Hashes use 64 lowercase hexadecimal characters; no prefix and no trailing newline.

The sorting, string and numeric serialization rules follow RFC 8785:
https://www.rfc-editor.org/rfc/rfc8785.html

Input is an already parsed JSON data model, not arbitrary original JSON text.
Money is an integer minor-unit amount. JS floating-point semantics apply to
other JSON numbers; encode precision-sensitive future values as strings.

## Two separate hashes

- `ServiceVersion.contentHash`: hash of `condoproof/service-version/v1` payload.
  It includes building/service/version IDs, version number, terms, monetary
  amount, currency, billing period, effective date and config JSON.
- `Commitment.commitmentHash`: hash of
  `condoproof/approved-service-version/unsigned-demo/v1` payload. It includes
  Solana Devnet/program domain, proposal identity, version content and its hash,
  frozen policy/electorate, unit ballots and the approval result.

Activation flags, on-chain status/signature/slot and commitment creation time
are excluded. Reconstructing a historical approved version remains possible
after a later version becomes active. Service version's own stored contentHash
is excluded from its content payload to prevent a circular hash.

Order eligible units and ballots by unit ID; order co-owner memberships by
membership ID, using ordinal string comparison. Config array order is preserved.

## Storage and verification

Store the structured approval payload in `Commitment.metadata.payload`.
PostgreSQL JSONB key reordering does not change the canonical hash. The API
derives the payload from server records and rejects non-approved or inconsistent
proposals. Its create operation takes the building row lock and reuses an
existing matching commitment. The unique commitmentHash constraint is retained.

Verification reports content integrity, current-source agreement and version
hash agreement separately. `authorizationVerified` and `onChainVerified` are
false in this version. `PENDING` means no confirmed Solana transaction exists.

All these endpoints require the existing demo guard. Payload metadata contains
internal resident/membership IDs; it stays off-chain. A later public verifier
needs an explicit disclosure policy. Only the selected minimal proof/hash may
be committed on-chain, never the complete payload or private data.

## Next authorization version

Unsigned proof bytes must not be relabeled as signed authorization. A signed
flow needs its own domain/version, frozen wallet eligibility and exact proposal
message bytes before ballots are accepted. Verify signatures before approval.
Anchor authorization constraints and finalization policy remain future work.
