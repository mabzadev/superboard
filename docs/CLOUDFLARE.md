# Cloudflare targets and rollout

## Isolation contract

Each deployment target has one manifest under `deploy/targets` and declares
either `development` or `production`. Secret values and Cloudflare account IDs
are rejected by the manifest schema. `OPENGROW_TARGET` and
`OPENGROW_ENVIRONMENT` select the manifest and environment used by automation.
The exact shared/reference/application/injected ownership boundary is enforced
by `npm run configuration:check` and documented in
[`CONFIGURATION_BOUNDARIES.md`](./CONFIGURATION_BOUNDARIES.md).

Storage, queues, Workers, domains, registration realms, and OAuth applications are target-scoped. An accidental shared resource must not allow one target to authenticate, read, or mutate another target.

The mandatory baseline is API, Dashboard, Email, Identity, Files,
Observability and MCP. MCP is a stateless public Worker at the target's
`domains.mcp`; it validates the OAuth bearer token and invokes the API only
through its private `API_SERVICE` binding. It has no D1, KV, R2, Queue or Worker
secret of its own.

## GitHub deployment connection

`.github/workflows/deploy-cloudflare.yml` connects all enabled Workers to GitHub
as one ordered release. `dev` deploys the development target; `main` deploys the
production target. GitHub Environments hold the target/account selection and
least-privilege token. The versioned deployment matrix also declares the exact
target expected from each Environment, and the job fails before checkout or any
Cloudflare command when `OPENGROW_TARGET` differs. Worker source contains no
account-specific constant.

Do not enable a second automatic Cloudflare Workers Builds deployment for the
same Workers: two deployment authorities can race migrations, routes and Queue
consumers. The reference architecture intentionally ships no Workers Builds
connector: GitHub Actions is the single deployment authority for every target.

## Private back-office registration

Private deployments use:

- `registrationMode: "allowlist"`;
- `ssoEnabled: false`.

OpenGrow has no plan, MAU quota, upgrade gate, or paid platform edition. Product
purchases and entitlements remain application modules and are enabled per
project; they are not subscriptions to OpenGrow itself.

The allowlist realm is derived from the target and environment. Manage exact addresses directly against the target D1 database:

```bash
npm run allowlist -- add --target <target> --environment production --email user@example.com
npm run allowlist -- revoke --target <target> --environment production --email user@example.com
npm run allowlist -- list --target <target> --environment production
npm run allowlist -- bootstrap --target <target> --environment production
```

No administrator key or email list is stored in the dashboard.

## Transactional email and newsletters

The common OpenGrow Email Worker handles transactional/test mail. It stores an
idempotent message ledger, queues SMTP delivery, leases each recipient before an
external side effect and quarantines exhausted work in its DLQ. API and Identity
reach it only through a private Service Binding. The development target captures
mail for `mail.mbza.dev`; production targets use an SMTP password stored as a
Worker secret. Each manifest only contains the transport mode and public sender
identity.

```bash
npm run cloudflare:secrets:upload -- --target <target> --environment production \
  --contracts email-smtp-password
```

No SMTP password, API key, or preview access token is stored in the repository.
The value is supplied only during the separately confirmed apply phase, using
the exact stdin JSON contract documented in `SECRET_MANAGEMENT.md`.

The Infrastructure page reads a body-free operations projection through the
API-to-Email Service Binding. Administrators can inspect live Queue backlog,
message kind, status, recipient/error counts, attempts and timestamps without
exposing recipients or message bodies. Terminal Queue failures remain in the Email D1 quarantine;
retained payloads without secret redaction can be replayed, while every replay
or discard decision records its resolution and timestamp. A failed Queue replay
returns the record to quarantine instead of reporting a false success.

Shared internal tokens use the same uploader with `--overlap`. Consumers first
receive current and optional `*_PREVIOUS` bindings, then new-token-only
producers are promoted. The value-free promotion receipt is retained outside
the checkout and passed to `cloudflare:secrets:retire` after a minimum
thirty-minute observation window. Retirement is account/version bound and
automatically rolls back affected Workers if activation fails.

