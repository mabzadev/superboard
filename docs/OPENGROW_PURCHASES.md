# OpenGrow Purchases

OpenGrow Purchases is the multi-tenant authority for Apple App Store and Google Play purchases. Client-submitted transactions remain provisional. Only provider-verified transactions can update an entitlement.

## Deployment

Apply every D1 migration, create the Billing queue and DLQ, and configure the versioned Store credential keyrings, ES256 CustomerInfo signing keyset, and Apple root certificates as Cloudflare secrets.

Never add Apple `.p8` files, Store service-account JSON, or signing private keys to Wrangler variables or source control. Store credentials stay in their platform configuration and are encrypted for the Billing execution domain.

## Identity

The existing `api-auth-gateway` remains the only application authentication authority. After application authentication, FlutterFlow exchanges the existing access token through `POST /auth/opengrow-token`. OpenGrow accepts only the resulting short-lived ES256 token with the configured issuer, `opengrow` audience, and opaque user subject.

No second application login, account, or session is created.

## Application entitlement projection

OpenGrow is the only Premium authority. Every accepted entitlement change creates a durable `customer.entitlement.changed` delivery before Queue dispatch. Delivery bodies are HMAC-signed, bounded, leased to one consumer, retried with bounded backoff, and deduplicated by their immutable delivery identifier. The application authentication gateway verifies the exact body and timestamp, persists the delivery identifier, rejects stale or conflicting events, and applies only the newest projection for a user.

A Queue dispatch failure does not roll back or fail a verified Store purchase because the delivery already exists in D1 and scheduled reconciliation re-enqueues it. Replaying a verified transaction repairs a missing entitlement delivery. Disabled endpoints are closed as `skipped`; terminal failures are quarantined for audited replay. The release gate remains closed while a projection is failed, stale, or quarantined.

Purchase restoration transfers only the verified `original_transaction_id` chain. It never removes the same catalog product from unrelated customers. Entitlements are derived from the union of all current verified subscription and non-consumable sources, so expiration or refund of one source cannot revoke access while another valid source remains active.

## Mobile API

Mobile routes require the project, platform, application identifier, and anonymous identity headers:

- `GET /purchases/v2/offerings`
- `GET /purchases/v2/customer-info`
- `POST /purchases/v2/identify`
- `POST /purchases/v2/receipts`
- `POST /purchases/v2/restore`
- `POST /purchases/v2/sync`
- `POST /purchases/v2/certification/device-results`

The SDK persists a transaction in encrypted secure storage before server validation. It calls `completePurchase` only after the server has verified and persisted the transaction and the SDK has verified the ES256 CustomerInfo signature. A Store completion failure is retried without repeating successful server validation. Pending purchases grant no entitlement. Network loss and application restarts resume the outbox automatically.

For Google Play, Billing resolves the product type from the active project and environment catalog before selecting the subscriptions or one-time-products API. A client `product_type` value is accepted only as a backward-compatible hint and never controls provider verification or entitlement projection.

## App Store Server Notifications

Production and sandbox App Store Server Notifications use separate project-scoped V2 endpoints under `/api/v2/purchases/providers/webhooks/apple/{environment}/{project_id}`. The public API validates the project/environment pair, bounds the request body, and delegates the signed payload to Billing. Billing verifies Apple’s certificate chain, application identity, and environment before the event is persisted or queued.

The Purchases Stores section compares the live App Store Connect configuration with the required endpoints. Changing the live URLs requires an owner or administrator to open the confirmation dialog and submit the exact backend confirmation token. The backend updates both URLs and both notification versions in one App Store Connect request, reads the configuration back, persists only normalized readiness evidence, and records requested, completed, or failed administrator audit events.

The release gate remains closed unless both V2 URLs were verified within the configured Store-readiness window. A mismatch or stale observation cannot be overridden by manual certification evidence.

## Google Play real-time developer notifications

