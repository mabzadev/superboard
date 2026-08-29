# Flows cutover runbook (MBZA development only)

This tooling migrates the historical Paywalls and Onboardings D1 data into
Flows. It is deliberately restricted to `mbza-development/development`, is a
dry run by default, never deletes a database or row, and never invokes GitHub
Actions. Remote operations use the local Cloudflare/Wrangler connection only.
The import is scoped directly by SuperBoard project plus Flows environment; it
does not create SaaS organizations or write Billing, MTU, purchase, installation
or usage-accounting tables.
Analytics and legacy claim idempotency keys are project-scoped composites, so
the same historical event id can safely exist in different projects and in both
legacy source modules.
Protected plans created before cutover tool `2.3.0` must be regenerated. The
tool rejects them rather than applying pre-composite event keys, synthetic
`legacy_*` user identities or a release that drops active Paywall placements.
Runtime user hashes are derived in memory from the protected three-secret
Flows version bundle. The stable HMAC key is never copied into a snapshot, plan
or environment variable and is never printed. A signed Worker resolver remains
available as a compatibility fallback only after the new API/Flows private
binding is active.

All snapshots, plans, receipts, checkpoints, deltas and reports contain
protected project data. Store them under `.flows-cutover/` (Git-ignored and
written mode `0600`) or another protected local directory.

Start by printing the current sequence and safety notes:

```sh
npm run flows:cutover -- instructions
```

If the Flows D1 id is not provisioned, the backup plan stops and prints this
direct command:

```sh
node scripts/cloudflare-bootstrap.mjs --target mbza-development --environment development --remote
```

Review that plan and execute only the exact confirmation printed by the
bootstrap command. The cutover CLI does not provision or deploy Workers.

## 1. Window and backups

The backup receipt is incomplete unless it covers four D1 databases: API
(`superboard-dev-db`), Paywalls, Onboardings and Flows. API is mandatory because
migration `0061` and both project routing receipts mutate it. Each gets its own
Time Travel bookmark, local export hash and verified R2 ETag before any schema
or routing write.

```sh
npm run flows:cutover -- window \
  --project-ref <project-ref> \
  --starts-at <ISO-8601> \
  --ends-at <ISO-8601> \
  --reason '<reason>' \
  --approved-by '<approver>' \
  --output .flows-cutover/window.json

npm run flows:cutover -- backup-plan \
  --project-ref <project-ref> \
  --output .flows-cutover/backup-plan.json
```

Run the emitted `time_travel_command`, `export_command`, `upload_command` and
Worker version inspection commands directly from this workstation. Record the
returned bookmarks and verified R2 ETags in a protected evidence file:

```json
{
  "artifacts": [
    {
      "logical_name": "api",
      "time_travel_bookmark": "<bookmark>",
      "r2_etag": "<etag>",
      "r2_verified_at": "<ISO-8601>"
    },
    {
      "logical_name": "paywalls",
      "time_travel_bookmark": "<bookmark>",
      "r2_etag": "<etag>",
      "r2_verified_at": "<ISO-8601>"
    },
    {
      "logical_name": "onboardings",
      "time_travel_bookmark": "<bookmark>",
      "r2_etag": "<etag>",
      "r2_verified_at": "<ISO-8601>"
    },
    {
      "logical_name": "flows",
      "time_travel_bookmark": "<bookmark>",
      "r2_etag": "<etag>",
      "r2_verified_at": "<ISO-8601>"
    }
  ]
}
```

Then create the bound receipt (local export hashes and sizes are computed by
the CLI):

```sh
npm run flows:cutover -- backup-receipt \
  --project-ref <project-ref> \
  --window .flows-cutover/window.json \
  --backup-plan .flows-cutover/backup-plan.json \
  --evidence .flows-cutover/backup-evidence.json \
  --output .flows-cutover/backup-receipt.json
```

## 2. Rehearsal, freeze and final delta

Capture and plan a read-only rehearsal. By default, the CLI selects the Flows
environment whose key matches the SuperBoard project environment (`production`
or `test`). Pass an explicit Flows environment id only to select that exact
project-scoped environment.

On a new Flows database the default environment id is derived with the same
stable contract as the Worker. No read-only command writes it. The guarded
`apply` command creates only the missing project/environment scope, after the
backup and freeze validations have passed, before inserting rows with foreign
keys. The first signed Worker request then completes the idempotent Basics V2
and localization provisioning; an SDK key must be explicitly rotated before
new native Flows SDK clients are enabled.