Newsletter/campaign mail belongs to the optional Marketing Worker because it
needs project-scoped consent, suppressions, lists, templates, quotas, failover,
tracking and provider events. Marketing selects and decrypts the project
profile in memory, then delegates the fully materialized message to the Email
Worker over a private `EMAIL_SERVICE` binding. Email is therefore the sole SMTP
socket authority and stores only an idempotent transport receipt, never the
delegated body or credential. Ambiguous binding failures retry the same profile
and key before failover, preventing an unconfirmed send from being duplicated.
Before enabling a production Marketing profile, enter its DKIM selector and run
**Verify sender DNS** in
`/marketing/settings`. OpenGrow checks SPF, DKIM and DMARC using Cloudflare's
binary DNS-over-HTTPS response and records the evidence. SMTP connectivity alone
does not mark the profile ready, and production campaign/double-opt-in queues do
not select an unverified profile.

`/marketing/settings` also exposes the project-scoped Marketing quarantine.
Administrators inspect body-free terminal job metadata and can replay or
discard one item. Every mutation is idempotent and audited; a replay that cannot
reach Queue returns the item to quarantine.

## Resource bootstrap

The target manifest is the desired resource-name registry. An offline pass
lists every enabled D1, KV, R2 bucket and Queue without contacting Cloudflare:

```bash
npm run cloudflare:bootstrap -- \
  --target <target> --environment <environment>
```

Before provisioning, supply the scoped account identifier and least-privilege
token, then inspect the complete remote inventory. D1, KV and Queues use
page-based pagination; R2 uses its cursor contract. The command is read-only and
does not reveal the token or raw account identifier:

```bash
npm run cloudflare:bootstrap -- \
  --target <target> --environment <environment> --remote
```

The remote plan distinguishes reuse, adoption of an existing exact-name
resource, and creation. A configured identifier missing remotely, an ID/name
mismatch or an ambiguous duplicate blocks the entire plan. No replacement,
rename or deletion is attempted. Apply only the same reviewed plan with its
account-bound confirmation:

```bash
npm run cloudflare:bootstrap -- \
  --target <target> --environment <environment> --apply \
  --confirm "CLOUDFLARE:BOOTSTRAP:<target>:<environment>:<plan-digest>"
```

The apply step creates only planned missing resources and records only returned
non-secret D1/KV identifiers through an atomic target-manifest replacement. A
concurrent remote change alters the next plan and invalidates the old
confirmation. Existing production IDs are never silently adopted or replaced.

## Production rollout

Production targets start with `publicRouting: staged`. This permits private
Worker and storage convergence without claiming a legacy hostname. Switching
to `active` requires the reviewed `productionCutover` client receipt described
in [Public routing and application cutover](./PUBLIC_ROUTING_CUTOVER.md); the
deployment workflow verifies it before any domain inspection or mutation.

1. Run `cloudflare:domains:plan -- --strict`; resolve every occupied hostname
   explicitly. The command is read-only and never adopts or deletes DNS.
2. Upload new Worker versions with `--preflight --upload-only`. This omits
   custom domains, D1 migrations, API queue consumers and cron triggers.
3. Upload runtime secrets and validate private service readiness.
4. Supply an absolute protected backup directory. Before any Worker is changed,
   the full deployment converger exports every enabled production D1, records
   its SHA-256 receipt, migrates and verifies every database, then emits one
   complete batch receipt. A missing backup or verification aborts before the
   Worker loop.
5. Deploy private Workers first, followed by the production API routes and
   consumers. Each schema Worker consumes the same batch receipt instead of
   running a second migration.
6. Deploy MCP after API, then deploy the dashboard.
7. Encrypt and retain the complete batch. On a failed backup, migration or
   Worker rollout, encrypt and retain any recoverable partial exports as failure
   evidence; an empty encryption result is never green.
8. Verify domains, including `/health` on the MCP origin, queue backlog, D1 row
   counts, health endpoints, and purchase reconciliation.
9. Remove superseded Workers or Pages only after production checks pass.

Never bootstrap replacement storage for an existing production target. Explicit resource IDs in the target manifest are the guardrail.
