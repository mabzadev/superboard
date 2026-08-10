# Global module cutover runbook

This runbook controls the one-time, project-scoped migration from the legacy API, Billing, and Messaging databases to the App, Products, Paywalls, Dynamic Links, and Support D1 databases.

The tool is intentionally read-only by default. Running it without `--remote-read` prints a static plan and cannot contact Cloudflare. No remote mutation is possible without all of the following:

- the `apply` or maintenance mutation command;
- the explicit `--apply` flag;
- an approved, currently active window file;
- an exact operation-specific confirmation value;
- live project maintenance in read-only mode;
- for a `*-prod` project, `--allow-production` and every backup artifact declared
  by the generated plan, with non-empty SHA-256 evidence.

Do not use the migration tool to apply D1 schema migrations. All destination migrations must already be deployed and verified separately.

## Data ownership and registry

The declarative registry is in `scripts/module-cutover/registry.mjs`. Each entity specifies the legacy database and table, a project-scoped extraction query, the destination table, primary/conflict keys, columns, JSON canonicalization, and dependency order.

The current ownership mapping is:

| Module | Legacy authority | Destination D1 |
| --- | --- | --- |
| App | API D1 | App D1 |
| Products | Billing tables in API D1 | Products D1 |
| Paywalls | Billing tables in API D1 | Paywalls D1 |
| Dynamic Links | API D1 | Dynamic Links D1 |
| Support | legacy Messaging D1 when present, or the separately rendered Chatwoot export | Support D1 |

Every source query is scoped by the resolved numeric `project_id`. The public `project_ref` is parsed as `<instance_id>-prod` or `<instance_id>-test`; it is never coerced directly to a number. The tool resolves exactly one matching project row before reading any business data.

App Customers are transformed from Visitors without merging them with Products financial customers. The existing production instance key and its `test_` SDK form are migrated only as SHA-256 hashes; plaintext credentials are never written to a report. The legacy system has no durable Referral entity, so attribution visits are not fabricated as referrals. Support tables retain their identifiers so Durable Object and attachment references remain stable. JSON is canonicalized and each entity is verified with both an exact row count and a SHA-256 checksum.

Safety guards abort before writing when a legacy relationship cannot be represented without loss, including multi-product Billing packages, subscriptions without identity, and Paywall targeting or experiment records without a resolvable Paywall version. Fix the schema or mapping and repeat the rehearsal; never bypass a guard.

## Offline inspection and rehearsal

Inspect the registry without network access:

```bash
node scripts/opengrow-module-cutover.mjs registry
node scripts/opengrow-module-cutover.mjs --project-ref 10-test --modules app,products
```

Run the automated migration tests:

```bash
node --test scripts/module-cutover/core.test.mjs
```

The tests cover deterministic checksums, SQL escaping, project parsing, repeated idempotent execution, checkpoint resume, mismatch abort, production guards, rollback blocking, reverse deltas, and every registered entity with an empty rehearsal fixture.

For an offline data rehearsal, provide a protected fixture with this shape:

```json
{
  "project": {
    "project_ref": "10-test",
    "project_id": 12,
    "instance_id": 10,
    "environment": "test"
  },
  "source_rows": { "app.customers": [] },
  "target_rows": { "app.customers": [] },
  "guard_rows": {},
  "maintenance": {
    "10-test": { "enabled": true, "window_id": "rehearsal-2026-08-07" }
  }
}
```

Then run:

```bash
node scripts/opengrow-module-cutover.mjs plan \
  --project-ref 10-test \
  --fixture /secure/path/rehearsal.json \
  --report /secure/path/plan.json
```

Fixtures and snapshots contain project data. Keep them outside the repository with mode `0600`, encrypt them at rest, and delete them according to the retention policy.

## Remote read-only preflight on `10-test`

Generate the backup command manifest without executing it:

```bash
node scripts/opengrow-module-cutover.mjs backup-plan \
  --target vocostar \
  --environment production \
  --project-ref 10-test \
  --output-directory /secure/opengrow/backups/10-test \
  --report /secure/opengrow/10-test-backup-plan.json
```

Run a read-only source/target comparison:

```bash
node scripts/opengrow-module-cutover.mjs plan \
  --target vocostar \
  --environment production \
  --project-ref 10-test \
  --remote-read \
  --report /secure/opengrow/10-test-plan.json
```

`plan` omits rows from its report. Use the explicit `snapshot` command only when a protected pre-cutover dataset is required for post-cutover reverse-delta calculation:

```bash
node scripts/opengrow-module-cutover.mjs snapshot \
  --target vocostar \
  --environment production \
  --project-ref 10-test \
  --remote-read \
  --report /secure/opengrow/10-test-baseline.json
```

No command in this section writes to Cloudflare.

## Required secrets before smoke tests

Do not deploy or start authenticated `10-test` smokes until the secret inventory is complete:

- Gateway: `MODULE_INTERNAL_TOKEN` and `OPENGROW_CUTOVER_TOKEN`.
- Every domain Worker: `INTERNAL_API_TOKEN`, with the same rotated value as the gateway module token.
- Support: `SUPPORT_WEBHOOK_ENCRYPTION_KEY`.
- Marketing: `SMTP_ENCRYPTION_KEY` and `TRACKING_SIGNING_KEY`.

Plan the complete logical bundle first. Never place a secret in shell history or a report:

```bash
npm run cloudflare:secrets:upload -- \
  --target "$OPENGROW_TARGET" --environment production \
  --contracts module-internal-token,support-support-webhook-encryption-key,marketing-smtp-encryption-key,marketing-tracking-signing-key
```

For apply, the approved secret manager emits the exact four-contract JSON object
on stdin to the same command with `--apply` and the printed confirmation. The
uploader expands shared values to every Worker member and creates only inactive
versions. Save its value-free receipt outside the checkout, then run
`cloudflare:secrets:promote` with `--accept-shared-cutover` inside the approved
maintenance window and its separately printed confirmation. The promoter binds
each tag and rollback version before changing traffic. Afterwards, verify active
names with `cloudflare:secrets:check`. The registry rejects undeclared names,
and values must never be returned to the Dashboard.

## Approved window and maintenance

Create a window file. Times are ISO-8601 instants and must bracket the actual operation:

```bash
node scripts/opengrow-module-cutover.mjs window \
  --project-ref 10-test \
  --window-id global-cutover-2026-08-07 \
  --starts-at 2026-08-07T20:00:00Z \
  --ends-at 2026-08-07T22:00:00Z \
  --reason "Seven-module direct cutover rehearsal" \
  --approved-by owner@example.com \
  --report /secure/opengrow/10-test-window.json
```

The gateway maintenance contract is:

```text
GET /api/v1/admin/module-cutover/maintenance/:projectRef
PUT /api/v1/admin/module-cutover/maintenance/:projectRef
{ "enabled": true, "window_id": "...", "reason": "..." }
```

While enabled, gateway mutations for that project must fail with HTTP 503 and `error.code=maintenance_read_only`. Reads and cutover administration remain available. Configure `OPENGROW_CUTOVER_TOKEN` through the operator secret store; never put it on the command line or in the window file.

Enable and independently verify maintenance:

```bash
export OPENGROW_CUTOVER_TOKEN='<operator-secret>'
export OPENGROW_TARGET='<deployment-target>'

node scripts/opengrow-module-cutover.mjs maintenance-enable \
  --target vocostar --environment production --project-ref 10-test \
  --window /secure/opengrow/10-test-window.json \
  --apply \
  --confirm "MAINTENANCE:${OPENGROW_TARGET}:10-test:global-cutover-2026-08-07"

node scripts/opengrow-module-cutover.mjs maintenance-status \
  --target vocostar --environment production --project-ref 10-test --remote-read
```

The enable command updates the protected window with the confirmed maintenance evidence. The backfill also reads the live gateway state immediately before its first D1 write.

## Backfill, checkpoint and verification

The apply confirmation is different from the maintenance confirmation:

```bash
node scripts/opengrow-module-cutover.mjs apply \
  --target vocostar \
  --environment production \
  --project-ref 10-test \
  --modules app,products,paywalls,dynamic-links,support \
  --remote-read \
  --window /secure/opengrow/10-test-window.json \
  --checkpoint /secure/opengrow/10-test-checkpoint.json \
  --report /secure/opengrow/10-test-apply-report.json \
  --apply \
  --confirm "CUTOVER:${OPENGROW_TARGET}:10-test:global-cutover-2026-08-07"
```

Writes are per entity and use bounded, atomic `INSERT ... VALUES ... ON CONFLICT` statements of at most 100 rows and 96 KiB. Cloudflare D1 file imports are not globally atomic, so resumability is the safety mechanism: after every entity, the tool rereads the destination and requires exact count/checksum equality before atomically saving its checkpoint. A network or process interruption can use the same command and checkpoint; partially imported rows are safely upserted and already verified entities are reread without another write.

Any mismatch aborts immediately. Do not disable constraints, edit a checkpoint, prune destination rows, or continue with another module. Diagnose the first mismatched entity, correct the mapping/data, restore the destination backup if necessary, and rerun the entire `10-test` rehearsal.

