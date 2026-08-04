# Production Migration Inventory

This document is the migration contract before product implementation resumes.
It is generated from the current OpenGrow workspace plus `upstream/opengrow/*`
submodules pinned to GitHub `origin/main`.

Run the reproducible inventory with:

```bash
npm run migration:inventory
```

## Baseline Commits

| Repository | Commit |
|---|---|
| backend | `6a20f36994ca587cdeb554e08a25689c4f5240e8` |
| dashboard | `43b8fde26bf5d19b3fb1bdea6cb35d2f68e486b7` |
| mcp | `c01b4bca89d0475a817f6671ca42efa9bec02c28` |
| opengrow-js | `20fc5ab75e48697037daa3bc5b8b193dd679c35f` |
| opengrow-iOS | `fd90467273ac63752be93d84e961941b5bdf149c` |
| opengrow-Android | `1116eddf93507aab001e7d60080f38767af58b94` |
| opengrow-react-native | `864d3bee900a34b24fce334d81abdf32e41b27ea` |
| opengrow-flutter | `eec1c65b9732034db5b4679c65ded0b66e3e5c46` |
| opengrow-utils | `49e30506df68704acfb8402c3b64ea56f8a54d65` |

## Current Inventory

| Area | Upstream OpenGrow | Current OpenGrow |
|---|---:|---:|
| Routes | 170 | 199 Worker handlers |
| Tables | 60 | 60 D1 table names |
| Jobs | 20 | Cloudflare cron/manual route plus route-local ports |
| Services | 58 | Partial route-local logic |
| Models | 53 | No model layer |
| Serializers | 32 | Partial ad hoc response shaping |

The D1 table and column inventory now matches upstream locally after
`workers/opengrow/migrations/0005_opengrow_production_column_parity.sql`.

Current schema gate:

- missing tables: none
- extra tables: none
- tables with missing upstream columns: none

Current route gate:

- missing upstream routes: none
- extra Worker routes: Cloudflare compatibility, dashboard convenience,
  health, asset, and maintenance endpoints

This does not mean every internal Rails service has the same implementation
structure. It means the relational shape and public route surface no longer
block module-by-module production ports.

## Completed Production Modules

### 1. Baseline and schema contract

- Submodules are pinned to current `origin/main`.
- D1 has every upstream table name and every upstream column detected by the
  inventory script.
- Validation: `npm run migration:inventory`, `npm run typecheck`,
  `npm run test`, and `npm run dashboard:build`.

### 2. Authentication and users

- Registration validates the upstream OAuth client id before account creation.
- User creation and invitation acceptance persist OAuth access and refresh
  tokens instead of returning detached JWTs only.
- Passwords are written as bcrypt hashes compatible with Devise-style storage;
  the verifier still accepts existing OpenGrow PBKDF2 hashes for migration.
- OAuth password grant checks bcrypt/PBKDF2 hashes, enforces TOTP when enabled,
  and uses short-lived access tokens plus seven-day refresh tokens.
- Identity SSO routes are ported at `/api/v1/identity/sso/auth/:provider`,
  `/callback`, `/auth/failure` and `/tokens/refresh`. They build real
  Google/Microsoft OAuth URLs when provider secrets are configured, exchange
  callback codes for provider profiles, attach/create users, and rotate
  persisted dashboard tokens.
- Password reset uses a persisted reset token, unauthenticated token-based
  password change, expiry checks, and Devise-shaped responses.
- TOTP setup now stores Base32 secrets, returns a real SVG QR code, verifies the
  six-digit code before enabling/disabling 2FA, and exposes `otp_status`.
- Local smoke validation covered create account, `/api/v1/users/me`,
  `/oauth/token`, reset token password change, QR generation, enabling 2FA,
  OTP-required login challenge, and OTP login success through Wrangler local D1.
- Browser validation covered dashboard registration against the local Worker,
  persisted `access_token`, protected account navigation, and account 2FA UI
  rendering without mocked network routes.

Auth-adjacent mail delivery is now covered by module 13.

### 3. Instances, projects and platform configuration

- iOS, Android, Desktop and Web applications are persisted in the upstream
  `applications` plus platform configuration tables and returned through a
  OpenGrow-shaped `ApplicationSerializer` response.
- iOS setup persists `bundle_id`, `app_prefix`, `tablet_enabled`, APNs `.p8`
  upload metadata/content, and key id.