Google Play RTDN uses an authenticated Pub/Sub push subscription. The API verifies the Google-signed OIDC token, accepted Google issuer, exact endpoint audience, verified email claim, and the service-account email already registered for Google Play access before it reads the notification as trusted. Google signing keys are cached in KV with bounded rotation and refreshed immediately when a new key identifier appears.

The historical URL verification token remains accepted only as a migration compatibility path and can never satisfy the release gate. A successful OIDC-authenticated notification records readiness evidence without storing the bearer token. The Billing Worker verifies the referenced purchase with the Android Publisher API and derives `sandbox` or `production` from Google's verified `testPurchase`, `testPurchaseContext`, or legacy `purchaseType` marker. Client input never selects the entitlement environment.

The generated Google Cloud setup script requires the existing Play RTDN topic name, reuses the service account already uploaded for Google Play verification, and creates or updates only the OpenGrow push subscription. It never creates a second Play identity or a replacement topic. The subscription uses `--push-auth-service-account` and the exact `--push-auth-token-audience`. Publication remains blocked until at least one authenticated, provider-verified RTDN event has been observed.

Pending chargeback review notifications use a separate durable Billing job because they do not contain a purchase token. Billing resolves their order against the existing transaction ledger when possible, opens a Refund Center case with the provider's 24-hour deadline, and prepares—but never automatically submits—the Google Play refund preference and usage evidence.

## FlutterFlow actions

- `opengrowInitializeAuthenticated`
- `opengrowPurchase`
- `opengrowRestore`
- `opengrowSync`
- `opengrowHasEntitlement`
- `opengrowGetOfferings`
- `opengrowGetCustomerInfoJson`
- `opengrowOpenSubscriptionManagement`
- `opengrowRecordCertificationResultJson`
- `OpenGrowPaywall`
- `OpenGrowRestorePurchasesButton`

Application state must be updated only from verified CustomerInfo. Generated FlutterFlow files are not a source of truth; the libraries and Custom Actions are.

The Flutter SDK subscribes to the Store purchase stream before asynchronous configuration starts. Early Store transactions are buffered until identity and secure storage are ready. Store delivery, durable outbox validation, and startup recovery are serialized to prevent duplicate validation races or stale recovered entries. Short-lived identity JWTs are cached only until 30 seconds before expiration, and concurrent refreshes are deduplicated.

## Legacy provider removal

1. Configure the temporary RevenueCat V2 source in Purchases Diagnostics with a read-only secret key that can list customers, aliases, and subscriptions.
2. Run the paginated production inventory. OpenGrow matches identities through existing customer aliases and records every active subscription without storing the provider response or secret in clear text.
3. Import access only through provider verification. Existing verified Apple or Google Play subscriptions are matched directly; Apple records may be imported through App Store Server API verification. Google Play records without a purchase token remain unresolved until a native restore supplies verifiable Store data.
4. Resolve every unmatched identity, product, unsupported provider, and missing verified subscription. A completed run with zero unresolved items is an automated release-gate prerequisite.
5. Record the completed run ID as the legacy inventory check reference, then destroy the temporary encrypted API key from Diagnostics.
6. Keep the legacy initiator during the mirror phase.
7. Compare purchase, trial, renewal, plan change, cancellation, grace period, refund, restore, device change, reinstall, network recovery, duplicate, and out-of-order scenarios.
8. Require full convergence and zero entitlement assignments from unverified events.
9. Switch the FlutterFlow paywall only after TestFlight and Play Internal evidence passes.
10. Remove legacy actions, packages, keys, and initialization only after the release gate explicitly permits removal.

