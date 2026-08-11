# SuperBoard deployment

This document is the deployment source of truth for the unified SuperBoard dashboard and its isolated Cloudflare Workers.

Pull-request GitHub Actions validate without deploying. The separate protected
deployment workflow publishes the exact `dev` or `main` revision only after its
aggregate `CI gate` succeeds and its GitHub Environment gate is satisfied. A
superseded automatic revision is not deployed. A `workflow_dispatch` run is
accepted only when GitHub already contains a successful `CI gate` for the exact
selected branch SHA; it cannot replace or bypass CI. See
[Continuous integration and deployment ownership](./CI_OPERATIONS.md).

Repository creation is a separate, explicitly confirmed operation. Run
`npm run github:bootstrap` for the read-only plan, create or grant the declared
repositories with their declared visibility, then run
`npm run github:history:plan -- --fetch` before the first commit or push. The
history plan detects unrelated remote initialization and derives an audit
branch from the exact existing `main` SHA. Preserve that ref before publishing
the reviewed `dev` history, then use `npm run github:reconcile` for repository
settings, branch protection and Environment structure. None of these planning
commands publishes the local worktree or handles secret values.

The same confirmed reconciliation governs vulnerability alerts, Dependabot
security updates, future immutable releases and the Platform SDK tag ruleset.
It is intentionally additive: no operation updates or deletes an existing tag
or release. Review and merge the versioned control-plane contract before
applying it; a same-name ruleset with different conditions is reported as a
blocker and is never overwritten automatically.

After `dev` exists, unrelated `main` and `dev` histories are a production
blocker even when the original `main` audit ref is present. Generate the exact
procedure with `npm run github:history:bridge:plan` and follow
[`GIT_HISTORY_BRIDGE.md`](./GIT_HISTORY_BRIDGE.md). A squash or rebase copies
the tree but does not create a merge base, so it cannot complete this one-time
bridge.

SDK automation follows the same protection boundary. A successful immutable
tag release opens a catalogue PR instead of pushing `dev`. Once the complete
FlutterFlow and Support set is reviewed and merged, GitHub verifies every tag
and GitHub release, synchronizes the MBZA FlutterFlow library from the exact
catalogue SHA, and opens one dependency PR in `superboard-reference`. The
workflows can create PRs but contain no approval or merge operation.

## Services

- Dashboard: unified operator interface.
- API: public OAuth, project configuration, SDK ingress, webhook signature verification, and service orchestration.
- Billing: private financial execution through service binding.
- Identity: application accounts, sessions and Google/Apple federation.
- Files: application-owned uploads and metadata.
- Email: transactional and marketing transport, development capture, retries
  and delivery attempts.
- Support: canonical conversations, contacts, attachments, Durable Objects,
  WebSockets, workflows and CSAT.
- Observability: Tail Worker and Analytics Engine summaries.
- MCP: stateless OAuth-protected operator tools; it reaches API through a
  private Service Binding and owns no persistence or secret.
- App, Products, Paywalls, Dynamic Links, Marketing and Onboardings: reusable
  feature Workers enabled independently by each target.
- Custom: one application adapter behind the versioned custom job protocol,
  plus zero or more target-declared managed Workers for application-specific
  Workflows, Durable Objects and Containers. Their source, package, bindings,
  image recipe, runtime variables and secret names are Git-managed.

Billing and Support use separate execution boundaries. Support failures cannot
grant, revoke, retry, or roll back an entitlement. Legacy Messaging is disabled
on schema-v6 reference targets and exists only as a migration source.

## Configuration generation

Generate deployment configuration from the registered target. Do not hand-edit files under `deploy/generated`.

```bash
npm run cloudflare:config:api
node scripts/cloudflare-config.mjs --service mcp --target <target> --environment <environment>
npm run cloudflare:config:dashboard
npm run billing:types
```

All production secrets belong in Cloudflare secrets. Do not commit credentials, private keys, webhook secrets, access tokens, or exported D1 backups.