```sh
npm run flows:cutover -- snapshot \
  --project-ref <project-ref> --remote-read \
  --output .flows-cutover/source-pre-freeze.json

npm run flows:cutover -- plan \
  --project-ref <project-ref> --remote-read \
  --snapshot .flows-cutover/source-pre-freeze.json \
  --flow-user-hash-bundle .flows-cutover/secrets/mbza-development-flows-development.json \
  --output .flows-cutover/plan-pre-freeze.json
```

Ask for a freeze dry run first. It prints the exact confirmation and exact
direct command; repeat it with `--apply --confirm ...` and a protected output
receipt. The freeze blocks mutating admin and SDK requests but preserves
read-only resolutions.

```sh
npm run flows:cutover -- freeze \
  --project-ref <project-ref> \
  --window .flows-cutover/window.json \
  --plan .flows-cutover/plan-pre-freeze.json \
  --backup-plan .flows-cutover/backup-plan.json \
  --backup-receipt .flows-cutover/backup-receipt.json \
  --output .flows-cutover/freeze-receipt.json
```

While the freeze remains active, recapture both source databases and build the
final plan. Snapshot capture requires the Time Travel bookmark to remain
unchanged across every table read; it aborts if any write races the capture.

```sh
npm run flows:cutover -- snapshot \
  --project-ref <project-ref> --remote-read \
  --output .flows-cutover/source-final.json

npm run flows:cutover -- plan \
  --project-ref <project-ref> --remote-read \
  --snapshot .flows-cutover/source-final.json \
  --flow-user-hash-bundle .flows-cutover/secrets/mbza-development-flows-development.json \
  --output .flows-cutover/plan-final.json
```

The freeze receipt is window/project-bound because it necessarily precedes
the final plan. The apply confirmation and checkpoint are bound to the exact
final plan id.

## 3. Apply, resume and verify

The first invocation is a dry run and prints the exact direct mutation command:

```sh
npm run flows:cutover -- apply \
  --project-ref <project-ref> \
  --plan .flows-cutover/plan-final.json \
  --window .flows-cutover/window.json \
  --backup-plan .flows-cutover/backup-plan.json \
  --backup-receipt .flows-cutover/backup-receipt.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --checkpoint .flows-cutover/checkpoint.json
```

If an import is interrupted, use the same exact artifacts with `resume`. A
checkpoint from another project, snapshot, window or plan is rejected. Every
entity is reread and checksum-verified before it is marked complete.

```sh
npm run flows:cutover -- resume \
  --project-ref <project-ref> \
  --plan .flows-cutover/plan-final.json \
  --window .flows-cutover/window.json \
  --backup-plan .flows-cutover/backup-plan.json \
  --backup-receipt .flows-cutover/backup-receipt.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --checkpoint .flows-cutover/checkpoint.json

npm run flows:cutover -- verify \
  --project-ref <project-ref> --remote-read \
  --plan .flows-cutover/plan-final.json \
  --output .flows-cutover/verification.json
```

Do not thaw unless verification reports `ready: true`.

## 4. Atomic routing activation

The MBZA API's final configuration contains `FLOWS_MODULE` and intentionally
does not contain the two legacy service bindings. To avoid any unavailable
legacy SDK window, do not promote that API version yet. First apply API
migration `0061`, keep the currently active API/legacy Workers serving traffic,
freeze and verify the import, then stage the routing receipt directly in the
API D1 database through the guarded local Wrangler connection.

Inspect the routing state (read only):

```sh
npm run flows:cutover -- routing-status \
  --project-ref <project-ref> --remote-read
```

Request a dry run. It verifies the exact plan, successful verification report,
freeze receipt and live freeze, then prints the one accepted confirmation:

```sh
npm run flows:cutover -- activate-routing \
  --project-ref <project-ref> --remote-read \
  --plan .flows-cutover/plan-final.json \
  --window .flows-cutover/window.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --verification .flows-cutover/verification.json \
  --output .flows-cutover/routing-enabled.json
```

Repeat only the emitted command with `--apply --confirm ...`. The resulting D1
row and protected receipt are sealed by project, window, plan id and canonical
verification checksum. The old API version ignores this new table. Promoting
the already inspected final API version then switches aliases atomically to the
verified Flows data.

## 5. Reverse delta, rollback plan, and explicit thaw

Capture the reverse delta before any rollback. Deletions and non-reversible
administrative edits block automatic replay and require manual reconciliation.

