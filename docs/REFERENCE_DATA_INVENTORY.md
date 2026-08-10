# OpenGrow reference data and FlutterFlow inventory

This inventory is the implementation map for `opengrow-platform` and
`opengrow-reference`. It distinguishes the reusable baseline from the legacy data
that still has to be migrated out of the central VocoStar database.

## Reference FlutterFlow pages

| Page              | Common capability under test                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap         | target endpoints, SDK startup and visible diagnostics                                                                                                                                              |
| Sign in           | email/password, Google and Apple identity                                                                                                                                                          |
| Create account    | registration, allowlist and verification email                                                                                                                                                     |
| Password recovery | transactional email and development capture                                                                                                                                                        |
| Home              | authenticated user and enabled-feature summary                                                                                                                                                     |
| Profile           | user attributes, logout and account deletion                                                                                                                                                       |
| Notifications     | permission, push token and inbox state                                                                                                                                                             |
| Files             | upload, progress, list, download and deletion                                                                                                                                                      |
| Products          | offerings, products, entitlements, purchase and restore                                                                                                                                            |
| Paywall           | remote placement, rendering and event tracking                                                                                                                                                     |
| Dynamic links     | creation, opening and attribution data                                                                                                                                                             |
| Support inbox     | conversations, messages, attachments, realtime and CSAT                                                                                                                                            |
| Marketing consent | newsletter opt-in/out and subscription preferences                                                                                                                                                 |
| Onboarding        | remote flow, progression and completion                                                                                                                                                            |
| Custom extension  | authenticated durable `reference.echo` cycle and exact-revision `reference.acceptance` receipt through the public SDK facade, project/owner scoping, pagination and idempotency conflict detection |
| Diagnostics       | environment, endpoints, versions and sanitized errors                                                                                                                                              |

The reference is a runnable Flutter application with safe demo and authenticated
live modes. It is the executable acceptance specification for the future fresh
FlutterFlow project. It does not copy VocoStar pages and has no direct Chatwoot
client.

Its deployment contract is the strict, versioned
`opengrow-reference/reference.project.json` manifest. It binds the `dev` branch to
the GitHub `development` Environment, the assets-only Worker
`opengrow-reference-app-dev` and `https://reference.mbza.dev`. Account ID and API
token remain GitHub Environment secrets and are intentionally absent from the
manifest. The generated Wrangler file is ignored.

### Complete reference build configuration

| Dart define                    | Example on MBZA                                  | Secret?                                       |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| `OPENGROW_ENVIRONMENT`         | `development`                                    | no                                            |
| `OPENGROW_TARGET`              | `mbza-development`                               | no                                            |
| `OPENGROW_API_URL`             | `https://api.mbza.dev`                           | no                                            |
| `OPENGROW_SDK_URL`             | `https://sdk.mbza.dev`                           | no                                            |
| `OPENGROW_SUPPORT_URL`         | `https://api.mbza.dev/api/v1/support-client`     | no                                            |
| `OPENGROW_SHORT_LINKS_URL`     | `https://in.mbza.dev`                            | no                                            |
| `OPENGROW_FILES_URL`           | `https://files.mbza.dev`                         | no                                            |
| `OPENGROW_MAIL_PREVIEW_URL`    | `https://mail.mbza.dev`                          | no                                            |
| `OPENGROW_PROJECT_ID`          | provisioned test project numeric ID              | no                                            |
| `OPENGROW_PROJECT_KEY`         | provisioned SDK access key                       | yes; CI/FlutterFlow secret                    |
| `OPENGROW_SDK_PLATFORM`        | `web`                                            | no                                            |
| `OPENGROW_SDK_IDENTIFIER`      | `reference.mbza.dev`                             | no; must match the registered SDK application |
| `OPENGROW_PROJECT_ENVIRONMENT` | `test`                                           | no                                            |
| `OPENGROW_LIVE_MODE`           | `false` by default, `true` for integration tests | no                                            |

All endpoint values are validated as absolute HTTPS URLs. Demo mode exercises
contracts without remote writes; live mode refuses to start without both a
project key and a positive project ID.

## Grow back-office pages

The dashboard route catalogue is the operator-facing surface of the baseline:

| Area          | Routes                                                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview      | `/dashboard`, `/infrastructure`, `/account`, `/project-settings`                                                                                                                                               |
| Application   | `/app/customers`, `/app/referrals`, `/app/access-key`, `/app/libraries`, `/app/android-setup`, `/app/ios-setup`, `/app/web-setup`                                                                              |
| Products      | `/products/customers`, `/products/offerings`, `/products/entitlements`, `/products/purchases`                                                                                                                  |
| Paywalls      | `/paywalls`, `/paywalls/statistics`                                                                                                                                                                            |
| Dynamic Links | `/dynamic-links/links`, `/dynamic-links/campaigns`, `/dynamic-links/campaigns/:id`, `/dynamic-links/domain`, `/dynamic-links/redirect-rules`, `/dynamic-links/social-media-preview`, `/dynamic-links/tracking` |
| Support       | `/support/inbox`, `/support/contacts`, `/support/configuration`, `/support/quality`                                                                                                                            |
| Marketing     | `/marketing/campaigns`, `/marketing/email`, `/marketing/in-app-messages`, `/marketing/settings`, `/marketing/statistics`                                                                                       |
| Onboardings   | `/onboardings`, `/onboardings/statistics`                                                                                                                                                                      |

`/infrastructure` is the source of truth for API capabilities, enabled/disabled
Workers, current health, sanitized runtime metrics, D1-derived counters and
custom application job state. Support replaces both the old Messaging screen
and the embedded Chatwoot administration path.
Private Service Binding health and public routed-HTTPS health are displayed as
separate signals. The latter includes the HTTP status and latency of every
standard target domain plus Git-declared `publicSurfaceMonitors`, including the
MBZA reference application. The standard set includes the target MCP endpoint;
Email and Marketing health detail is also normalized into the Background jobs
card so queued, sending, failed, bounced, complained and dead-letter work is
visible without direct D1 access.

## Reusable FlutterFlow custom code

Widgets supplied by the OpenGrow library:

- `OpenGrowBootstrap`
- `OpenGrowPaywall`
- `OpenGrowOnboarding`
- `OpenGrowRestorePurchasesButton`
- `OpenGrowCustomerCenter`

Actions supplied by the OpenGrow libraries:

- identity: `opengrowInitialize`, `opengrowInitializeAuto`,
  `opengrowInitializeAuthenticated`, `opengrowIdentify`,
  `opengrowSetUserAttributesJson`, `opengrowSetPushToken`;
- application identity: `opengrowApplicationInitialize`,
  `opengrowApplicationRestoreSessionJson`,
  `opengrowApplicationCurrentSessionJson`, registration,
  password/provider/anonymous sign-in, secure refresh rotation, password reset,
  profile, logout, account deletion and disposal actions declared in
  `config/flutterflow-custom-code.json`. The SDK is the only encrypted token
  store; the reference application intentionally owns no second token store;
- marketing preferences: `opengrowApplicationMarketingPreferencesJson` and
  `opengrowApplicationUpdateMarketingConsentJson`; the API derives the verified
  subscriber identity and calls Marketing through a signed private binding;
- files: list, upload, download and delete actions declared in the same
  canonical manifest;
- custom jobs: `opengrowApplicationCreateCustomJobJson`,
  `opengrowApplicationListCustomJobsJson` and
  `opengrowApplicationGetCustomJobJson`, plus owner-scoped
  `opengrowApplicationCancelCustomJobJson`; the SDK exchanges the application
  session for a short-lived identity token and never exposes the private
  `CUSTOM_WORKER_TOKEN`. Failed-job retry remains an administrator-only Grow
  operation;
- purchases: `opengrowPurchaseLogin`, `opengrowPurchaseLogout`,
  `opengrowPurchase`, `opengrowRestore`, `opengrowSync`,
  `opengrowHasEntitlement`, `opengrowGetOfferings`,
  `opengrowGetCustomerInfoJson`, `opengrowGetVirtualCurrenciesJson`,
  `opengrowGetPurchaseConfigurationJson`, `opengrowGetCustomerCenterJson`,
  `opengrowGetLastPurchaseResultJson`,
  `opengrowGetLastVerifiedCustomerInfoJson`, `opengrowGetEntitlements`,
  `opengrowOpenSubscriptionManagement`, `opengrowRecordCertificationResultJson`;
- links/events: `opengrowGenerateLinkJson`, `opengrowGetLastDeepLinkJson`,
  `opengrowRecordCustomerEvent`, `opengrowRecordCustomerEventsJson`;
- support: `opengrowSupportInitializeAuthenticated`,
  `opengrowSupportOpenConversation`, `opengrowSupportGetConfigurationJson`,
  `opengrowSupportListConversationsJson`, `opengrowSupportMessagesJson`,
  `opengrowSupportSend`, `opengrowSupportSendAdvanced`,
  `opengrowSupportUploadAttachmentJson`,
  `opengrowSupportDownloadAttachment`, `opengrowSupportSendAttachment`,
  `opengrowSupportConnectRealtime`, `opengrowSupportDisconnectRealtime`,
  `opengrowSupportMarkRead`, `opengrowSupportSetTyping`,
  `opengrowSupportSubmitCsatJson`,
  `opengrowSupportGetLastRealtimeEventJson`, `opengrowSupportDispose`.