Provisioning is a separate confirmed phase. First generate the offline desired
inventory, then use `--remote` with the selected account credentials to compare
all paginated D1, KV, R2 and Queue resources. An exact-name existing resource
can be adopted only by the confirmed plan; configured ID/name drift blocks all
creation:

```bash
npm run cloudflare:bootstrap -- \
  --target <target> --environment <environment> --remote
npm run cloudflare:bootstrap -- \
  --target <target> --environment <environment> --apply \
  --confirm "CLOUDFLARE:BOOTSTRAP:<target>:<environment>:<plan-digest>"
```

This command never deploys Workers, applies D1 migrations, uploads secrets or
changes DNS. Those remain independent release gates.

Before deployment, verify generated binding types and the remote name-only
secret contract. The second command never reads secret values:

```bash
npm run cloudflare:types:check
npm run cloudflare:secrets:check -- \
  --target <target> --environment <environment>
```

## Verification

```bash
npm run typecheck
npm run test
npm run billing:check
npm run legacy-messaging:check
npm run worker:check
npm run mcp:check
npm run dashboard:cf-build
```

Queue-owning Workers are deployed with both their business consumer and a
second consumer for the matching DLQ. The latter must persist a bounded,
redacted quarantine record in the service-owned D1 before it acknowledges the
message. Generated configuration tests reject a missing or chained DLQ
consumer.

For Purchases, these commands prove code and runtime compatibility only. They do not replace Apple, Google Play, or real-device certification evidence.

`npm run billing:test:runtime` applies the complete API migration set to an ephemeral D1 database and exercises the private Billing entrypoint inside Cloudflare's Workers runtime. It verifies readiness redaction, public JWKS exposure, ES256 CustomerInfo verification, durable anonymous identity, idempotent provider ingress, queue retry behavior, durable DLQ quarantine, and the stable public error contract. `npm run billing:check` includes this runtime suite, Node unit tests, both TypeScript checks, generated Worker types, configuration ownership contracts, and a Wrangler deployment dry run.

## Database changes

Inspect all schema owners without network access:

```bash
npm run cloudflare:d1:plan -- \
  --target <target> --environment production --service all
```

Add `--remote-read` to ask Cloudflare which migrations are still pending. This
does not apply them. The command reports an exact structured
`pending_migrations` list per database and a global `converged` decision. It
rejects unrecognized Wrangler output or a remote filename that is not in the
reviewed local chain. `ready=true` proves resource provisioning;
`converged=true` with `pending_migration_count=0` proves schema convergence.

The same Git migration chain drives runtime health. Generated Wrangler configs
pin the ledger table as `d1_migrations` and inject the owner's latest reviewed
filename as `D1_EXPECTED_MIGRATION`. A deployed Worker reports `current`,
`behind` or `drifted`; a missing, malformed or non-current ledger returns a
sanitized degraded health response and blocks a false-green Infrastructure
status. The back office shows expected/latest migration and applied count for
all twelve D1 owners.

A direct production apply requires an exact confirmation and an absolute
protected backup directory:

```bash
npm run cloudflare:d1:apply -- \
  --target <target> --environment production --service support \
  --backup-directory /secure/superboard/d1 \
  --apply --confirm "MIGRATE:<target>:production:support"
```

Normal single-service `cloudflare:deploy` calls the same converger automatically.
Post-apply verification is fail-closed: deployment stops if Wrangler still
reports even one pending migration.
The standard full production `cloudflare:deploy:all` uses a stricter two-phase
protocol: it exports **every enabled D1 before the first migration**, applies and
verifies every migration, writes a mode-`0600` complete-batch receipt, and only
then begins the Worker deployment loop. Each database export has its own receipt
containing byte length and SHA-256, and the batch receipt is accepted only when
the migrated databases and backups exactly match every enabled schema owner.
Schema Workers validate that receipt before they can skip their already-complete
per-service migration phase. Production `--skip-backup` and
`--skip-migrations` are rejected. Version upload (`--upload-only`) never changes
D1.