```sh
npm run flows:cutover -- reverse-delta \
  --project-ref <project-ref> --remote-read \
  --plan .flows-cutover/plan-final.json \
  --output .flows-cutover/reverse-delta.json \
  --sql-output .flows-cutover/reverse-sql.json
```

The rollback command is intentionally a fail-closed orchestrator: it validates
backups, exact recorded Worker versions, freeze state and reverse-delta
replayability, then prints direct Wrangler steps. It never executes Time Travel
restore, deletion, deployment, or thaw. Execute only `steps[].command` after
review; entries under `manual_emergency_only` require separate approval.
The first rollback actions keep the freeze active and disable Flows routing;
restore the recorded historical API version (whose immutable version still
contains the Paywalls and Onboardings service bindings) before replaying legacy
deltas. Never alter either archived D1 database.

```sh
npm run flows:cutover -- rollback \
  --project-ref <project-ref> \
  --plan .flows-cutover/plan-final.json \
  --backup-plan .flows-cutover/backup-plan.json \
  --backup-receipt .flows-cutover/backup-receipt.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --reverse-delta .flows-cutover/reverse-delta.json \
  --versions .flows-cutover/worker-versions.json \
  --output .flows-cutover/rollback-plan.json
```

The routing disable command is also dry-run first and uses the same evidence:

```sh
npm run flows:cutover -- deactivate-routing \
  --project-ref <project-ref> --remote-read \
  --plan .flows-cutover/plan-final.json \
  --window .flows-cutover/window.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --verification .flows-cutover/verification.json \
  --output .flows-cutover/routing-disabled.json
```

After a successful forward verification (or after separately verified rollback
smoke tests), request a thaw dry run and repeat its exact direct command:

```sh
npm run flows:cutover -- thaw \
  --project-ref <project-ref> \
  --window .flows-cutover/window.json \
  --plan .flows-cutover/plan-final.json \
  --freeze-receipt .flows-cutover/freeze-receipt.json \
  --verification .flows-cutover/verification.json
```

Forward thaw now verifies that the exact routing receipt is still active in D1;
verification alone cannot accidentally reopen writes before the traffic switch.

Historical Paywalls and Onboardings databases remain archived. There is no
automatic cleanup after 30 days and no deletion command in this tool.

## 6. Final Flows Worker version and secrets

`cloudflare:flows-version-bundle` prepares the final Wrangler `versions upload`
without deploying or promoting it. The value-free plan is the default:

```sh
npm run cloudflare:flows-version-bundle -- \
  --target mbza-development \
  --environment development
```

Preparation requires a protected JSON source (mode `0600`) containing only the
existing `INTERNAL_API_TOKEN` and `FLOW_USER_ENCRYPTION_KEY`. The generated
bundle is restricted to the Git-ignored `.flows-cutover/secrets/` directory,
uses mode `0600`, retains those two values exactly, and generates
`FLOW_USER_HASH_KEY` only once. Re-running preparation reuses that stable hash
key and fails closed if either existing value changed. `EMAIL_INTERNAL_TOKEN`
and every undeclared secret name are rejected.

```sh
npm run cloudflare:flows-version-bundle -- \
  --target mbza-development \
  --environment development \
  --prepare \
  --existing-secrets-file /protected/flows-existing.json
```

The receipt contains only secret names and the exact `wrangler versions upload
--secrets-file ... --strict` command. Upload creates an inactive intermediate
version. Because Cloudflare preserves omitted secrets, the receipt also creates
a protected mode-`0600` JSON cleanup file containing only
`{"EMAIL_INTERNAL_TOKEN": null}` and emits an exact `wrangler versions secret
bulk` command. Run that command only when the read-only inventory still reports
the obsolete secret; it patches the immediately preceding upload and creates a
second inactive version without an interactive prompt. Inspect and promote only
that second version. Never use `wrangler secret delete`, which would deploy
immediately.

## 7. Direct MBZA deployment order (no GitHub Actions)

All commands below are local Cloudflare/Wrangler operations and target only
`mbza-development/development`.

Wrangler currently sees more than one accessible Cloudflare account and fails
closed in non-interactive mode unless MBZA is selected. Verify membership with
`npx wrangler whoami --account Mabza --json`, then set the returned account id
only in the protected operator shell (never in the repository):

```sh
export FLOWS_MBZA_ACCOUNT_ID='<verified MBZA account id>'
export CLOUDFLARE_ACCOUNT_ID="$FLOWS_MBZA_ACCOUNT_ID"
export CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT="$FLOWS_MBZA_ACCOUNT_ID"
```