Les quatre flux publics sont également inventoriés : résultat d'achat,
CustomerInfo vérifié, événement Support et alias Messaging. Le manifeste couvre
au total 5 widgets, 89 actions, 4 flux et les 16 fichiers Dart qui les portent.
Le Dashboard relie chaque fichier à la branche Git de développement; la CI
refuse tout symbole public ou fichier source absent du manifeste, ainsi que tout
nom déclaré qui n'est plus exporté.

The old `opengrowMessaging*`, `opengrowGetUnreadMessageCount` and
`opengrowDisplayMessages` names remain visible as temporary compatibility
aliases in the package; new FlutterFlow work uses only `opengrowSupport*`.

App-specific FlutterFlow custom code is allowed only as a thin UI adapter. A
network protocol, business rule or reusable widget belongs in `opengrow-platform`.

## Reference application state

| State                      | Lifetime                 | Owner                                                  |
| -------------------------- | ------------------------ | ------------------------------------------------------ |
| `environment`              | build                    | target (`development` or `production`)                 |
| `apiBaseUrl`               | build                    | target manifest                                        |
| `sdkBaseUrl`               | build                    | target manifest                                        |
| `supportBaseUrl`           | build                    | target manifest (`/api/v1/support-client`)             |
| `mailPreviewBaseUrl`       | build                    | target manifest                                        |
| `projectId`                | build                    | Support project allowlist                              |
| `sdkPlatform`              | build                    | registered SDK application (`ios`, `android` or `web`) |
| `sdkIdentifier`            | build                    | bundle ID, package name or Web domain                  |
| `projectEnvironment`       | build                    | Access Key project (`test` or `production`)            |
| `liveMode`                 | build                    | demo/live acceptance mode                              |
| `shortLinksBaseUrl`        | build                    | target manifest                                        |
| `filesBaseUrl`             | build                    | target manifest                                        |
| `projectKey`               | secure configuration     | OpenGrow project                                       |
| `applicationAccessToken`   | secure storage           | auth gateway                                           |
| `applicationRefreshToken`  | encrypted device storage | application identity                                   |
| `currentUserId`            | session                  | authenticated profile                                  |
| `lastDeepLinkJson`         | memory                   | SDK callback                                           |
| `lastPurchaseResultJson`   | memory                   | purchase callback                                      |
| `lastCustomerInfoJson`     | memory                   | verified billing state                                 |
| `lastSupportEventJson`     | memory                   | Support realtime callback                              |
| `lastNotificationJson`     | memory                   | notification result                                    |
| `lastFileJson`             | memory                   | Files result                                           |
| `lastMarketingConsentJson` | memory                   | consent result                                         |
| `lastOnboardingJson`       | memory                   | onboarding result                                      |
| `lastCustomJobJson`        | memory                   | project/owner-scoped custom Worker receipt or state    |
| `lastIntegrationError`     | memory                   | sanitized integration error                            |

No SMTP password, Cloudflare token, OAuth provider secret or signing key is an
application-state value.

## Physical data stores in the complete development baseline

| Binding/store                         | Role                                                                                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| central API D1                        | OpenGrow operators, projects, OAuth, notifications, compatibility data and billing ledger during migration                                                                                                                                                      |
| API KV                                | ephemeral configuration, cache and coordination                                                                                                                                                                                                                 |
| common files R2                       | controlled application uploads/downloads                                                                                                                                                                                                                        |
| dashboard cache R2                    | OpenNext incremental cache                                                                                                                                                                                                                                      |
| Identity D1                           | application users, linked identities, sessions, refresh tokens and auth rate limits                                                                                                                                                                             |
| Files D1                              | file ownership, metadata, state and retention records                                                                                                                                                                                                           |
| legacy Messaging D1 + R2              | disabled migration source retained only until Support cutover retention ends                                                                                                                                                                                    |
| Email D1                              | captured messages and delivery attempts                                                                                                                                                                                                                         |
| App D1                                | customers, referrals, access keys and events                                                                                                                                                                                                                    |
| Products D1                           | product catalogue, offerings, entitlements and purchases                                                                                                                                                                                                        |
| Paywalls D1                           | paywalls, versions, placements, variants and events                                                                                                                                                                                                             |
| Dynamic Links D1                      | links, domains, campaigns, redirects and analytics                                                                                                                                                                                                              |
| Support D1 + R2                       | contacts, conversations, messages, automation and attachments                                                                                                                                                                                                   |
| Marketing D1 + R2                     | subscribers (including application identity linkage), consent, suppressions, public/private lists, templates, campaigns and media                                                                                                                               |
| Onboardings D1                        | flows, versions, placements, variants and events                                                                                                                                                                                                                |
| Reference Custom D1                   | durable `reference.echo` jobs and strict `reference.acceptance` receipts used to prove create/list/detail/cancel semantics, exact build provenance, all sixteen journeys, project/owner scoping, pagination, stats, idempotency and target-configured retention |
| Application Custom D1 (when declared) | application-only jobs; VocoStar uses `opengrow_custom_jobs`, an exactly-once cancellation refund ledger and its retained business database                                                                                                                      |