Identity has an additional protected cutover between migration convergence and
Worker activation. The orchestrator executes a read-only remote D1 query proving
that `0002_project_scope.sql` is applied and that users, providers, sessions and
identity tokens contain zero rows with a missing `project_id`. It then creates a
mode-`0600`, SHA-256-verified receipt bound to the target, environment,
Cloudflare account, Identity database, migration and exact deployment revision.
The Identity deploy validates the supplied audit receipt, but never trusts it as
a substitute for live state: it repeats the remote query immediately before
`wrangler deploy`, creates and validates a fresh receipt, and fails closed on a
missing, stale or mismatched receipt. Real paths must remain outside Git and no
receipt path may traverse a symlink. A non-zero result stops the rollout; it
never triggers an inferred or automatic legacy backfill. See
[Application users back office](./APPLICATION_USERS_BACKOFFICE.md) for the
reviewed mapping procedure.

A production recovery selecting an individual schema Worker remains possible,
but it backs up and converges only that one service before deployment. A partial
command that mixes multiple services around one or more D1 owners is rejected;
use the complete batch rollout instead.

GitHub production deploys encrypt the temporary SQL exports, per-database
receipts and batch receipt with AES-256-GCM before uploading the artifact. A
successful rollout requires the complete batch receipt and refuses a zero-file
encryption result. If backup, migration or Worker deployment fails after some
exports exist, the finalization step still encrypts and retains every recoverable
artifact; plaintext is not deleted until all encrypted files and their index
have been written. Before any production mutation, CI validates that the
Environment key decodes to exactly 32 bytes. Configure the Environment secret
`SUPERBOARD_BACKUP_ENCRYPTION_KEY` as one base64-encoded random 32-byte key. Store
that key in the approved secret manager independently of GitHub artifact
retention. Restore an artifact with:

```bash
SUPERBOARD_BACKUP_ENCRYPTION_KEY=... npm run cloudflare:d1:decrypt -- \
  --file /secure/download/support.sql.enc \
  --output /secure/restore/support.sql
```

GitHub retains the encrypted deployment or recovery artifact for 30 days. The
target operator should additionally copy approved releases to the long-term
backup system required by the application's retention policy.

## Deployment order

1. Observability, Email, Files and Identity.
2. Enabled domain Workers: App, Products, Paywalls, Dynamic Links, Support,
   Marketing and Onboardings.
3. Billing, target-declared managed application Workers, then the optional
   application adapter Worker.
4. API gateway.
5. MCP Worker.
6. Dashboard.
7. Authenticated infrastructure, MCP, mail, Support and custom-job smoke checks.

Before any routed deployment, `cloudflare:domains:plan -- --strict` reads the
Cloudflare zone, DNS records and existing Worker custom domains. A hostname is
accepted only when it is unused or already attached to the Worker declared by
the target. An existing DNS record or another Worker blocks the pipeline; the
deployment code never deletes or replaces it. Production also uploads isolated
preflight versions without migrations, Queue consumers, cron triggers or custom
domains before the routed deployment begins.

Target schema version 8 adds `publicRouting`. A `staged` environment deploys
private Workers without custom domains; production `active` routing requires a
schema-validated, snapshot-bound FlutterFlow client receipt before the domain
plan runs. See [Public routing and application cutover](./PUBLIC_ROUTING_CUTOVER.md).

## Purchases release control

Keep the target environment's `billingExecutionMode` set to `local` while deploying and verifying the private Billing Worker. Follow [Billing Worker controlled cutover](./BILLING_WORKER_CUTOVER.md) to switch the typed manifest to `service` before device certification. Public release remains blocked until Purchases Diagnostics is fully green. Remove the legacy purchase dependency only in a separate release after the observation window passes.

## Rollback

Worker, dashboard, and D1 rollback are independent. Prefer a Worker version rollback first. Restore D1 only when the data itself is incorrect and the exact backup target has been verified. Never delete immutable Billing events or queued jobs during rollback.
