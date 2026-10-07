# Devnet anchoring and independent account verification

The Anchor program is deployed at `3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF`.
Pinned building authority: `3P8pfpaCPZLhPLGysNk8m9gC4diYig7HPqh5qqYT5xoK`.
Devnet genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
The authority is a public trust configuration in source, not a value accepted from a caller,
commitment metadata or an exported proof. Changing it requires a reviewed code change.

## Local writer

1. Restart demo API: `DEMO_GOVERNANCE_ENABLED=true npm run start:dev`.
2. `npx --no-install tsx scripts/prepare-devnet-proof.ts` creates an isolated building with five
   explicitly simulated owners, authenticates ephemeral wallets, collects three real Ed25519
   signed approvals via HTTP and stores a verified signed commitment. Fixture data is retained
   for the demo; private owner keys are discarded and fixture sessions/challenges removed.
   Successful repeated preparation reuses its existing valid commitment. Original seed is unchanged.
3. `npx --no-install tsx scripts/anchor-commitment.ts <commitment-id> [local-wallet-keypair-path]`.
   The wallet file defaults to `~/.config/solana/id.json`. It is read only by this local CLI,
   after source/proof/cluster/program preflight. Its public key must equal the pinned authority.
   The CLI writes Devnet transactions (account rent and fees), initializes the authority-scoped
   building if missing and records the signed proposal proof. No key upload or API signer exists.
4. Repeat the anchor command to reconcile without another write when account hashes already match.
5. `npx --no-install tsx scripts/chain-verification-smoke.ts <commitment-id>` checks the DB state,
   independently reads RPC and checks all API verification surfaces plus tamper rejection.

The writer revalidates stored signatures, frozen weighted policy, source hash and version hash
before sending. A failed/uncertain network operation never blindly marks FAILED or CONFIRMED.
An existing finalized account is accepted only if all identity/hash fields match.
CONFIRMED and solanaSlot are saved only after finalized account verification. solanaSlot is the
program's creation slot. A recovered write may have no known signature; verification uses account
state, and solanaSignature is optional. Concurrent writes are reconciled with the same rules.
No update, close, authority rotation or migration is introduced.

## Read-only API

GET commitment, GET verification and POST verify-payload recompute chain verification at read time.
The creation response keeps onChainVerified false because no chain read is performed in the write
transaction. Use the verification endpoint for current chain state. The API never reads wallet keys.
`onChainVerified` is independent of database status/signature/slot. A forged CONFIRMED value cannot
produce a true verdict. Unsigned or tampered proofs are refused before RPC account reads.
`sourceMatches` and `versionHashMatches` remain separate DB consistency checks.

Default RPC is `https://api.devnet.solana.com`. Optional `SOLANA_RPC_URL` must be HTTPS;
credentials in URLs and redirects are rejected. Query-string provider keys are accepted as operator
configuration but never echoed in errors. The RPC response is still trusted: this is RPC-backed
verification, not a validator/light-client proof. Genesis is checked on each verification.
Two bounded HTTP reads take up to about 16 seconds on failure; no success cache is used.

Accounts are batched with `getMultipleAccounts` at finalized commitment, from the same bank snapshot:
- executable program account owned by the expected upgradeable loader;
- canonical building PDA, program owner, 73-byte length, discriminator, trusted authority, hash, bump;
- canonical commitment PDA, program owner, 146-byte length, discriminator, schema version,
  building link, proposal signingHash, full proof hash, service version hash, bump and creation slot;
- creation slot must be positive and no greater than the finalized snapshot slot.

`chainVerification.reason`: VERIFIED, NOT_ANCHORED, INVALID_ACCOUNTS, WRONG_CLUSTER,
RPC_UNAVAILABLE or UNSUPPORTED_PROOF. Unavailability returns false, not stale success.
`authorizationVerified` still requires independent signed proof verification.
`enrollmentVerified` remains false: simulated/trusted registrar enrollment is not property ownership.
Only public authority and digests are on chain; the full exported electorate/proof remains off chain.

## Upgrade boundary

The program remains upgradeable. This verifier checks account identity/owner/layout/digests; it does
not pin the deployed binary or certify future program behavior against the source. The authorized
writer and upgrade authority remain trust boundaries. Do not market this as permissionless on-chain
voting or irreversible consent enforcement against upgrades.
