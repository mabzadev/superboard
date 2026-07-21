# OpenGrow Parity Strategy

OpenGrow tracks OpenGrow upstream as a Cloudflare adaptation, not as a reduced clone.
The goal is to keep the data model, route surface, and dashboard behavior as close
as possible to `upstream/opengrow/*`, changing only the infrastructure pieces that
cannot run directly on Cloudflare.

## Current Baseline

- Upstream OpenGrow backend is Rails with PostgreSQL, Redis, Sidekiq, Devise,
  Doorkeeper, Active Storage, Stripe, RPush, MCP, and mobile push integrations.
- OpenGrow backend is a Hono Worker on Cloudflare Workers with D1-compatible SQL.
- `workers/opengrow/migrations/0004_opengrow_full_parity_schema.sql` brought the D1
  table list closer to upstream.
- `workers/opengrow/migrations/0005_opengrow_production_column_parity.sql` closes the
  remaining upstream column gaps detected by `npm run migration:inventory`.
  The table and column contract is now green locally.
- `npm run migration:inventory` now also reports no upstream OpenGrow route missing
  from the Worker route surface.
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
  enterprise revenue page.
- Messaging now persists notification targets, creates notification messages for
  existing and new SDK visitors, exposes upstream SDK notification endpoints,
  tracks read counts, and renders the messaging table from real D1 rows.
- Event metric filters and billing active-user metrics run against D1; link CSV
  exports and usage CSV exports now create R2-backed `downloadable_files` and
  send the upstream-shaped export email.
- The account MCP section now lists and revokes real connected MCP tokens from
  `mcp_tokens`, with client-name resolution from `mcp_clients`.
- Stripe billing now uses real subscription rows, hosted checkout, billing
  portal sessions, signed Stripe webhooks, local webhook idempotence, Stripe
  subscription status updates and MAU usage reporting.
- Push delivery now keeps the upstream RPush table contract, synchronizes
  APNs/FCM app rows from platform credentials, queues `rpush_notifications` for
  push-enabled campaigns and processes them through Cloudflare Worker routes
  using APNs token auth or FCM HTTP v1.
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
- OpenGrow admin and automation machine routes are now available on Workers with
  `X-AUTH`/`ADMIN_API_KEY`, enterprise subscription writes, Firebase CSV link
  migration, event flushing, visitor automation metrics and link details.
- The Worker SDK route now supports both the existing Cloudflare `X-Api-Key`
  adapter and upstream OpenGrow `PROJECT-KEY`/`LINKSQUARED` endpoints for
  authenticate, device lookup, events, deferred link data, SDK link creation,
  visitor attributes, payment events and server SDK metrics.
- Public shortlink compatibility now covers upstream quick-link creation
  (`POST /create`), quick-link rendering/redirects, public wildcard routes,
  marketing-message wildcard routes and `notifications/test`.
- MCP OAuth 2.1 and protected API routes now perform real D1 client
  registration, PKCE consent/token exchange, project, link, campaign, redirect,
  SDK setup and analytics operations behind bearer-token auth.
- Dashboard code remains a Cloudflare Pages adaptation of the upstream Next app.
- The authoritative production baseline is the latest `origin/main` commit for
  each `upstream/opengrow/*` submodule, not an older checked-out submodule pointer.

## Porting Rules

1. Treat `upstream/opengrow/backend/db/schema.rb` as the source of truth for tables,
   indexes, and associations.
2. Keep Rails column names when possible. If the Worker already uses a Cloudflare
   compatibility name, keep both names until the Worker code can be safely moved.
3. Do not add permanent "not available" endpoints. If a feature is not fully
   implemented yet, back it with the upstream-shaped tables and make the missing
   behavior explicit in follow-up work.
4. Do not edit `upstream/opengrow/*` for product work. Port behavior into
   `workers/opengrow` and `apps/dashboard`.
5. Prefer Cloudflare-native replacements for infrastructure:
   - D1 for PostgreSQL tables that fit relational storage.
   - R2 for Active Storage blobs and exports.
   - Queues or Workflows for Sidekiq-style background jobs.
   - KV only for cache/session-style data.
   - Workers Logs/Observability for production runtime logs.
6. Rust Workers are allowed by Cloudflare, but language choice is secondary to
   preserving OpenGrow behavior and schema compatibility.

## Known Remaining Gaps

- Background-job and internal service parity is still being worked module by
  module. The schema, route surface, primary dashboard flows, exports, mail,
  billing, push, IAP, MCP and public quick-link paths are no longer blocked by
  local placeholders.
