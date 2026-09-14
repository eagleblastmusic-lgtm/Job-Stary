# Deployment

## Supported executable MVP target

The executable MVP is currently a **single Docker instance with one persistent volume** when run in an environment where data durability matters. SQLite and private CV uploads deliberately share that volume. Do not scale this topology horizontally.

```bash
docker build -t job-app .
docker run -d --name job-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -v job-data:/app/data \
  --env-file .env \
  job-app
```

Put an HTTPS reverse proxy/load balancer in front of port 3000. Set `APP_ORIGIN=https://your-domain.example` and run `NODE_ENV=production`.

### Trusted proxy rule

`TRUST_PROXY` defaults to `false`. In that mode, rate limiting uses the socket peer address and ignores client-supplied `X-Forwarded-For` values.

Set `TRUST_PROXY=true` **only** when the application is reachable exclusively through a reverse proxy/load balancer that provides the real client address as the first `X-Forwarded-For` entry. When enabled, the application validates that first entry as an IPv4/IPv6 address before using it; invalid/missing forwarded addresses fall back to the socket peer address.

Do not enable `TRUST_PROXY` on a service that can also be reached directly by untrusted clients, because forwarded headers are meaningful only at an established trust boundary.

Production responses include HSTS, and all API responses are emitted with `Cache-Control: no-store` plus `Pragma: no-cache`. Browser mutations also reject Fetch Metadata requests classified as cross-site or same-site; non-browser clients without Fetch Metadata remain supported and are still subject to the existing Origin check when they send an `Origin` header.

## Administrator provisioning

Public registration never grants administrator privileges from an e-mail allow-list. The current MVP intentionally has no `ADMIN_EMAILS` privilege-grant mechanism because account creation does not yet verify ownership of an e-mail address.

Create the normal account first, then provision the role from an operator environment with direct access to the same database:

```bash
DATABASE_PATH=/app/data/job.sqlite npm run provision:admin -- admin@example.pl
```

The operation updates the persisted role and records `ADMIN_PROVISIONED_OUT_OF_BAND` in the audit log in the same transaction. There is no public HTTP endpoint for elevation. See `docs/ADMIN_PROVISIONING.md` for the full boundary. Administrator MFA remains a pre-broad-launch requirement.

## Render test staging blueprint

`render.yaml` defines a **free, disposable test environment only**. It is not the target production architecture and must not be treated as durable storage.

The Blueprint uses:

- Docker runtime from the repository `Dockerfile`,
- Frankfurt region,
- one free web-service instance,
- deploy from `main` only after repository CI checks pass,
- HTTP health check at `/api/health`,
- SQLite at `/app/data/job.sqlite`,
- private uploads below `/app/data/uploads`,
- `TRUST_PROXY=true` because the web service is reached through Render's ingress proxy,
- no persistent disk.

The application automatically uses Render's `RENDER_EXTERNAL_URL` as its same-origin security value when `APP_ORIGIN` is not explicitly set. A custom domain can still override it with `APP_ORIGIN`.

### Disposable-data rule

All Render staging state is intentionally disposable. A restart, redeploy, platform recycle or other lifecycle event may remove the SQLite database, accounts, applications and uploaded CV files. This is acceptable because Render is used only as a real-network execution test bed.

Do not use production credentials, irreplaceable data or real candidate CVs for this environment. Use synthetic/test accounts and fixtures. Data persistence is verified separately by repository backup/restore tests and will be designed again for the eventual production infrastructure.

### Staging acceptance sequence

After the service is created from the Blueprint, run the disposable automated smoke flow:

```bash
STAGING_URL=https://job-mvp-staging.onrender.com npm run smoke:staging
```

The smoke command checks health/legal surfaces, creates a unique synthetic account with analytics disabled, exercises profile → Career Truth → job parser → Decision Engine → application → outcome → export, and finally logs out the synthetic session. It intentionally does not bypass the password re-authentication required by the real account-deletion flow. Synthetic records may remain until the disposable Render filesystem is recycled.

For each staging acceptance run:

1. confirm the deployed commit is the intended `main` revision,
2. confirm `/api/health` returns HTTP 200 and reports `database: "ok"`,
3. confirm the smoke command ends with `STAGING_SMOKE_OK` and `STAGING_SMOKE_SESSION_CLEANUP_OK`,
4. exercise one browser flow from registration through Decision Card on mobile and desktop widths,
5. inspect recent service logs for uncaught errors,
6. confirm synthetic CV/raw job text is not emitted to product analytics or general logs,
7. confirm rate limiting distinguishes synthetic requests with different platform-forwarded client addresses rather than collapsing all clients onto the proxy socket address,
8. treat synthetic records remaining after the run as expendable and never use persistence across Render lifecycle events as an acceptance requirement.

The repository CI already exercises lint, strict TypeScript, migration validation, API/unit tests, semantic backup/restore to another filesystem root, Chromium E2E on desktop/mobile, production container build and container smoke test. Render staging is an additional real-host/network gate, not a replacement for CI.

## Health

`GET /api/health`

## Data lifecycle

For a durable single-instance Docker deployment outside disposable staging:

- SQLite: `/app/data/job.sqlite`
- private uploads: `/app/data/uploads/<user-id>/...`

Back up the full volume consistently. Before destructive database changes, snapshot the volume and verify restoration.

For Render test staging, those same paths live only on the service's ephemeral filesystem and are intentionally not a backup source.

## Migration to production-scale architecture

Before external beta on stateless/horizontally scaled hosting:

1. migrate schema to PostgreSQL,
2. move uploads to private S3-compatible storage,
3. replace in-process rate limiter with shared rate limiting,
4. connect managed error/analytics services,
5. configure payment provider and managed auth if selected,
6. run E2E against staging and then production smoke tests.

The free Render test target does **not** satisfy any production durability requirement by itself.