Run an independent final verification:

```bash
node scripts/opengrow-module-cutover.mjs verify \
  --target vocostar --environment production --project-ref 10-test \
  --remote-read --report /secure/opengrow/10-test-verify.json
```

The command exits non-zero for any count/checksum mismatch.

## Production direct cutover

Repeat the complete process for `10-prod` only after the `10-test` functional and E2E gates pass. Before enabling maintenance:

1. Execute every D1 export from the generated backup plan.
2. Verify each file is non-empty and restorable.
3. Record its byte length and SHA-256 digest.
4. Record the deployed version IDs for the Dashboard, gateway, Billing, Messaging, and module Workers.
5. Add this evidence to the approved window under `backup_receipt`.

After executing the generated export commands, create and attach that evidence without rereading the files into memory:

```bash
node scripts/opengrow-module-cutover.mjs backup-receipt \
  --project-ref 10-prod \
  --backup-plan /secure/opengrow/10-prod-backup-plan.json \
  --window /secure/opengrow/10-prod-window.json \
  --report /secure/opengrow/10-prod-backup-receipt.json
```

For the VocoStar transitional target the receipt currently contains nine D1
artifacts because its legacy Messaging source is still retained. New reference
targets omit `legacy-messaging` entirely. The backup receipt records its own
`required_artifacts` from the generated plan; production validation uses that
exact set rather than a hardcoded number.

VocoStar receipt example:

```json
{
  "completed_at": "2026-08-07T19:45:00Z",
  "artifacts": [
    { "name": "legacy-api", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "legacy-messaging", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-app", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-products", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-paywalls", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-dynamicLinks", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-support", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-marketing", "bytes": 1234, "sha256": "64 lowercase hex characters" },
    { "name": "module-onboardings", "bytes": 1234, "sha256": "64 lowercase hex characters" }
  ]
}
```

The production maintenance-enable and apply commands additionally require `--allow-production`; apply also requires an exact `CUTOVER:<target>:10-prod:<window_id>` confirmation. Both production enable and apply fail outside the approved time window even if every other flag is supplied.

After backfill verification, deploy and smoke-test bindings in this order while maintenance remains enabled: private module Workers, gateway, generated clients, Dashboard. Verify all seven modules and the SDK resolution endpoints before reopening writes.

## Reverse delta and rollback

Legacy databases remain untouched for at least 30 days. Before any post-reopen rollback, re-enable maintenance and calculate the delta between the protected baseline and current module rows:

```bash
node scripts/opengrow-module-cutover.mjs reverse-delta \
  --target vocostar --environment production --project-ref 10-prod \
  --remote-read \
  --baseline /secure/opengrow/10-prod-baseline.json \
  --report /secure/opengrow/10-prod-reverse-delta.json \
  --sql-report /secure/opengrow/10-prod-reverse-sql.json
```

The tool emits legacy upserts only for mappings proven reversible. Deletions or lossy mappings set `replayable=false`, exit non-zero, and block automated rollback. Resolve those records manually with two-person review before continuing.

Generate a rollback plan from the backup plan, recorded Worker version IDs, and reverse-delta report:

```bash
node scripts/opengrow-module-cutover.mjs rollback-plan \
  --project-ref 10-prod \
  --backup-plan /secure/opengrow/10-prod-backup-plan.json \
  --backup-receipt /secure/opengrow/10-prod-backup-receipt.json \
  --versions /secure/opengrow/10-prod-worker-versions.json \
  --reverse-delta /secure/opengrow/10-prod-reverse-delta.json \
  --report /secure/opengrow/10-prod-rollback-plan.json
```

The generated rollback remains `blocked=true` until every backup receipt, Worker version and replayable reverse delta is present. The rollback order is maintenance, reverse-delta export, Dashboard/gateway/module version rollback, verified delta replay into legacy, legacy smoke tests, then maintenance disable. Never restore a pre-cutover D1 backup over post-cutover writes and never reopen traffic while a delta is blocked.

Disable maintenance only after all global smoke checks and monitoring gates are green:

```bash
node scripts/opengrow-module-cutover.mjs maintenance-disable \
  --target vocostar --environment production --project-ref 10-prod \
  --window /secure/opengrow/10-prod-window.json \
  --apply \
  --confirm "MAINTENANCE:${OPENGROW_TARGET}:10-prod:<window_id>"
```

Retain reports, checkpoints, backup digests, version IDs, and smoke evidence with the release record. Store project data and secrets separately from those operational reports.
