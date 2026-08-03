# Cloudflare targets and rollout

## Isolation contract

Each deployment target has one manifest under `deploy/targets`. Production is required; staging is optional. Secret values are rejected by the manifest schema. `OPENGROW_TARGET` selects the manifest used by Workers Builds.

Storage, queues, Workers, domains, registration realms, and OAuth applications are target-scoped. An accidental shared resource must not allow one target to authenticate, read, or mutate another target.

## Workers Builds

Connect the repository independently from each Cloudflare account through the Cloudflare GitHub App. Configure repository root `/` and a target-scoped `OPENGROW_TARGET` build variable.

```bash
CLOUDFLARE_BUILDS_API_TOKEN=... npm run cloudflare:connect-builds -- \
  --target <target> --service api
CLOUDFLARE_BUILDS_API_TOKEN=... npm run cloudflare:connect-builds -- \
  --target <target> --service dashboard
```

API Worker:

- production branch: `main`;
- build: `npm ci && npm run worker:typecheck && npm run worker:test`;
- deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service api --environment production`;
- optional preview: the same command with `--environment staging --upload-only`;
- watch paths: API, shared packages, deployment configuration, scripts, and root lockfiles.

Dashboard Worker:

- production branch: `main`;
- build: `npm ci && npm run dashboard:typecheck && npm run dashboard:test`;
- deploy: `npm run cloudflare:deploy -- --target $OPENGROW_TARGET --service dashboard --environment production`;
- optional preview: the same command with `--environment staging --upload-only`;
- watch paths: dashboard, shared packages, deployment configuration, scripts, and root lockfiles.

Use a Cloudflare API token restricted to one target account. Build variables are not runtime secrets.

## Private full-access registration

Private deployments use:

- `accessMode: "full"`;
- `registrationMode: "allowlist"`;
- `ssoEnabled: false`.

The allowlist realm is derived from the target and environment. Manage exact addresses directly against the target D1 database:

```bash
npm run allowlist -- add --target <target> --environment production --email user@example.com
npm run allowlist -- revoke --target <target> --environment production --email user@example.com
npm run allowlist -- list --target <target> --environment production
npm run allowlist -- bootstrap --target <target> --environment production
```

No administrator key or email list is stored in the dashboard.

## Transactional email

Password recovery and dashboard invitations use the API Worker's `EMAIL` binding. Each target manifest declares the only allowed sender address. Enable Email Sending and publish the Cloudflare-provided SPF, DKIM, return-path, and DMARC records before deployment.

```bash
npx wrangler email sending enable example.com
npx wrangler email sending dns get example.com
```

No email-provider API key is stored in D1, the dashboard, or the repository.

## Production rollout

1. Deploy new Workers with `--preflight`. This omits custom domains, API queue consumers, and cron triggers while allowing direct health validation where configured.
2. Upload runtime secrets and validate private service readiness.
3. Export production D1 and rotate dashboard OAuth when required.
4. Deploy private Workers first, followed by the production API routes and consumers.
5. Deploy the dashboard.
6. Verify domains, queue backlog, D1 row counts, health endpoints, and purchase reconciliation.
7. Remove superseded Workers or Pages only after production checks pass.

Never bootstrap replacement storage for an existing production target. Explicit resource IDs in the target manifest are the guardrail.
