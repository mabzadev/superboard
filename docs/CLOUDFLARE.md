# Cloudflare targets and rollout

## Isolation contract

Each target has one manifest in `deploy/targets`. Production is required; staging
is optional and may be omitted for production-only accounts such as Vocostar.
Secret values are never accepted by the schema. `OPENGROW_TARGET` selects the
manifest in Workers Builds.

Vocostar uses the canonical production names `opengrow-db` for D1, `opengrow` for
KV and the single R2 bucket, and `opengrow-*` for queues. The API and dashboard
share the same R2 bucket through separate bindings.

## Workers Builds

Connect `mbzadev/opengrow` independently from every Cloudflare account by
installing the Cloudflare GitHub App in that account. Configure both Workers with
repository root `/` and a target-scoped build variable `OPENGROW_TARGET`.

After that one-time GitHub App authorization, the repository connection, build
tokens, production triggers and watch paths are configured idempotently. Preview
triggers are added only when the target manifest explicitly defines staging:

```bash
CLOUDFLARE_BUILDS_API_TOKEN=... npm run cloudflare:connect-builds -- \
  --target vocostar --service api
CLOUDFLARE_BUILDS_API_TOKEN=... npm run cloudflare:connect-builds -- \
  --target vocostar --service dashboard
```

API Worker:

- production branch: `main`
- build: `npm ci && npm run worker:typecheck && npm run worker:test`
- deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service api --environment production`
- optional preview deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service api --environment staging --upload-only`
- watch: `workers/api/**`, `packages/shared/**`, `deploy/**`, `scripts/**`, root lockfiles

Dashboard Worker:

- production branch: `main`
- build: `npm ci && npm run dashboard:typecheck && npm run dashboard:test`
- deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service dashboard --environment production`
- optional preview deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service dashboard --environment staging --upload-only`
- watch: `apps/dashboard/**`, `packages/shared/**`, `deploy/**`, `scripts/**`, root lockfiles

Use a Cloudflare API token restricted to the target account. Runtime values belong
in Worker secrets; build variables are not runtime secrets.

## Private full-access registration

Each deployment declares its access policy in `deploy/targets/<target>.json`.
Private deployments use `accessMode: "full"`, `registrationMode: "allowlist"`
and `ssoEnabled: false`. The allowlist realm is derived from the target and
environment (for example `vocostar:production`), so two deployments remain
isolated even if they accidentally share a D1 database.

Manage exact email addresses directly against the target D1 with Cloudflare
authentication. No administrator key or email list is stored in the dashboard:

```bash
npm run allowlist -- add --target vocostar --environment production \
  --email user@example.com
npm run allowlist -- revoke --target vocostar --environment production \
  --email user@example.com
npm run allowlist -- list --target vocostar --environment production
```

API deployment applies additive migrations and runs `bootstrap` automatically.
That action authorizes existing users in the deployment realm and enables revenue
collection for every instance in full-access mode. It is idempotent and can also
be run explicitly:

```bash
npm run allowlist -- bootstrap --target vocostar --environment production
```

## Transactional email

Password recovery and dashboard invitations use Cloudflare Email Sending through
the API Worker's `EMAIL` binding. Each target manifest declares the only allowed
sender address. Before deploying a new target, enable Email Sending for its domain
and publish the SPF, DKIM, return-path and DMARC records returned by Cloudflare:

```bash
npx wrangler email sending enable example.com
npx wrangler email sending dns get example.com
```

Create new target manifests with an explicit sender, for example
`--mail-from-address noreply@example.com`. No provider API key is stored in D1,
the dashboard or the repository.

## Vocostar production deployment

Vocostar is production-only. Its canonical Workers are `opengrow-api` and
`opengrow`; no Vocostar staging resource belongs in Cloudflare.

1. Deploy both new Workers with `--preflight`. This omits custom domains, API queue
   consumers and API cron triggers while keeping direct `workers.dev` health checks
   available. Upload their runtime secrets and validate them directly.
2. Export production D1, rotate dashboard OAuth, then deploy the production API
   config with routes and queue consumers.
3. Deploy the dashboard production config with `grow.vocostar.com`.
4. Verify `go.vocostar.com`, `sdk.vocostar.com`, `grow.vocostar.com`, queue backlog,
   D1 row counts and purchase reconciliation.
5. Remove superseded Workers and Pages only after the production checks pass.

Never run a production bootstrap that creates replacement storage for an existing
target. The manifest's explicit production IDs are the guardrail.
