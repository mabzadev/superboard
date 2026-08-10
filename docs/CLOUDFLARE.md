# Cloudflare targets and rollout

## Isolation contract

Each deployment target has one manifest under `deploy/targets` and declares
either `development` or `production`. Secret values and Cloudflare account IDs
are rejected by the manifest schema. `SUPERBOARD_TARGET` and
`SUPERBOARD_ENVIRONMENT` select the manifest and environment used by
automation. During the non-destructive transition, scripts read
`OPENGROW_TARGET` and `OPENGROW_ENVIRONMENT` only as fallbacks; a defined
`SUPERBOARD_*` value always wins.

The same read contract applies to `SUPERBOARD_RELEASE` (fallback
`OPENGROW_RELEASE`) and `SUPERBOARD_REFERENCE_REPOSITORY` (fallback
`OPENGROW_REFERENCE_REPOSITORY`). This change does not rewrite GitHub
Environment variables or Worker vars remotely: migration of stored values is a
separate, audited cutover. The same canonical-first rule applies to
`SUPERBOARD_REFERENCE_DISPATCH_TOKEN` and
`SUPERBOARD_BACKUP_ENCRYPTION_KEY`.
The exact shared/reference/application/injected ownership boundary is enforced
by `npm run configuration:check` and documented in
[`CONFIGURATION_BOUNDARIES.md`](./CONFIGURATION_BOUNDARIES.md).

Storage, queues, Workers, domains, registration realms, and OAuth applications are target-scoped. An accidental shared resource must not allow one target to authenticate, read, or mutate another target.

The mandatory baseline is API, Dashboard, Email, Identity, Files,
Observability and MCP. MCP is a stateless public Worker at the target's
`domains.mcp`; it validates the OAuth bearer token and invokes the API only
through its private `API_SERVICE` binding. It has no D1, KV, R2, Queue or Worker
secret of its own.

## Automatic deployment authority

`config/cloudflare-deployments.json` enforces one automatic deployment authority per target:

- `mbza-development` is deployed from `dev` by Cloudflare Workers Builds. Only
  the target's Dashboard Worker is connected to `mbzadev/superboard-platform`.
  Cloudflare installs dependencies, then the build command clones the public
  `superboard-reference` contract and runs the deployment-policy, service,
  typecheck, application and Custom Worker gates before its versioned
  `cloudflare:deploy:all` deploy command can run. Non-production branch builds
  are disabled.
  That one controller deploys every enabled Worker in dependency order; do not
  connect the other Workers independently, because concurrent controllers can
  race migrations, routes and Queue consumers.

- `vocostar-production` is deployed from `main` by
  `.github/workflows/deploy-cloudflare.yml`, after the successful aggregate CI
  gate. Its protected GitHub Environment supplies the production account,
  least-privilege token and D1 backup encryption key.

Cloudflare Workers Builds injects `WRANGLER_CI_OVERRIDE_NAME` so a conventional
single-Worker deploy targets the connected Worker. SuperBoard removes that
variable from every Cloudflare child-process environment: the generated target
manifest remains the only Worker-name authority for the ordered multi-Worker
release. The caller environment is not mutated, and account credentials plus
the other Workers Builds metadata continue to be forwarded.

Cloudflare generates and retains the Workers Builds token. The selected MBZA
account ID is a non-secret `CLOUDFLARE_ACCOUNT_ID` build variable in Cloudflare,
not a GitHub secret and not a value committed to the repository. Consequently,
the platform `development` GitHub Environment contains no Cloudflare deployment
credential. The exact source-owned Workers Builds contract is:

```text
repository: mbzadev/superboard-platform
production branch: dev
build command: git clone --depth 1 --branch dev https://github.com/mbzadev/superboard-reference.git ../superboard-reference && node --test scripts/backoffice-policy.test.mjs scripts/github-deployment-matrix.test.mjs scripts/github-deployment-workflow.test.mjs && npm run cloudflare:test:services && npm run typecheck && npm test && npm run custom:check
deploy command: npm run cloudflare:deploy:all -- --target "$SUPERBOARD_TARGET" --environment "$SUPERBOARD_ENVIRONMENT"
build variables: CLOUDFLARE_ACCOUNT_ID, SUPERBOARD_TARGET=mbza-development, SUPERBOARD_ENVIRONMENT=development
non-production branch builds: disabled
```

## Private back-office registration

Private deployments use:

- `registrationMode: "allowlist"`;
- `ssoEnabled: false`.

SuperBoard has no plan, MAU quota, upgrade gate, or paid platform edition. Product
purchases and entitlements remain application modules and are enabled per
project; they are not subscriptions to SuperBoard itself.

The allowlist realm is derived from the target and environment. Manage exact addresses directly against the target D1 database:

```bash
npm run allowlist -- add --target <target> --environment production --email user@example.com
npm run allowlist -- revoke --target <target> --environment production --email user@example.com
npm run allowlist -- list --target <target> --environment production
npm run allowlist -- bootstrap --target <target> --environment production
```

No administrator key or email list is stored in the dashboard.

## Transactional email and newsletters

The common SuperBoard Email Worker handles transactional/test mail. It stores an
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
`/marketing/settings`. SuperBoard checks SPF, DKIM and DMARC using Cloudflare's
binary DNS-over-HTTPS response and records the evidence. SMTP connectivity alone
does not mark the profile ready, and production campaign/double-opt-in queues do
not select an unverified profile.

`/marketing/settings` also exposes the project-scoped Marketing quarantine.
Administrators inspect body-free terminal job metadata and can replay or
discard one item. Every mutation is idempotent and audited; a replay that cannot
reach Queue returns the item to quarantine.

## Resource bootstrap

Every target declares a strict `resourceIdentity` contract. `logicalName` is
the current product namespace shown to operators; `physicalName` is the
namespace that Cloudflare must actually resolve. The fresh MBZA target uses
`superboard` for both namespaces with `migrationStrategy: canonical`; its first
provisioning creates canonical `superboard-*` resources because no historical
MBZA platform resources exist in the selected account. VocoStar uses
`logicalName: superboard`, `physicalName: opengrow` and
`migrationStrategy: retain-physical-name` because its production resources own
historical data. `previousNames` records only a physical namespace that is
actually retained. New application targets use the canonical `superboard`
namespace for both fields.

Bootstrap, generated Wrangler configuration, Worker shell planning and
readiness all validate this contract. Plans expose both logical and physical
names, but remote lookup and creation use only `physicalName`. App-specific
legacy resources such as VocoStar's existing custom D1/R2 must carry
`legacyName: true`; arbitrary out-of-namespace names fail validation.

The target manifest is the desired physical resource-name registry. An offline pass
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
   `retiredDomains` must be unassigned and free of DNS records; any unregistered
   custom domain still attached to a target Worker is reported as a blocking
   orphan. For MBZA, `board.mbza.dev` is the canonical back office,
   `grow.mbza.dev` is retired, and `in.mbza.dev` remains the short-link domain.
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