- Android setup persists `identifier`, `sha256s`, `tablet_enabled`, Firebase
  service account upload metadata/content, and Google Play API key metadata
  with the JSON key encrypted before storage.
- Web setup now uses the upstream-shaped `web_configuration_linked_domains`
  table with direct domain strings; `0006_web_configuration_linked_domains_upstream_shape.sql`
  removes the earlier blocking `domain_id` foreign key.
- Desktop setup persists fallback URL, generated-page flag, and macOS/Windows
  URI settings.
- Android Google Cloud setup script now returns an executable setup script with
  the instance RTDN push endpoint, authenticated Pub/Sub OIDC identity, and an
  exact audience instead of a self-hosted placeholder.
- Public `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  no longer emit fake placeholder app ids when no platform is configured.
- Local smoke validation covered iOS, Android, Web, Desktop config saves,
  configuration listing, Google setup script generation, APNs upload, Firebase
  upload, and Android API key upload through Wrangler local D1.
- Browser validation covered dashboard registration, persisted platform
  configuration rehydration on iOS, Android and Web setup pages, and real API
  calls against the local Worker without mocked network routes.
- `DELETE /instances/:id` now performs the production cleanup previously handled
  by upstream `DeleteInstanceJob`: notifications, notification messages,
  IAP/webhook rows, installed apps, purchase events, visitor state, link state,
  campaigns, redirect configs, platform applications/configurations, RPush rows,
  MCP rows, setup progress, subscriptions, downloadable file records, R2
  export objects, projects, roles and the instance are removed in dependency
  order.
- Local smoke validation covered deleting an instance with a real child link and
  notification, then verifying the deleted instance is no longer readable.

### 4. Dashboard analytics and campaign metrics

- Dashboard `metrics_overview`, `links_views`, and `top_links` now aggregate
  real D1 data instead of returning empty metrics. The Worker reads upstream
  daily aggregate tables when populated and falls back to raw `events` for
  immediate Cloudflare-local correctness.
- Campaign search and campaign metrics now aggregate events through linked
  campaign links instead of returning zero totals.
- Instance `get_started_setup` now reflects real iOS/Android/Web configuration,
  created links, created campaigns, and redirect fallback state so the dashboard
  does not hide analytics after data exists.
- The dashboard page no longer uses `next/dynamic` for client-only chart/card
  components under the Edge runtime; this removed the local `/dashboard` runtime
  `default` import failure seen during browser validation.
- Local smoke validation covered dashboard overview metrics, daily link views,
  top links, campaign list metrics, and campaign overview metrics after creating
  a real campaign/link and recording real events through the Worker.
- Browser validation covered local login, `/dashboard` rendering, dashboard
  metric cards, and Top Performing Links using the local Worker with no mocked
  network routes.

### 5. Audience visitors and referrals

- SDK and manual event ingestion now create/update upstream-shaped `visitors`
  rows linked to devices and projects, including `sdk_identifier` and
  `sdk_attributes`.
- Visitor search now returns real visitor rows, platform, pagination metadata
  and event totals from D1 instead of an empty collection.
- Visitor detail now returns the serialized visitor, own metrics, aggregated
  referral metrics shape and generated-link count.
- Referral search now aggregates events generated by visitor-owned links into
  the upstream referral response shape.
- Local smoke validation covered event ingestion with `sdk_identifier`,
  `/visitors/search`, and `/visitors/:visitorId` detail through Wrangler local
  D1.
- Browser validation covered local login and `/audience/visitors` rendering with
  a real visitor created from local Worker events.

### 6. Purchases and revenue dashboards

- `PUT /instances/:id/revenue_collection` now persists
  `revenue_collection_enabled` and returns the updated upstream-shaped instance.
- `POST /projects/:id/purchases/search` now returns real serialized
  `purchase_events` rows, including store validation, platform, price, currency,
  transaction, quantity and pagination fields.
- `POST /projects/:id/purchases/revenue` now aggregates purchase rows by
  product with platform JSON, units sold, first/repeat purchase counts, revenue,
  ARPU/LTV fields and cancellations.
- Dashboard overview metrics now fall back to `purchase_events` for revenue,
  units sold, cancellations and first-time purchases when daily aggregate rows
  have not yet been materialized.
- Local smoke validation covered revenue activation, raw purchase search,
  product revenue aggregation and dashboard overview revenue from a real D1
  purchase row.
- Browser validation covered authenticated `/revenue` with
  `NEXT_PUBLIC_OPENGROW_EE=true`, showing `pro_monthly`, iOS, 2 units and `$9.98`
  from the local Worker without mocked network routes.

### 7. Messaging and SDK notifications

- Notification creation now persists upstream-shaped `notification_targets`
  with platform, new-user and existing-user targeting instead of returning a
  target placeholder.
- Notification search now supports archived/new-user/search filters,
  pagination, target serialization, `access_url` and real `read_count` from
  `notification_messages`.
- Creating an existing-user notification now creates idempotent
  `notification_messages` for matching visitors. Creating a new-user
  notification now attaches messages when the SDK registers matching new
  visitors.
- SDK notification endpoints now cover upstream paths:
  `/notifications_for_device`, `/number_of_unread_notifications`,
  `/mark_notification_as_read` and `/notifications_to_display_automatically`.
- Public `/mm/:id` marketing-message rendering now serves stored notification
  HTML with basic dangerous-script/style-event stripping.
- Public `/mm/*value` wildcard compatibility is also available, matching the
  upstream marketing-message route shape.
- Local smoke validation covered dashboard message creation, SDK registration,
  SDK notification fetch, unread count, mark-as-read and dashboard read-count
  update from real D1 rows.
- Browser validation covered authenticated `/messaging` rendering with a real
  SDK-delivered notification showing title, subtitle, iOS target, New users,
  Views = 1 and auto-display status.

### 7b. Public quick links and public route compatibility

- `POST /create` now creates real upstream-shaped `quick_links`, assigns the
  live shortlink domain, generates a collision-checked path, persists platform
  targets and returns a serialized quick link.
- Quick link images are stored in R2 when an uploaded file is provided; if R2 is
  unavailable, the Worker returns a configuration error instead of silently
  dropping the file.
- `GET /*path` and `GET /:code` now resolve `quick_links` as well as project
  links. Platform-specific quick link targets redirect directly; links without
  targets render an HTML/social-preview page.
- `GET /public` and the public/go-subdomain wildcard routes are present so the
  Worker route surface matches the upstream Rails route contract.
- `GET /api/v1/notifications/test` is ported exactly for upstream
  compatibility.
- Local smoke validation covered `/create`, quick link redirect,
  `/api/v1/notifications/test`, `/public`, and the marketing-message wildcard
  against Wrangler local D1/R2.
- Browser validation covered a public quick-link HTML/social-preview page in
  Chromium against Wrangler local D1/R2 with no mocked network routes.

### 8. Event filters, billing usage metrics and CSV exports

- `GET /projects/:id/events/metric_values` now returns distinct event
  platforms, app versions and builds from real `events` rows.
- `POST /instances/:id/events/billing` now returns daily active-user values
  from `project_daily_active_users` with a raw-events fallback for immediate
  Cloudflare-local correctness.
- `POST /projects/:id/exports/links` now generates a real CSV artifact for link
  metrics, stores it in R2, records it in `downloadable_files`, sends the
  upstream-shaped download email, and returns the download URL.
- `POST /instances/:id/exports/usage` now generates a real active-user CSV
  artifact across production/test projects, stores it in R2, records it in
  `downloadable_files`, sends the upstream-shaped download email, and returns
  a download URL.
- Local smoke validation covered metric filter values, billing active users,
  link CSV generation/download and usage CSV generation/download from the
  Worker with real D1/R2 state.
- Browser validation covered authenticated `/dynamic_links/links` export action
  reaching the Worker and showing the export-preparation toast without console
  errors.

### 9. MCP dashboard token management

- `GET /mcp/tokens` now lists connected MCP tokens for the authenticated
  dashboard user, excluding revoked and refresh-expired tokens.
- Token names are resolved from `mcp_clients.client_name` when legacy token names
  equal the client id, matching the upstream dashboard behavior.
- `DELETE /mcp/tokens/:id` now performs a real soft revoke with `revoked_at` and
  returns 404 for missing or cross-user tokens.
- Local smoke validation covered token insertion, list schema, revoke, and
  disappearance from the dashboard token list.
- Browser validation covered `/account` rendering a real connected MCP app with
  status and last-used metadata.

### 10. Stripe billing, portal and subscription webhooks

- `GET /instances/:id/billing/mau` now computes current MAU from real
  `visitor_daily_statistics`, `visitors` and raw `events` data across production
  and test projects, using upstream `FREE_MAU_COUNT` semantics with a 10,000
  default.
- `GET /instances/:id/billing/subscription` and `/usage` now read real
  `stripe_subscriptions` or `enterprise_subscriptions` rows and return upstream
  404 responses when no active subscription exists instead of a self-hosted
  placeholder.
- `POST /instances/:id/billing/subscriptions` now creates a real Stripe hosted
  checkout session through the Stripe REST API when `STRIPE_SECRET_KEY` and
  `STRIPE_STANDARD_PRICE_ID` are configured, and stores the checkout session id
  in `stripe_payment_intents`.
- `GET /instances/:id/billing/stripe_portal` now creates a real Stripe billing
  portal session for active Stripe subscriptions instead of returning `url:null`.
- `DELETE /instances/:id/billing/subscription` now cancels the active Stripe
  subscription through Stripe and updates local subscription state.
- `POST /api/v1/webhooks/stripe` now verifies Stripe signatures, records
  idempotent `stripe_webhook_messages`, creates subscription rows on
  `checkout.session.completed`, and updates local subscription status on
  `customer.subscription.*` plus payment failure events.
- `POST /api/v1/webhooks/send_stripe_quotas` now sends current MAU usage records
  to Stripe subscription items when protected by `SENT_QUOTAS_WEBHOOK_KEY`.
- Local smoke validation covered no-subscription 404s, real MAU count from local
  data, missing Stripe configuration errors, unsigned webhook rejection, signed
  checkout and subscription-created webhook activation, TypeScript compile and
  Wrangler dry-run bundling.
- Browser validation covered authenticated `/settings` rendering the Free plan,
  MAU usage and upgrade controls without visible billing errors.

### 11. Push delivery and RPush compatibility

- Saving iOS push credentials now synchronizes upstream-shaped
  `Rpush::Apnsp8::App` rows for development and production APNs environments.
- Saving Android Firebase credentials now synchronizes an upstream-shaped
  `Rpush::Fcm::App` row with the Firebase project id and service-account JSON.
- Existing-user notification creation now creates `notification_messages` and
  queues `rpush_notifications` for iOS/Android devices with push tokens when
  `send_push` is enabled.
- New-user SDK registration now queues push notifications for matching
  new-user campaigns when the registering device has a push token.
- `POST /api/v1/push/process` now processes pending `rpush_notifications`
  behind `PUSH_PROCESS_KEY`, delivering via FCM HTTP v1 or APNs token auth and
  marking rows delivered or failed with provider errors.
- Local smoke validation covered Android RPush app synchronization, SDK device
  registration with a push token, queued `Rpush::Fcm::Notification` rows,
  protected processor access and failed-provider-state persistence using an
  intentionally invalid local key.
- Browser validation covered authenticated `/messaging` rendering the push
  notification column and existing campaign rows without visible errors.

### 12. Apple/Google IAP webhooks and subscription reconciliation

- `POST /api/v1/iap/apple/production/:path` and `/apple/test/:path` now accept
  App Store Server Notification payloads, decode JWS transaction payloads when
  present, persist `iap_webhook_messages`, create idempotent validated
  `purchase_events`, and update `subscription_states`.
- `POST /api/v1/iap/google/:path` accepts Google Play RTDN Pub/Sub payloads,
  verifies the Google-signed OIDC token, exact audience, verified service-account
  email, and provider purchase before persistence. Google license-test markers
  route the event to the test project; production purchases route to production.
- IAP event mapping now uses the upstream event vocabulary: `buy`, `cancel`,
  `refund`, and `refund_reversed`, with subscription vs one-time purchase type
  handling.
- `POST /api/v1/iap/reconcile_subscriptions` is protected by
  `IAP_PROCESS_KEY` and rebuilds latest `subscription_states` from persisted
  subscription purchase events as a Cloudflare-native replacement for correction
  jobs.
- Local smoke validation covered Apple and Google webhook ingestion, purchase
  row creation, subscription-state updates, protected reconciliation access and
  reconciliation execution.

### 13. Mail delivery for reset password and invitations

- Password reset now looks up the user, persists the reset token and sends the
  dashboard `/new_password?token=...` link through a configured real mail
  provider instead of leaving the token only in D1.
- Team invitations now create/update the invited user, persist the invitation
  token, send the dashboard `/accept-invite?token=...` link, and only stamp
  `invitation_sent_at` after the provider accepts the message.
- The Worker supports Cloudflare-compatible HTTP mail transports:
  `MAIL_PROVIDER=resend`, `postmark`, `sendgrid`, or `webhook`, with provider
  secrets supplied through Worker secrets/vars.
- Local smoke validation covered reset email delivery through a local HTTP mail
  webhook, invitation delivery through the same webhook, reset token
  consumption, invitation acceptance, timestamp persistence and cleanup of test
  rows.

### 14. R2-backed downloadable exports

- `downloadable_files` now maps generated CSV files to Cloudflare R2 objects
  rather than KV values, matching the Cloudflare storage replacement for
  upstream Active Storage.
- Export objects include `text/csv` metadata, download content disposition,
  private no-store response headers, and an object metadata expiry timestamp.
- The Worker is configured with an `R2` bucket binding for `opengrow-files` and a
  local preview bucket for Wrangler validation.
- Local smoke validation covered link export creation, usage export creation,
  download endpoint reads from R2, CSV content checks and two captured
  `Data export - opengrow` emails.

### 15. Cloudflare scheduled maintenance jobs

- The Worker now exports a Cloudflare `scheduled` handler and `wrangler.toml`
  cron trigger (`*/10 * * * *`) as the Sidekiq replacement for recurring
  maintenance work.
- `runMaintenance` backfills the last three days of
  `visitor_daily_statistics`, `link_daily_statistics`,
  `project_daily_active_users`, and `daily_project_metrics` from real D1 event
  and purchase data.
- The job deletes expired R2 downloadable files and removes their
  `downloadable_files` rows, matching upstream `DeleteFileJob` behavior.
- `POST /api/v1/automation/run_maintenance` is protected by
  `MAINTENANCE_PROCESS_KEY` for manual smoke tests and operations.
- Local smoke validation covered forbidden access without the key, protected
  execution, aggregate row writes, and Wrangler's local scheduled-event trigger.

### 16. Diagnostics and Worker log validation

- OpenGrow upstream diagnostics routes are now available under
  `/api/v1/diagnostics/test_logs`, `/test_diagnostics`, and `/test_exception`
  for GET and POST.
- Diagnostics are protected by `DIAGNOSTICS_API_KEY` through
  `x-diagnostics-key`, Bearer auth, or `api_key`, matching the upstream machine
  endpoint pattern.
- `test_logs` emits structured Cloudflare Worker logs at the requested level
  and persists diagnostic log rows in `diagnostics_logs`.
- `test_diagnostics` exercises real D1 and KV operations, inserts/updates/
  cleans diagnostic rows, returns timing/error summaries, and logs the health
  summary for observability.
- `test_exception` intentionally raises after writing a structured error log,
  so Cloudflare observability can verify exception capture.
- Local smoke validation covered unauthenticated 401, warn log generation,
  healthy D1/KV diagnostics, and intentional exception HTTP 500.

### 17. Admin and automation machine routes

- `/api/v1/admin/create_enterprise_subscription` and
  `/api/v1/admin/update_enterprise_subscription` now persist real
  `enterprise_subscriptions` rows and preserve the upstream success/error
  contract.
- `/api/v1/admin/migrate_firebase_links` accepts a real CSV upload, maps
  Firebase deeplink/short-link prefixes, writes dashboard links against the
  project domain and returns created/skipped counts.
- `/api/v1/admin/flush_events` replaces the upstream Redis flush by marking D1
  queued events as processed/discarded, then running the same maintenance
  aggregation used by the cron path.
- `/api/v1/automation/metrics_for_user` and `/details_for_link` now use the
  upstream `X-AUTH`/`ADMIN_API_KEY` machine auth and return real visitor/link
  metrics from D1 events, purchases, domains and generated links.
- These endpoints intentionally share the upstream `ADMIN_API_KEY` rather than
  the local maintenance or diagnostics keys.

### 18. Upstream SDK compatibility routes

- `/api/v1/sdk/authenticate` and `/device_for_vendor_id` now accept the OpenGrow
  upstream `PROJECT-KEY`, `PLATFORM`, `IDENTIFIER` and `LINKSQUARED` credential
  model while preserving the existing `X-Api-Key` Cloudflare adapter.
- `/api/v1/sdk/event`, `/data_for_device`, `/data_for_device_and_url`,
  `/data_for_device_and_path`, `/link_details`, `/create_link`,
  `/visitor_attributes`, `/add_payment_event`, `/generate_link`,
  `/link/:path`, `/metrics_for_link/:path` and `/metrics_for_project` are backed
  by real D1 devices, visitors, links, events and purchase rows.
- SDK-created links are stored with `sdk_generated`, project domain,
  redirect config, visitor ownership, tracking fields, tags and JSON data.
- Local smoke validation covered upstream SDK authenticate, event ingestion,
  SDK link creation, link details, visitor attribute update, server SDK link
  lookup and project/link metrics.

### 19. MCP protected API routes

- The Worker MCP API now includes protected equivalents for upstream status,
  validate, usage, token self-revocation, project creation, link CRUD/search,
  campaign CRUD/search, redirect setup, SDK setup and analytics endpoints.
- MCP endpoints accept real `mcp_tokens` bearer tokens and also support existing
  dashboard OAuth bearer tokens for local/dashboard-initiated management paths.
- Link, campaign, redirect and project operations write to the same D1 tables
  as dashboard and SDK routes instead of returning placeholder tool responses.
- MCP OAuth 2.1 discovery now has matching top-level `/register`, `/authorize`
  and `/token` Worker routes. The flow persists dynamic clients, PKCE auth
  codes, access tokens and refresh tokens in the upstream-compatible MCP tables.
- MCP SDK and redirect setup now accept the official OpenGrow MCP client query
  parameters (`project_id`, `instance_id`) and write real platform rows for
  iOS, Android, desktop applications and redirect variations.

## Main Implementation Gaps

The inventory currently reports no placeholder implementation markers, no
missing D1 tables and no missing upstream columns. The remaining work is
production hardening around infrastructure choices and full external-provider
credential rollout rather than a blocker in the primary dashboard/API paths.

## Production Module Order

1. Baseline and schema contract
   - Update submodules to `origin/main`.
   - Keep `npm run migration:inventory` green as the contract.
   - Success: no missing tables; no missing columns for the module being migrated.

2. Authentication and permissions
   - Port Devise/Doorkeeper semantics: password grant, refresh/revoke, reset,
     invitations, roles, TOTP 2FA, SSO decision.
   - Success: register, login, refresh, revoke, invite, accept invite, 2FA and
     role checks pass browser and API tests.

3. Instances, projects and platform configuration
   - Port instance provisioning, projects, domains, iOS/Android/Web/Desktop
     configuration, server API keys, verification files.
   - Success: dashboard can configure all app platforms and generated files
     match upstream shape.

4. Links and public redirects
   - Port link management, previews, custom redirects, quick links and public
     redirect orchestration.
   - Success: dashboard-created links redirect correctly per platform and record
     real events.

5. SDK ingestion and visitors
   - Port device auth, device updates, events, visitor attributes, attribution
     and visitor merge behavior.
   - Success: OpenGrow SDK e2e paths can authenticate, create/read links, submit
     events and update visitor attributes.

6. Analytics and dashboard metrics
   - Port event queries, daily aggregations, link/campaign/project metrics and
     scheduled backfills.
   - Success: dashboard metrics change from real events without empty metrics.

7. Notifications and push delivery
   - Port notifications, targets, messages, APNs/FCM/RPush replacement workers.
   - Success: notification created in dashboard appears through SDK, unread/read
     counts update and push jobs are traceable.

8. Billing, quotas, Stripe and IAP
   - Port Stripe checkout/portal/webhooks, MAU usage, quotas, Apple/Google IAP.
   - Success: payment/IAP webhooks update subscriptions, purchases and revenue UI.

9. Exports, files and mail
   - Port Active Storage to R2, export jobs, downloadable files and mailers.
   - Success: link/usage exports produce R2 files and notification email flow.

10. MCP, admin, automation and diagnostics
    - Port MCP OAuth 2.1, MCP tools, admin endpoints, automation endpoints and
      Cloudflare-native diagnostics.
    - Success: MCP client can register, authorize, create links/campaigns and
      read analytics; protected admin endpoints require configured keys.

## Validation Gate Per Module

Each module must pass:

```bash
npm run migration:inventory
npm run typecheck
npm run test
npm run dashboard:build
```

When a browser-facing flow changes, also run the relevant Playwright test or a
real browser validation against the local dev server. A module is not complete
while its primary UI path depends on mocks, empty metrics, or "not available"
responses.
