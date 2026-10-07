# CondoProof deployment

Public origin: https://condoproof.space

Build images on the development machine, not the 1 GiB Oracle VPS.
The build stage runs API tests, web lint, proxy tests and the web build.
Runtime API and web images install production workspace dependencies.
The migration image contains build tools and runs only as a one-off task.

## Network

Nginx forwards to the web container through 127.0.0.1:3010.
Web calls http://api:3011 on the application network.
API and PostgreSQL share a separate internal database network.
API and PostgreSQL have no published host ports.
No Solana signer is copied into any image.

## Environment files

On the VPS:
- /opt/condoproof/deploy/api.env
- /opt/condoproof/deploy/web.env
- /opt/condoproof/deploy/db.env

Set permissions to 600. Use one generated database password in
api.env DATABASE_URL and db.env POSTGRES_PASSWORD.
Examples contain placeholders and must not be used directly.
Set CONDOPROOF_IMAGE_TAG explicitly when invoking Compose.

## Deployment order

1. Build and test images locally.
2. Review production dependency audit results.
3. Test the container stack locally with an isolated database.
4. Back up and transfer the intended demo data; exclude auth sessions.
5. Transfer images and configuration to the VPS.
6. Start PostgreSQL, restore into an empty database, then run migrations.
7. Start API and web; check health and memory use.
8. Issue certificates for the root and www domains.
9. Validate the dedicated Nginx configuration, then reload.
10. Check HTTPS, Phantom login, signed voting and public verification.

Existing local workflows still use loopback binding by default.
Docker API binding requires CONDOPROOF_API_BIND_HOST=0.0.0.0.
Demo mode rejects non-loopback binding.

## Resource limits

The initial limits are DB 128 MiB, API 256 MiB and web 256 MiB.
These are starting limits, not verified capacity estimates.
Measure actual use before enabling public traffic.
Do not build images on the VPS or restart unrelated containers.
Do not run docker compose down -v; it deletes the database volume.

## Verified deployment checkpoint: 2026-10-07

Deployment image tag: deploy-v3.

- API: 97 unit tests passed.
- Web: lint, production build and 14 proxy tests passed.
- Isolated container stack: migrations, health, database access and HTTP authorization passed.
- Migration image: OpenSSL 3 detected; all four migrations applied.
- API runtime omits optional dependencies, including Prisma CLI.
- Prisma Client and PostgreSQL adapter remain installed.
- API runtime audit: 0 critical, 0 high, 4 moderate.
- Web runtime audit: 0 vulnerabilities.
- Real database query and finalized signed Devnet proof passed twice.
- Observed API memory during verification: 134.7–162.7 MiB of 256 MiB.

Remaining moderate reports are in the Solana SDK dependency chain:
@solana/web3.js, jayson, stream-json and uuid.

The reviewed API verification path uses PublicKey for PDA derivation,
and native fetch/response.json for RPC. The inspected Jayson browser
client uses uuid.v4 and JSON.parse. Vulnerable streaming parser and
UUID v3/v5/v6 buffer APIs were not observed on that path.
This is a limited usage review; the audit reports remain open.
Reassess when SDK versions or usage change.

Relevant advisories:
- https://github.com/advisories/GHSA-w5hq-g745-h8pq
- https://github.com/advisories/GHSA-mjw6-4jj6-33hc

Transfer a consistent database snapshot with authentication challenge
and session data excluded. Validate restoration before public deployment.
Never commit real environment files, credentials or database archives.
