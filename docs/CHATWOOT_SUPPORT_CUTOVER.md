# Chatwoot to OpenGrow Support cutover

OpenGrow Support is the canonical conversation system. Legacy Messaging, the
old Dokploy Chatwoot stack and the current Cloudflare OpenChat runtime are
migration sources, not parallel long-term products. The VocoStar target declares
`https://chat.vocostar.com` as its `legacy-chatwoot` public surface while this
migration is open, so Grow reports its reachability. Remove that monitor only in
the reviewed release that records final retention and retirement.

As observed on 9 August 2026, `sup.vocostar.com` and
`chatwoot.app.vocostar.com` do not resolve, but `chat.vocostar.com` is online.
Its `/ready` endpoint returns HTTP 200 and reports the application, agent/widget,
webhook, realtime, D1 and R2 bindings present. This is not a complete readiness
proof: the `openchat-jobs` Worker has no `RESEND_API_KEY`, so transactional
e-mail is not operational even though `/ready` is green.

The live source is the public `mbzadev/openchat` fork. It deploys Workers
`openchat`, `openchat-jobs` and `openchat-realtime`, D1 `openchat-db`, R2
`openchat`, four webhook/e-mail Queue/DLQ resources and Vectorize
`openchat-captain-responses`. Aggregate, non-personal reads found 12 contacts,
11 conversations, 15 messages, one attachment, five web-widget channel rows and
two labels. Optional channel, integration, campaign, automation, Help Center,
Captain, SLA and telephony tables contain no active rows. The complete evidence
and convergence decision are in `docs/OPENCHAT_SUPPORT_CONVERGENCE.md`.

The retained VocoStar operations note also identifies an earlier deployment as
a Dokploy-managed Docker Compose stack behind Traefik. Its declared components
are `chatwoot-rails`, `chatwoot-sidekiq`, PostgreSQL 14 and Redis, with named
volumes `chatwoot-postgres-data` and `chatwoot-redis-data`. It does not identify
the Dokploy server, application ID or an operator credential. That source must
be found in Dokploy inventory/backups or explicitly proven empty/already
migrated; the live OpenChat D1 must not silently replace this forensic gate.

## What is migrated

The exporter retrieves paginated Chatwoot contacts, conversations, messages,
inboxes, agents, teams, labels, canned responses, custom attributes, automation
rules, webhooks, saved filters and agent bots. Every attachment is downloaded
from an explicit HTTPS host allowlist, bounded to 100 MiB and checksummed.

The transformer preserves the application contact identifier, conversation and
message ordering, assignments, labels, priority, private/public messages,
reply-to references and every attachment. Configuration secret-like keys are
removed recursively. Imported webhooks are disabled until their secrets are
rotated in OpenGrow. A conversation without a stable application identifier or
an attachment without checksum evidence blocks the entire plan.

## 1. Rehearse on the VocoStar test project

Create a mode-`0700` directory outside Git and export with the token only in the
process environment:

```bash
export CHATWOOT_ACCOUNT_ID='<numeric Chatwoot account ID>'
export CHATWOOT_API_ACCESS_TOKEN='<read-only Chatwoot application token>'
export CHATWOOT_ATTACHMENT_HOSTS='<optional comma-separated HTTPS attachment hosts>'

npm run chatwoot:export -- \
  --target vocostar --environment production \
  --output-directory /secure/opengrow/chatwoot/export-test
```

Before attempting an export, run the value-free, read-only preflight against
the current generated client:

```bash
npm run chatwoot:readiness -- \
  --target vocostar --environment production \
  --client-root /absolute/path/to/app-vocostar/Flutter
```

`--client-root` est obligatoire pour conclure sur la migration du client. Sans
ce paramètre, le rapport marque explicitement `client_migration.inspected=false`
et conserve `client-source-not-inspected` dans les blocages de retrait. Le scan
lit aussi les exports Flutter ignorés par Git (`generated_code/`) sans lire les
fichiers `.env`; un export ignoré ne peut donc plus produire un faux résultat
« aucun code legacy ».

It reports only environment-variable names and presence, DNS/HTTP status,
destination resource names and relative source paths. It never returns the API
token or reads a `.env` file.

The current read-only execution reports `ready_for_export=false` and
`ready_for_retirement=false`: the source now resolves and is reachable, but the
account ID and read-only API token are unavailable to the process, eight client
source files still refer to the legacy support integration, and the FlutterFlow metadata
mirror independently retains legacy Support action/widget declarations in
`lib/flutterflow_project/schemas.dart`.

The Chatwoot origin is read from the target-owned `legacy-chatwoot` monitor.
The exporter rejects `--base-url`, so a shell command, CI job or operator cannot
silently export from a different deployment. The account ID, read-only API
token and optional external attachment hosts stay in the process environment;
none is accepted as a committed target value.

The command never forwards the Chatwoot token to a different attachment host.
It writes `manifest.json`, NDJSON datasets, configuration and attachment files
with SHA-256 evidence. Keep the bundle encrypted at rest.

Run the non-mutating plan, then render idempotent Support upserts and the R2
object manifest:

```bash
npm run chatwoot:cutover -- plan \
  --target vocostar --environment production --project-id 12 \
  --bundle /secure/opengrow/chatwoot/export-test

npm run chatwoot:cutover -- render \
  --target vocostar --environment production --project-id 12 \
  --bundle /secure/opengrow/chatwoot/export-test \
  --output-directory /secure/opengrow/chatwoot/render-test
```