RevenueCat V2 customer and subscription pagination follows the official [Developer API](https://www.revenuecat.com/docs/api-v2). The source is migration-only and is never included in a mobile SDK or treated as a billing authority.

An owner or administrator can cancel a queued or running inventory that is blocked by a persistent provider failure. Cancellation clears its lease and cursor, causes stale queue deliveries to be ignored, and allows the temporary credential to be rotated or destroyed. A cancelled inventory can never satisfy the release gate.

## Certification authority

Purchases Diagnostics is the release authority. Automated prerequisites validate credentials, catalogs, Premium mappings, offerings, packages, and isolated Store credential copies. Publication and legacy dependency removal remain blocked until every required check passes.

Certification evidence is run-based. Directly marking a check as passed is rejected unless it points to an immutable observation from a completed run. Provider transaction and Billing event references are resolved server-side; the stored observation contains a bounded snapshot and SHA-256 digest rather than a mutable free-text claim or raw provider payload.

Every Apple and Google Play scenario requires an authenticated SDK device result. Provider-backed native scenarios freeze both the verified provider transaction or Billing event and the authenticated device result into one immutable observation. Pending, user cancellation, restoration, recovery, duplicate, and out-of-order scenarios use the authenticated device result directly; paywall telemetry is not certification evidence.

An administrator starts a run and receives a random four-hour run-scoped challenge that is stored only as a SHA-256 hash. The Flutter or FlutterFlow SDK submits a structured assertion set with the run, build, application, SDK, device, OS, and verified customer context. The existing application identity JWT is mandatory; anonymous customers are rejected. The first verified customer claims the challenge and only that customer may submit additional scenarios for the same run. Device results are immutable, idempotent, digest-protected, and must be reviewed by an administrator before they can satisfy a release check. Arbitrary external text references are never accepted as certification evidence.

Rotating an expired device challenge never clears the customer already bound to the run. The dashboard lists the immutable device results and their digests for the selected run, and an administrator can select a compatible result directly as the observation reference.

Passed device results require every assertion for their scenario to be `true`:

- `weekly_purchase` and `yearly_purchase`: `purchase_completed`, `provider_transaction_verified`, `premium_entitlement_active`, `transaction_finalized_once`.
- `trial`: `trial_started`, `trial_period_verified`, `entitlement_verified`.
- `pending`: `pending_observed`, `entitlement_withheld_until_verified`, `terminal_resolution_observed`.
- `user_cancelled`: `cancellation_observed`, `entitlement_unchanged`.
- `renewal`: `renewal_observed`, `entitlement_continued`, `duplicate_transaction_absent`.
- `upgrade_downgrade`: `product_change_completed`, `canonical_subscription_preserved`, `entitlement_converged`.
- `expiration`: `expiration_observed`, `entitlement_revoked`, `projection_converged`.
- `refund`: `refund_observed`, `entitlement_revoked`, `projection_converged`.
- `restore`: `restore_completed`, `duplicate_transaction_absent`, `entitlement_verified`.
- `device_change`: `second_device_authenticated`, `entitlement_restored`.
- `reinstall`: `app_reinstalled`, `outbox_recovered`, `entitlement_restored`.
- `interrupted_purchase`: `purchase_interrupted`, `validation_resumed`, `transaction_finalized_once`.
- `network_loss`: `network_interrupted`, `outbox_retained`, `validation_resumed`.
- `duplicate_event`: `same_event_replayed`, `single_transaction`, `single_entitlement_projection`.
- `out_of_order_event`: `events_reordered`, `provider_occurrence_order_applied`, `final_state_converged`.
- `portal`: `portal_session_created`, `return_url_verified`.
- `identity_sync`: `authenticated_identity_verified`, `purchase_blocked_without_identity`.
- `signed_customer_info`: `valid_signature_accepted`, `tampered_signature_rejected`, `unverified_state_unchanged`.
- `restart_recovery`: `outbox_persisted`, `app_restarted`, `validation_resumed`, `transaction_finalized_once`.
- `unverified_denied`: `unverified_receipt_submitted`, `entitlement_not_granted`.
- `authority_convergence`: `provider_state_checked`, `billing_state_checked`, `application_projection_checked`, `states_match`.
- `flutterflow_ios` and `flutterflow_android`: `purchase_completed`, `restore_completed`, `sync_completed`, `subscription_management_opened`, `verified_customer_info_applied`.
