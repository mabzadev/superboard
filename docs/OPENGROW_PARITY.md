# OpenGrow Parity Strategy

OpenGrow historically tracked a Rails upstream as a Cloudflare adaptation. The
comparison source was expected below `upstream/opengrow/*`. Those sources are
not present in the current platform checkout, so upstream parity is currently
**unverified**. The checked-in Cloudflare contracts, migrations, manifests and
tests remain authoritative for the new reference platform, but an empty
upstream inventory must never be presented as proof of Rails parity.

[ADR-001](./ADR-001-CANONICAL-OPENGROW-SOURCE.md) retires that historical
comparison as a release gate. `opengrow-platform` is now the canonical product
source; the fail-closed comparison remains available only as an optional
forensic tool when immutable historical sources are supplied.

## Current Baseline

- Upstream OpenGrow backend is Rails with PostgreSQL, Redis, Sidekiq, Devise,
  Doorkeeper, Active Storage, payment processor, RPush, MCP, and mobile push integrations.
- OpenGrow backend is a Hono Worker on Cloudflare Workers with D1-compatible SQL.
- the local inventory currently finds 315 Worker routes and 118 central API D1
  tables;
- `npm run migration:inventory` reports these local counts and explicitly emits
  `verification.status=upstream-unavailable` while the comparison source is
  absent;
- missing-route, extra-route, missing-table and missing-column fields are `null`,
  rather than misleading empty arrays, whenever no upstream comparison ran;
- `npm run migration:parity:check` is the fail-closed command for an actual
  upstream comparison. It exits non-zero until
  `upstream/opengrow/backend` is available.
- The Auth/Users module now follows the upstream Devise/Doorkeeper flows for
  client-validated registration, OAuth password/refresh tokens, invitations,
  password reset tokens, TOTP 2FA challenge/verification, identity SSO
  initiation/callback/refresh routes, and SVG QR setup.
- The platform configuration module now persists upstream-shaped iOS, Android,
  Desktop and Web configuration records, including APNs/FCM uploads, Android
  server API key metadata, linked Web domains, and Google Cloud setup script
  generation.
- Instance deletion now mirrors the upstream `DeleteInstanceJob` cleanup
  responsibilities inside the Worker route, rather than only detaching the
  current user's role.
- Dashboard analytics now read real D1 event and aggregate tables for overview
  metrics, daily link views, top links, campaign lists and campaign overview
  metrics instead of returning empty dashboard data.
- Audience visitor APIs now create and read upstream-shaped visitors from SDK
  and event ingestion, with visitor search, referral aggregation and visitor
  details backed by D1 event data.
- Purchase and revenue APIs now read real `purchase_events` rows for purchase
  search, product-level revenue metrics, dashboard revenue cards and the
  operator revenue views.
- Messaging now persists notification targets, creates notification messages for
  existing and new SDK visitors, exposes upstream SDK notification endpoints,
  tracks read counts, and renders the messaging table from real D1 rows.
- Event metric filters and billing active-user metrics run against D1; link CSV
  exports and usage CSV exports now create R2-backed `downloadable_files` and
  send the upstream-shaped export email.
- The account MCP section now lists and revokes real connected MCP tokens from
  `mcp_tokens`, with client-name resolution from `mcp_clients`.
- Push delivery now keeps the upstream RPush table contract, synchronizes
  APNs/FCM app rows from platform credentials, queues `rpush_notifications` for
  push-enabled campaigns and processes them through Cloudflare Worker routes
  using APNs token auth or FCM HTTP v1. Provider private keys and cached FCM
  bearer tokens are encrypted at rest; a bounded idempotent maintenance pass
  converges legacy plaintext rows, while conditional leases prevent concurrent
  consumers from sending the same notification.
- Apple and Google IAP webhooks now persist webhook logs, validated
  `purchase_events`, subscription state updates and protected subscription
  reconciliation on Cloudflare.
- Password reset and team invitation emails now use real Cloudflare-compatible
  HTTP mail delivery through Resend, Postmark, SendGrid, or a configured mail
  webhook instead of local-only token generation.
- Recurring Sidekiq maintenance work now has a Cloudflare cron replacement that
  backfills daily analytics tables and cleans expired R2 downloadable files.
- OpenGrow diagnostics endpoints now run on Workers with structured logs, D1/KV
  checks, protected access and intentional exception testing.
- OpenGrow admin and automation machine routes are available on Workers with
  `X-AUTH`/`ADMIN_API_KEY` for Firebase CSV link migration, event flushing,
  visitor automation metrics and link details. Legacy OpenGrow subscription
  writes were deliberately removed from the reference back-office surface.
- The Worker SDK route now supports both the existing Cloudflare `X-Api-Key`
  adapter and upstream OpenGrow `PROJECT-KEY`/`LINKSQUARED` endpoints for
  authenticate, device lookup, events, deferred link data, SDK link creation,
  visitor attributes, payment events and server SDK metrics.
- Public shortlink compatibility now covers upstream quick-link creation
  (`POST /create`), quick-link rendering/redirects, public wildcard routes and
  marketing-message wildcard routes. The unauthenticated placeholder
  `notifications/test` route was deliberately removed; real notification
  creation, search, inbox/read state and APNs/FCM delivery use authenticated
  project, SDK and processor contracts.
- MCP OAuth 2.1 and protected API routes now perform real D1 client
  registration, PKCE consent/token exchange, project, link, campaign, redirect,
  SDK setup and analytics operations behind bearer-token auth.
- Dashboard code remains a Cloudflare Pages adaptation of the upstream Next app.
- If historical upstream sources are restored, their exact repository URLs and
  immutable revisions must be recorded before parity is claimed. A moving
  `origin/main`, an absent directory or an empty result is not acceptable
  evidence.

## Porting Rules

1. When the historical upstream is deliberately restored, treat its recorded
   `backend/db/schema.rb` revision as the comparison source for tables, indexes
   and associations. Until then, do not claim upstream parity.
2. Keep Rails column names when possible. If the Worker already uses a Cloudflare
   compatibility name, keep both names until the Worker code can be safely moved.
3. Do not add permanent "not available" endpoints. If a feature is not fully
   implemented yet, back it with the upstream-shaped tables and make the missing
   behavior explicit in follow-up work.
4. Do not edit restored `upstream/opengrow/*` comparison sources for product
   work. Port behavior into `workers/api`, the domain Workers and
   `apps/dashboard`.
5. Prefer Cloudflare-native replacements for infrastructure:
   - D1 for PostgreSQL tables that fit relational storage.
   - R2 for Active Storage blobs and exports.
   - Queues or Workflows for Sidekiq-style background jobs.
   - KV only for cache/session-style data.
   - Workers Logs/Observability for production runtime logs.
6. Rust Workers are allowed by Cloudflare, but language choice is secondary to
   preserving OpenGrow behavior and schema compatibility.

## Historical comparison status

- The historical Rails source and the other former upstream repositories are
  not checked out. Consequently route/schema parity against them is not proven
  and is never shown as green. This is recorded provenance, not an active
  OpenGrow release blocker under ADR-001.
- An operator may restore exact immutable sources and run
  `npm run migration:parity:check` to discover useful historical behavior. The
  result cannot supersede the current canonical manifests, migrations and
  contracts without a reviewed product change.
- Background-job and internal service parity is still being worked module by
  module. The schema, route surface, primary dashboard flows, exports, mail,
  billing, push, IAP, MCP and public quick-link paths are no longer blocked by
  local placeholders.