`project-id` must be present in the target's `supportProjectIds`. The rendered
SQL has no global transaction assumption: every statement is an idempotent
upsert and the apply checkpoint is the recovery mechanism.

## 2. Prepare schema and recovery evidence

Apply all Support schema migrations through the D1 converger before importing
business rows:

```bash
npm run cloudflare:d1:plan -- \
  --target vocostar --environment production --service support --remote-read
```

Do not continue unless the structured result has `remote_read=true`,
`converged=true`, `pending_migration_count=0`, and the Support database reports
an empty `pending_migrations` list. An unrecognized or unexpected remote
migration is a hard stop.

For a production apply, collect four independent non-empty backup artifacts,
each with byte length and SHA-256:

1. `chatwoot-postgres`: native Chatwoot PostgreSQL backup;
2. `chatwoot-storage`: the complete Chatwoot object-storage backup;
3. `chatwoot-export`: the protected export bundle/archive;
4. `module-support`: OpenGrow Support D1 export made immediately before import.

The approved window JSON is stored outside Git with mode `0600` and has this
contract:

```json
{
  "schema_version": 1,
  "window_id": "chatwoot-vocostar-test-2026-08-08",
  "starts_at": "2026-08-08T20:00:00Z",
  "ends_at": "2026-08-08T22:00:00Z",
  "opengrow_maintenance": { "enabled": true, "confirmed_at": "..." },
  "chatwoot_maintenance": { "enabled": true, "confirmed_at": "..." },
  "backup_receipt": {
    "artifacts": [
      {
        "name": "chatwoot-postgres",
        "bytes": 1,
        "sha256": "64 lowercase hex characters"
      },
      {
        "name": "chatwoot-storage",
        "bytes": 1,
        "sha256": "64 lowercase hex characters"
      },
      {
        "name": "chatwoot-export",
        "bytes": 1,
        "sha256": "64 lowercase hex characters"
      },
      {
        "name": "module-support",
        "bytes": 1,
        "sha256": "64 lowercase hex characters"
      }
    ]
  }
}
```

Do not fabricate maintenance evidence. Put the OpenGrow project in gateway
read-only maintenance and stop Chatwoot inbox/webhook writes before recording
the confirmations. Keep both systems closed until verification finishes.

## 3. Guarded, resumable import

The apply command needs `--apply`, an active window, exact confirmation, an
absolute checkpoint outside Git and `--allow-production`:

```bash
npm run chatwoot:apply -- \
  --target vocostar --environment production \
  --rendered /secure/opengrow/chatwoot/render-test \
  --window /secure/opengrow/chatwoot/window-test.json \
  --checkpoint /secure/opengrow/chatwoot/checkpoint-test.json \
  --apply --allow-production \
  --confirm "CHATWOOT:vocostar:production:12:chatwoot-vocostar-test-2026-08-08"
```

The tool rechecks all rendered and source hashes, uploads each R2 object, reads
it back and verifies its SHA-256, checkpoints that object, applies D1 upserts,
then checks imported contact/configuration/conversation/message/attachment row
counts. Re-running with the same protected checkpoint is idempotent. A mismatch
stops the operation; never edit the checkpoint or delete the unmatched rows.

## 4. Acceptance gates

Keep maintenance enabled while validating:

- `/infrastructure` reports Support healthy and displays its counters;
- Grow Support Inbox lists the imported conversations and all message history;
- contacts, assignment, labels, private notes, attachments and search work;
- a VocoStar test identity opens its existing conversation through
  `/api/v1/support-client`;
- realtime connect, typing, mark-read, new message, multiple attachments and
  CSAT work from the reference/mobile client;
- imported webhooks remain disabled, then work only after a new OpenGrow secret
  is configured;
- Chatwoot and Support counts are reconciled with the protected evidence.

Repeat the whole process for the production project with a new export, backups,
window and checkpoint. Reopen writes only on OpenGrow Support.

## 5. Remove the OpenChat and historical Chatwoot duplicates

Do not delete Chatwoot immediately after traffic cutover. During the agreed
retention period it stays network-restricted and read-only with its PostgreSQL,
storage backup and deployed version recorded. Monitor Support errors, webhook
failures, missing attachments and user reports.

After the retention/sign-off gate:

1. take final Chatwoot PostgreSQL and storage backups and verify restoration;
2. remove OpenChat routes/components from infrastructure and DNS, including
   `chat.vocostar.com`; `sup.vocostar.com` is already absent from DNS;
3. remove every Chatwoot/OpenChat URL, action, widget and state from
   FlutterFlow/environment configuration;
4. remove the legacy Messaging Worker, Queue, D1/R2 declarations only after its
   separate OpenGrow module cutover and retention are complete;
5. keep OpenGrow Support, `grow.vocostar.com` and
   `api.vocostar.com/api/v1/support-client` as the only support surfaces;
6. delete the OpenChat Workers, D1, R2, Queues, Durable Object and Vectorize only
   after verified recovery and retention sign-off;
7. record deletion IDs, timestamps, operator approval and recovery locations.

No deletion is performed by repository tests or by the baseline deployment.
DNS, Chatwoot data and Cloudflare resource removal are separately authorized
production operations.
