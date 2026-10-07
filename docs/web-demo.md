# CondoProof browser demo

The Next.js App Router UI uses Phantom's injected Solana provider for message signing. No wallet SDK dependency or embedded wallet has been added. The API has no signer. Authorized Devnet anchoring remains a separate local CLI action.

## Run locally

API (a separate terminal, restart an existing process before starting another):

```bash
cd /home/master/DDEV/CondoProof/apps/api
DEMO_GOVERNANCE_ENABLED=true WALLET_AUTH_ORIGIN=http://localhost:3000 npm run start:dev
```

Web (another terminal):

```bash
cd /home/master/DDEV/CondoProof
npm run web:dev -- --hostname 127.0.0.1 --port 3000
```

Open http://localhost:3000. The browser origin must match both `CONDOPROOF_WEB_ORIGIN` in the web process and `WALLET_AUTH_ORIGIN` in the API process. The defaults are localhost:3000; do not browse 127.0.0.1:3000 unless both are deliberately changed. If port 3000 is occupied, free it or explicitly configure the same new origin in both processes.

The server proxy defaults to http://127.0.0.1:3001; optional configuration is shown in apps/web/.env.demo.example. It allows only specific GET and POST routes, rejects cross-origin writes and redirects, bounds request/response sizes, and forwards a bearer session server-side. The browser gets an HttpOnly, SameSite=Strict session cookie (Secure for HTTPS). No bearer token is exposed in JSON or localStorage. Backend authorization remains authoritative.

## Enroll a real browser wallet

The existing finalized multi-owner proof uses discarded test keys and is read-only evidence. It cannot be used for new browser signatures. The original five-unit seeded building requires every eligible owner's wallet enrollment before a signed proposal can be created.

For an isolated single-owner browser demonstration, click Connect Phantom and copy the PUBLIC address shown in the header, then run explicitly:

```bash
cd /home/master/DDEV/CondoProof/apps/api
npx --no-install tsx scripts/setup-web-demo.ts YOUR_PUBLIC_PHANTOM_ADDRESS
```

The helper accepts no private key, operates only on a loopback database outside production, and creates one unit with 10000/10000 voting weight and 100% quorum/approval thresholds plus three demo services. It does not alter existing seed data. Repeat enrollment preserves existing state; if the wallet is already enrolled elsewhere, it returns that building without modifying its policy. Refresh the browser, connect/sign in again, and choose Open my building.

This single participant demonstration is visibly labeled. It is not evidence of approval by multiple owners or certified property ownership.

## Browser validation

1. Open the featured verified demo without a wallet. Payload fingerprint, signatures/policy, and finalized Devnet should verify; real-world enrollment remains not verified.
2. Download proof JSON. Its shape is the raw payload accepted by scripts/verify-signed-proof.ts. Copy the trusted fingerprint separately. Upload the original JSON to the page and verify; modify a signed amount or signature in a copy and confirm rejection.
3. Enroll your public Phantom address using the helper, then sign in. Confirm the cookie is HttpOnly and the verify response contains no bearer token.
4. Open your building, create a service proposal, review immutable terms, request a ballot message and approve its exact bytes in Phantom. In the single-owner fixture one approval meets the 100% threshold.
5. Create/open the proof. It should verify signatures but show an unanchored chain state. Copy the commitment UUID from the page URL.
6. The authorized operator can anchor it explicitly with `tsx scripts/anchor-commitment.ts COMMITMENT_UUID` from apps/api, then run `tsx scripts/chain-verification-smoke.ts COMMITMENT_UUID`. Recheck Devnet on the page.
7. Change wallet accounts or disconnect; signing actions must require login again. Try cancelling a Phantom signature; the proposal must remain unchanged. Sign out and confirm /auth/me returns 401.

## Checks

```bash
cd /home/master/DDEV/CondoProof
npm run lint --workspace apps/web
npm run web:build
node --experimental-strip-types --test apps/web/scripts/backend-proxy.test.mjs
cd apps/api
npm run build
npm test
```

Proxy tests use an injected upstream to check route restrictions, CSRF, body bounds, token redaction, cookie expiry, error handling and authorization forwarding. Mock browser checks do not replace a real Phantom signature or live Devnet verification.

This is a local hackathon demo, not a public-production authentication rollout. The existing DemoGovernanceGuard rejects production-mode API governance; exposing the web server would expose allowlisted local demo operations. Public deployment requires a deliberate authorization and dependency-audit review.

Enrollment is a registrar assertion. Off-chain cryptographic verification and chain inclusion are separate checks. The Solana writer is trusted to anchor commitments, the RPC is a configured trust source, and the program remains upgradeable.