Queues and DLQs exist independently for events, push, maintenance, billing,
email, Support and Marketing. Legacy Messaging queues are not deployed when
`features.messaging=false`. Queue payloads are transient delivery
contracts; durable business state remains in the owning D1.

Custom Worker schedules are equally target-owned: MBZA declares a daily
reference-retention cron, while VocoStar declares its one-minute dispatcher
retry. No capability name implicitly creates a Cloudflare trigger.

## Canonical module table inventory

| D1               | Tables created by checked-in migrations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email            | `email_messages`, `email_deliveries`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Identity         | `application_users`, `application_identities`, `application_sessions`, `application_identity_tokens`, `application_auth_rate_limits`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Files            | `application_files`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Legacy Messaging | `conversations`, `messages`, `messaging_agent_notifications`, `messaging_audit_events`, `messaging_companies`, `messaging_configuration_audit_events`, `messaging_configuration_entities`, `messaging_contact_notes`, `messaging_contacts`, `messaging_conversation_drafts`, `messaging_conversation_participants`, `messaging_csat_responses`, `messaging_operations_audit_events`, `messaging_project_settings`, `messaging_rule_executions`, `messaging_webhook_deliveries`                                                                                                                                                  |
| App              | `access_keys`, `audit_events`, `customer_events`, `customers`, `daily_metrics`, `idempotency_keys`, `referrals`, `referrals_v2`, `sdk_configurations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Products         | `audit_events`, `entitlement_products`, `entitlements`, `financial_customers`, `idempotency_keys`, `offering_packages`, `offerings`, `packages`, `products`, `purchase_entitlements`, `purchases`, `refunds`, `store_products`, `store_sync_runs`, `subscriptions`                                                                                                                                                                                                                                                                                                                                                              |
| Paywalls         | `audit_events`, `events`, `experiences`, `idempotency_keys`, `paywall_versions`, `paywalls`, `placements`, `variants`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dynamic Links    | `audit_events`, `campaigns`, `domains`, `idempotency_keys`, `link_events`, `link_events_v2`, `links`, `redirect_rules`, `social_previews`, `tracking_settings`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Support          | `audit_events`, `contacts`, `conversations`, `messages`, `support_agent_notifications`, `support_audit_events`, `support_companies`, `support_configuration_audit_events`, `support_configuration_entities`, `support_contact_notes`, `support_contacts`, `support_conversation_drafts`, `support_conversation_participants`, `support_csat_responses`, `support_idempotency_keys`, `support_message_attachments`, `support_operations_audit_events`, `support_project_settings`, `support_realtime_tickets`, `support_rule_executions`, `support_secret_audit_events`, `support_webhook_deliveries`, `support_webhook_secrets` |
| Marketing        | `audit_events`, `campaigns`, `email_deliveries`, `email_events`, `email_templates`, `marketing_idempotency_keys`, `marketing_media`, `marketing_outbox`, `provider_event_receipts`, `provider_webhook_endpoints`, `segment_memberships`, `smtp_attempts`, `smtp_profiles`, `subscriber_list_memberships`, `subscriber_lists`, `subscriber_segments`, `subscribers`, `suppressions`                                                                                                                                                                                                                                              |
| Onboardings      | `audit_events`, `events`, `experience_variants`, `experiences`, `idempotency_keys`, `onboarding_versions`, `onboardings`, `placements`, `targeting_rules`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reference custom | `reference_custom_jobs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| VocoStar custom  | `opengrow_custom_jobs` plus the existing app-owned VocoStar tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Names such as `audit_events`, `events`, `contacts`, `conversations` and
`idempotency_keys` repeat safely because each module has its own D1 binding.

## Central API D1: retained compatibility inventory

