# SuperBoard Support and legacy Messaging

This filename is retained for old links. SuperBoard Support is the canonical
conversation implementation. `workers/messaging` is disabled by default and is
kept only to read/migrate installations created before target schema version 5.

## Identity and public access

The Identity Worker is the application authentication authority. Support never
creates an account or long-lived application session. Flutter/FlutterFlow calls
the API gateway at `/api/v1/support-client`; the gateway forwards only the
application bearer token and the allowlisted `X-SuperBoard-Project-Id` through the
private `SUPPORT_MODULE` binding. No standalone public Messaging domain is
required.

## Canonical isolation

- Worker: target-defined Support Worker, for example `opengrow-support`;
- D1: target `moduleD1.support`;
- R2: target `moduleR2.support`;
- Queue + DLQ: target `moduleQueues.support`;
- Durable Object: one `ConversationRoom` instance per conversation;
- API/dashboard access: private Service Binding and signed project context;
- mobile access: authenticated API gateway proxy;
- project allowlist: target `supportProjectIds`, enforced fail-closed.

Billing does not depend on Support. Support cannot mutate entitlements,
purchases, refunds or financial jobs.

## Guarantees

- client conversation/message IDs make retries idempotent;
- Durable Objects assign persistent sequences and broadcast through hibernating
  WebSockets;
- one-use short-lived realtime tickets prevent dashboard credentials from being
  forwarded to a Durable Object;
- attachments are ownership-checked, streamed and normalized in
  `support_message_attachments`, including multiple attachments per message;
- private notes are excluded from customer history, unread counts and public
  WebSocket broadcasts;
- contacts, companies, notes, participants, drafts, CSAT and agent
  notifications have dedicated tables;
- status, priority, assignment, configuration and secret rotations are audited;
- webhook secrets use authenticated encryption and are never returned;
- outbound events use a dedicated Queue/DLQ with idempotent delivery records;
- public failures expose bounded stable error contracts;
- `/internal/v1/health` exposes only aggregate operational counters.

## FlutterFlow compatibility

`superboard_flutterflow` 3.0 integrates Support/Messaging directly and exposes
the canonical `superboardSupport*` action names. The frozen
`opengrow_flutterflow_messaging` 1.3 package and its `opengrowSupport*` /
`opengrowMessaging*` symbols exist only for rollback and compatibility; new
projects must not add that second package.

The package covers configuration, conversations, messages, multiple
attachments, download, read state, typing, realtime reconnect and CSAT. Its
`supportUrl` should be the API gateway prefix, for example
`https://api.mbza.dev/api/v1/support-client`.

## Chatwoot and legacy retirement

Chatwoot export, deterministic conversion, attachment transfer, D1 upserts,
checkpoint verification and retirement are defined in
`CHATWOOT_SUPPORT_CUTOVER.md`. Legacy Messaging-to-Support module backfill is
defined in `MODULE_CUTOVER_RUNBOOK.md`.

Do not delete the old Worker, database, bucket, Chatwoot service or DNS based on
a successful build alone. Deletion requires protected backups, test and
production cutovers, row/evidence verification, an observation window and an
explicit production approval.
