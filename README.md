# CondoProof

**Exact terms. Signed votes. Public evidence.**

CondoProof helps condominium associations and residential communities record what owners approved: the service terms, the eligible voters, the voting policy and the signed ballots. Anyone can check the resulting evidence against a fingerprint recorded on Solana Devnet.

## Try the deployed prototype

- [Public application](https://condoproof.space/)
- [Completed public HTTPS voting proof](https://condoproof.space/verify/6bc55f7c-a0ad-45c1-800c-b675e27b7c8a/87cc14a8-adf7-4c31-980f-afb1ea0f3833)
- [Devnet transaction](https://explorer.solana.com/tx/2F9hRRcfQ8yDpxYGYmrDBFuPXiu5n4CG9GkaWYJVLdzFuzS9UQ3X5ZJYGQ6oKjDpYUXi84nzic3i5WnLuJD4xVW3?cluster=devnet)

Public verification requires no wallet. To sign in or vote, use an enrolled Solana account in Phantom's desktop extension or Phantom's in-app mobile browser. A regular mobile browser without Phantom's injected provider cannot connect through this prototype.

These are controlled demonstrations, not customer traction or independently certified property ownership. The completed public proof above is a single-owner test. The separate three-account weighted demonstration uses 50% / 30% / 20%, an 80% approval threshold and 60% quorum; those are demonstration settings, not statutory rules.

## What works

1. An enrolled owner signs a wallet challenge to establish a session.
2. The owner proposes a new version of a community service's terms.
3. The proposal freezes its terms, eligible units, weights and governance policy.
4. Eligible owners review and sign their exact ballot messages in Phantom. Each eligible unit can cast one ballot per proposal.
5. The API checks signatures, eligibility, approval weight and quorum. An approved proposal produces an exportable proof.
6. The authorized building operator explicitly anchors the proof with a separate local CLI.
7. Public verification checks the payload fingerprint, signed ballots and policy, source/version hashes, and the matching finalized Devnet account.

Approval and chain confirmation are distinct. Creating a proof does not submit a Solana transaction. `Not anchored` is expected until the operator anchors it; an RPC outage is reported as unavailable rather than a failed transaction.

## Why Solana

Solana provides a public reference for the decision fingerprint that can be checked independently of the application's database. The custom Anchor program records commitment identifiers and hashes under a configured writer authority. Verification derives the expected accounts and checks finalized account data and program ownership.

The program **does not execute the voting policy**, certify property ownership or prove that a service was delivered. It remains upgradeable. Full terms and signed ballots remain off-chain; no resident names, private keys, invoices or documents are stored in program accounts.

## Architecture

| Component | Responsibility |
| --- | --- |
| Next.js / React / TypeScript | Governance workspace and public proof viewer |
| Server-side web proxy | Allowlisted API routes, origin checks, bounded payloads, HttpOnly session cookie |
| NestJS / Node.js | Wallet authentication, proposal authorization and evidence verification |
| PostgreSQL / Prisma | Operational records, frozen governance snapshots and signed ballots |
| Rust / Anchor / Solana Devnet | Authorized fingerprint anchoring |
| Local operator CLI | Explicit Devnet writes; signer is not installed in the public API |
| Docker Compose / Nginx / HTTPS | Web-facing deployment with private API and database networks |

Voting weight, ownership share and cost allocation are separate concepts. The current prototype implements voting weight. Enrollment is asserted by a registrar. A wallet is currently associated with one resident/building; cross-community ownership management is future work.

## Run locally

Requirements: Node.js 24, npm and Docker Compose. Rust, Anchor and Solana CLI are needed only for program development, not for running the web/API or reading an existing proof.

```bash
npm ci

test -f apps/api/.env || cp apps/api/.env.example apps/api/.env

docker compose up -d --wait postgres

npm run db:generate --workspace apps/api
npm run shared:build

(cd apps/api && npx --no-install prisma migrate deploy --config prisma7.config.ts)

npm run dev
```

Open **http://localhost:3010**. The development scripts use API port **3011**, bind locally and configure matching wallet/web origins. API health is http://127.0.0.1:3011/health; the API root `/` has no route and returns 404.

The root Compose file is a local development fixture. Use the isolated configuration in [deploy/compose.production.yml](deploy/compose.production.yml) for deployment; do not deploy the development database credentials or expose its port publicly.

A new database has no completed proofs. For an isolated browser demonstration, enroll a **public** Phantom address:

```bash
cd apps/api
npx --no-install tsx scripts/setup-web-demo.ts YOUR_PUBLIC_PHANTOM_ADDRESS
```

The setup CLI creates a single-owner fixture only on a loopback database outside production. It preserves an existing enrollment. It accepts no seed phrase or private key. Refresh the application and sign in with that account.

## Verify and test

```bash
npm run lint --workspace apps/web
npm run web:build
node --experimental-strip-types --test apps/web/scripts/*.test.mjs
npm run api:build
npm test --workspace apps/api
git diff --check
```

Proxy tests cover route restrictions, origin checks, payload bounds, session handling and token redaction. Proof-status tests distinguish unsubmitted evidence, submitted transactions, finalized verification and RPC failure. API tests cover canonical hashes, signed approval payloads, governance policy, authorization boundaries and account verification.

For browser validation, open a completed proof, download its JSON, and upload the original payload. Then alter a signed term or signature in a copy and confirm verification rejects it. A modified local file does not change the stored decision.

See [docs/web-demo.md](docs/web-demo.md) for the Phantom workflow and explicit operator anchoring. Anchoring uses Devnet and a pinned building authority; it is not an automatic browser action.

## Scope and trust boundaries

Implemented: signed service proposals, weighted approval/quorum, exportable evidence, authorized Devnet anchoring and public verification.

Future work: tenders and vendor bids, payments or escrow, challenge windows, dispute resolution, documented service acceptance, legal ownership verification and multi-community membership. These are not implemented in this submission.

Unsigned building/proposal/vote/commitment writes are restricted to explicit non-production local demo mode. Production signed routes require wallet authorization; public proof reads remain available. Never commit environment files, wallet keys, session data or database backups.

A previous runtime audit reported four moderate findings in the Solana SDK dependency chain; these remain open and must be reassessed for each release. See [docs/deployment.md](docs/deployment.md) for the recorded audit checkpoint and operational configuration. The prototype is not a legal ownership registry or an audited payment system.

## Repository

- `apps/web` — Next.js application and server proxy
- `apps/api` — NestJS API, Prisma schema/migrations and operator scripts
- `packages/shared` — shared TypeScript contracts
- `programs/condoproof` — Anchor program
- `deploy` — production containers, environment examples and Nginx configuration
- `docs` — architecture, deployment and demonstration instructions

## Development assistance

Built by Besarion Archvadze, with ChatGPT/Codex assistance for planning, implementation, troubleshooting, testing and submission preparation. Demonstration wallet accounts are controlled test participants; they do not represent independent customer adoption.