The central D1 currently contains identity/project tables and a large legacy
compatibility surface. The full set created by current migrations is:

```text
actions, active_storage_attachments, active_storage_blobs,
active_storage_variant_records, android_configurations,
android_push_configurations, android_server_api_keys, applications,
billing_admin_audit_logs, billing_audiences, billing_balance_ledger,
billing_certification_device_challenges, billing_certification_device_results,
billing_certification_observations, billing_certification_runs,
billing_checkout_sessions, billing_credential_rewrap_audit,
billing_customer_aliases, billing_customer_entitlements, billing_customers,
billing_dead_letters, billing_entitlements, billing_events,
billing_experiment_assignments, billing_experiment_variants,
billing_experiments, billing_export_jobs, billing_feature_flags,
billing_google_voided_sync_state, billing_legacy_customer_inventory,
billing_legacy_inventory_runs, billing_legacy_sources,
billing_legacy_subscription_inventory, billing_mirror_comparisons,
billing_offerings, billing_oidc_configs, billing_package_products,
billing_packages, billing_paywall_events, billing_paywall_versions,
billing_paywalls, billing_placements, billing_product_canonicalization_audit,
billing_product_entitlements, billing_product_prices, billing_products,
billing_project_settings, billing_redemptions, billing_refund_audit_events,
billing_refund_cases, billing_refund_deadlines, billing_refund_evidence,
billing_refund_provider_actions, billing_release_gate_checks,
billing_store_connections, billing_store_credential_audit,
billing_store_notification_configurations, billing_subscriptions,
billing_targeting_rules, billing_transactions, billing_virtual_currencies,
billing_virtual_currency_products, billing_webhook_deliveries,
billing_webhook_endpoints, billing_webhook_events, campaigns,
custom_redirects, daily_project_metrics, dashboard_auth_rate_limits, desktop_configurations,
device_product_purchases, devices, diagnostics_logs, domains,
downloadable_files, enterprise_subscriptions, events, failed_purchase_jobs,
growth_delivery_receipts, growth_delivery_receipts_new,
growth_lifecycle_outbox, iap_webhook_messages,
in_app_product_daily_statistics, in_app_products, inbox_automation_alerts,
installed_apps, instance_roles, instances, ios_configurations,
ios_push_configurations, ios_server_api_keys, link_daily_statistics, links,
mcp_authorization_codes, mcp_clients, mcp_tokens, messaging_realtime_tickets,
module_cutover_audit, module_cutover_maintenance, notification_messages,
notification_targets, notifications, oauth_access_tokens,
oauth_applications, project_daily_active_users, projects, purchase_events,
quick_links, redirect_configs, redirects, registration_allowlist,
removed_web_connections, removed_web_entitlements, removed_web_products,
removed_web_refund_cases, removed_web_subscriptions,
removed_web_transactions, rpush_apps, rpush_feedback, rpush_notifications,
setup_progress_steps, store_images, store_review_audit_events,
store_review_response_drafts, store_review_revisions,
store_review_sync_state, store_reviews, stripe_payment_intents,
stripe_subscriptions, stripe_webhook_messages, subscription_states, users,
visitor_daily_statistics, visitor_last_visits, visitors,
web_configuration_linked_domains, web_configuration_linked_domains_new,
web_configurations
```

## Duplicate and convergence decisions

1. `users`, `instances`, `projects`, `instance_roles`, OAuth/MCP tables,
   registration and notification tables remain central common control-plane
   data.
2. `billing_*` remains in the central D1 while the Billing Worker is the
   execution owner. It is not duplicated into an independent Billing D1 yet.
3. `enterprise_subscriptions` and the `instances.quota_*` columns are retained
   only as legacy migration evidence. No route, Queue job or redirect gate reads
   them in the reference runtime; removal requires the guarded data-retirement
   procedure below.
4. legacy `links`, `domains`, `campaigns`, redirects and link analytics converge
   on Dynamic Links D1; only compatibility reads remain during cutover.
5. legacy product, purchase, entitlement, subscription, refund and paywall
   tables converge on Products/Paywalls ownership.
6. Historical Dokploy Chatwoot data and the active OpenChat D1/R2 data are
   reconciled and migrated into Support before `chat.vocostar.com` or any
   OpenChat resource is deleted. `sup.vocostar.com` is already absent from DNS
   and its disappearance is not accepted as data-migration evidence.
7. legacy growth/newsletter tables converge on Marketing and Email ownership.
8. a compatibility table is removed only after backup, row-count/checksum
   comparison, dual-read verification, rollback rehearsal and a signed release
   gate. The reference baseline does not delete production data.