The generic variable is consumed by raw `npx wrangler` commands; the scoped
variable is consumed by SuperBoard target-aware scripts. Stop if `whoami` does
not report the expected MBZA membership.

1. Run all gates and route-free dry runs. Generate the Flows config and the
   protected secret bundle; never print its values.
2. Record the currently active version/deployment JSON for API, Dashboard,
   Flows, Paywalls and Onboardings under the protected cutover directory (mode
   `0600`). Also record `versions view <active-version-id> --json` for Flows and
   both legacy Workers so their exact code, bindings and secret-name inventory
   remain auditable.
3. Before any migration, create the window, backup plan, evidence and validated
   backup receipt for both `1-prod` and `1-test`. The same four D1 bookmarks and
   R2 exports may be referenced by both project-bound receipts, but both
   receipts must independently report ready. They must cover API, Paywalls,
   Onboardings and Flows. Stop if either receipt is incomplete; API migration
   `0061` is forbidden before this gate.
4. Apply the Flows D1 migrations and API migration `0061` directly with
   `cloudflare-d1-converge.mjs`; verify both report zero pending migrations.
   Then query `sqlite_master` on Flows and fail if any organization, member,
   invitation, billing, MTU or usage-alert table remains. Migration `0007`
   intentionally removes the pre-cutover transient organization/workflow rows;
   only `flow_projects`/project environments may be auto-provisioned afterward.
5. Upload the Flows code plus all three secrets as one inactive version with
   the command emitted by `cloudflare:flows-version-bundle`. The current MBZA
   Worker inventory contains the obsolete `EMAIL_INTERNAL_TOKEN`; immediately
   run the emitted `wrangler versions secret bulk` cleanup command so Cloudflare
   clones the just-uploaded code into a second inactive version without that
   secret. Stop if another version appeared between those two commands. Inspect
   the second version, confirm that it has the same code/bindings and exactly
   `INTERNAL_API_TOKEN`, `FLOW_USER_ENCRYPTION_KEY`, and
   `FLOW_USER_HASH_KEY`, then promote only that second version at 100%. It has
   no public route. If read-only inventory already proves Email absent, skip
   deletion and promote the inspected upload version.
6. Upload the final API and Dashboard as inactive versions. Do not promote them.
7. Execute rehearsal snapshot/plan, freeze, final snapshot, import/resume and
   verification for every MBZA project. Backups are already sealed by step 3;
   never replace those receipts after a schema mutation. Activate each project
   routing receipt only after its report is `ready: true`.
8. Promote the inspected API version at 100%, then run native Flows plus every
   legacy Paywalls/Onboardings smoke test. Promote Dashboard only after those
   runtime tests succeed, then thaw each project.
9. After all smoke tests, inspect the active API version and prove that it has
   `FLOWS_MODULE` but no `PAYWALLS_MODULE` or `ONBOARDINGS_MODULE`. Confirm both
   legacy Workers have no route, custom domain or `workers.dev` exposure. They
   are then operationally inactive and must remain dormant for the 30-day
   rollback window. Do not run `wrangler delete`: Cloudflare deletion removes
   the Worker versions and non-readable secrets on which the rollback plan
   depends. Recheck that both historical D1 names/ids still exist and that their
   R2 archive receipts remain valid. Never run `wrangler d1 delete`.

Rollback restores the recorded historical API version first, which restores
its immutable legacy bindings, then disables the staged D1 routing receipt and
follows the generated reverse-delta plan while the freeze remains active.

The MBZA cutover inventory is explicitly two scopes: `1-prod` (API project id
`1`) and `1-test` (API project id `2`). A shared operational window/archive
batch is allowed, but each scope must have its own source snapshot, canonical
plan, checkpoint, verification report and routing receipt. Do not promote the
API until both routing-status responses are enabled and match their respective
plan/checksum/window evidence. Smoke both production and test SDK credentials.

The final read-only promotion gate checks the live project inventory and both
receipts in one command. It fails if a third project appears or either fixed
scope differs:

```sh
npm run flows:cutover -- routing-gate --remote-read \
  --prod-plan .flows-cutover/1-prod/plan-final.json \
  --prod-verification .flows-cutover/1-prod/verification.json \
  --prod-window .flows-cutover/1-prod/window.json \
  --test-plan .flows-cutover/1-test/plan-final.json \
  --test-verification .flows-cutover/1-test/verification.json \
  --test-window .flows-cutover/1-test/window.json \
  --output .flows-cutover/routing-promotion-gate.json
```

Promote the API only when this report says `ready: true`.

The exact direct command skeleton is:

```sh
# Read-only migration state.
node scripts/cloudflare-d1-converge.mjs plan --target mbza-development --environment development --service flows --remote-read
node scripts/cloudflare-d1-converge.mjs plan --target mbza-development --environment development --service api --remote-read

# Guarded schema writes (development target only).
# STOP unless both project-bound backup receipts are ready and cover API,
# Paywalls, Onboardings and Flows with verified Time Travel + R2 evidence.
node scripts/cloudflare-d1-converge.mjs apply --target mbza-development --environment development --service flows --apply --confirm MIGRATE:mbza-development:development:flows
node scripts/cloudflare-d1-converge.mjs apply --target mbza-development --environment development --service api --apply --confirm MIGRATE:mbza-development:development:api

# Value-free configs and inactive version uploads.
node scripts/cloudflare-config.mjs --target mbza-development --environment development --service flows --no-routes
npx wrangler versions upload --config deploy/generated/mbza-development-flows-development.jsonc --secrets-file .flows-cutover/secrets/mbza-development-flows-development.json --strict --tag mbza-flows-project-cutover-v1 --message 'SuperBoard Flows MBZA project-scoped cutover'
npx wrangler versions secret bulk .flows-cutover/secrets/mbza-development-flows-development.remove-obsolete.json --config deploy/generated/mbza-development-flows-development.jsonc --name superboard-flows-dev --tag mbza-flows-project-cutover-v1-without-email --message 'Remove obsolete Flows Email secret before MBZA activation'
npm run cloudflare:deploy -- --target mbza-development --environment development --service api --upload-only
npm run cloudflare:deploy -- --target mbza-development --environment development --service dashboard --upload-only

# Inspect immutable versions before each promotion.
npx wrangler versions view <flows-upload-version-id> --config deploy/generated/mbza-development-flows-development.jsonc --json
npx wrangler versions view <flows-cleanup-version-id> --config deploy/generated/mbza-development-flows-development.jsonc --json
npx wrangler versions secret list --config deploy/generated/mbza-development-flows-development.jsonc --latest-version
npx wrangler versions view <api-version-id> --config deploy/generated/mbza-development-api-development.jsonc --json
npx wrangler versions view <dashboard-version-id> --config deploy/generated/mbza-development-dashboard-development.jsonc --json

# Promote one inspected version at 100 percent.
npx wrangler versions deploy --config deploy/generated/mbza-development-flows-development.jsonc --version-id <flows-cleanup-version-id> --percentage 100 --yes --message 'Activate verified MBZA Flows'
npx wrangler versions deploy --config deploy/generated/mbza-development-api-development.jsonc --version-id <api-version-id> --percentage 100 --yes --message 'Switch verified MBZA projects to Flows'
npx wrangler versions deploy --config deploy/generated/mbza-development-dashboard-development.jsonc --version-id <dashboard-version-id> --percentage 100 --yes --message 'Expose verified MBZA Flows UI'
```

After successful smoke tests, generate the route-free archive configs and
perform read-only/dry-run checks only:

```sh
node scripts/cloudflare-config.mjs --target mbza-development --environment development --service paywalls --allow-disabled --no-routes
node scripts/cloudflare-config.mjs --target mbza-development --environment development --service onboardings --allow-disabled --no-routes
npx wrangler delete --config deploy/generated/mbza-development-paywalls-development.jsonc --dry-run
npx wrangler delete --config deploy/generated/mbza-development-onboardings-development.jsonc --dry-run
npx wrangler d1 list --config deploy/generated/mbza-development-flows-development.jsonc --json
```

The dry runs are evidence only; do not repeat them without `--dry-run` during
the rollback window. Store the five current deployment/version responses under
`.flows-cutover/archive/` with permissions `0600`. A version id is not a backup
after its Worker is deleted, and Cloudflare secret values cannot be exported.

After 30 days, destructive Worker retirement requires a separate explicit
approval and one of these conditions:

- the rollback window is formally closed; or
- a tested recreation receipt contains the exact source/config hashes, a
  protected recovery-token escrow matching a prebuilt API rollback version,
  and a successful legacy-first recreation rehearsal.

Only then may the operator run `wrangler delete` without `--force`; the D1
databases are still never deleted automatically. If either dry run reports an
active dependency, stop. While the dormant Workers still exist, the rollback
API command is:

```sh
npx wrangler versions deploy --config deploy/generated/mbza-development-api-development.jsonc --version-id <recorded-legacy-api-version-id> --percentage 100 --yes --message 'Rollback MBZA API to recorded legacy bindings'
```
