# Local transaction validation

Run `bash scripts/run-solana-local-smoke.sh` from the repository.
Requires Node, npm, Python 3, solana-test-validator, and an existing `anchor build` output.

The runner creates a fresh temporary ledger, preloads the compiled `.so`, and uses loopback
RPC 18899 (WebSocket 18900) and faucet 18901. It refuses occupied RPC/faucet ports.
It never uses the configured Solana CLI wallet or changes cluster settings.
Test signing keys are generated in memory. SDK `@solana/web3.js@1.98.4` is installed with
lifecycle scripts disabled in a temporary prefix; repository dependencies/lockfile are unchanged.
The process started by the runner is stopped by its EXIT trap. Successful-run temporary data
is deleted; failed-run validator logs are retained for diagnosis. No existing ledger is reset.

Checks:
- IDL program identity, instruction discriminators/account ordering and account discriminators.
- Two buildings for one authority produce distinct, correctly decoded accounts.
- Funded outsider is rejected with program error 6000.
- Missing authority signature is rejected with Anchor error 3010.
- Authorized write is sent and confirmed, then owner/schema/hash/slot/bump fields are decoded.
- Same proposal in another building is allowed and has a separate commitment PDA.
- Wrong building/commitment PDA is rejected with Anchor ConstraintSeeds 2006.
- Duplicate and changed-payload writes are submitted (preflight disabled), rejected and compared
  against original account bytes. A unique second instruction prevents false results caused by
  RPC transaction deduplication.
- Each zero digest is submitted, rejected with 6001, and its account initialization rolls back.
- Zero building digest is rejected in simulation.

Local success validates account constraints and rollback in the compiled program.
It does not verify a real Devnet deployment, PostgreSQL integration, resident signature proofs
or a trusted building registrar. Database `onChainVerified` remains false until later Devnet
RPC/account verification is implemented. Test fixtures use random hashes, not real proposal data.
