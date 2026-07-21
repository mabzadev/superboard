# Cloudflare targets and rollout

## Isolation contract

Each target has one manifest in `deploy/targets`. It defines separate staging and
production Workers, D1, KV, R2 and queues. Secret values are never accepted by the
schema. `OPENGROW_TARGET` selects the manifest in Workers Builds.

For Vocostar the production storage identifiers are intentionally the existing
resources. Their historical infrastructure names are opaque Cloudflare IDs and do
not expose a compatibility API. Staging uses OpenGrow-prefixed resources.

## Workers Builds

Connect `mbzadev/opengrow` independently from every Cloudflare account by
installing the Cloudflare GitHub App in that account. Configure both Workers with
repository root `/` and a target-scoped build variable `OPENGROW_TARGET`.

After that one-time GitHub App authorization, the repository connection, build
tokens, production/preview triggers and watch paths are configured idempotently:

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
- preview deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service api --environment staging --upload-only`
- watch: `workers/api/**`, `packages/shared/**`, `deploy/**`, `scripts/**`, root lockfiles

Dashboard Worker:

- production branch: `main`
- build: `npm ci && npm run dashboard:typecheck && npm run dashboard:test`
- deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service dashboard --environment production`
- preview deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service dashboard --environment staging --upload-only`
- watch: `apps/dashboard/**`, `packages/shared/**`, `deploy/**`, `scripts/**`, root lockfiles

Use a Cloudflare API token restricted to the target account. Runtime values belong
in Worker secrets; build variables are not runtime secrets.

## Vocostar blue/green

1. Provision staging idempotently and deploy both staging Workers.
2. Apply migrations and run purchase, restore, OAuth, dashboard, queue and data
   isolation tests against `workers.dev` previews.
3. Deploy both new Workers with `--preflight`. This omits custom domains, API queue
   consumers and API cron triggers while keeping direct `workers.dev` health checks
   available. Upload their runtime secrets and validate them directly.
4. Export production D1, rotate dashboard OAuth, then deploy the production API
   config with routes and queue consumers.
5. Deploy the dashboard production config with `grow.vocostar.com`.
6. Verify `go.vocostar.com`, `sdk.vocostar.com`, `grow.vocostar.com`, queue backlog,
   D1 row counts and purchase reconciliation.
7. Keep the prior Worker and Pages project without routes for seven days. Rollback
   reattaches the previous routes/version; no database or storage resource is
   deleted.

Never run a production bootstrap that creates replacement storage for an existing
target. The manifest's explicit production IDs are the guardrail.
