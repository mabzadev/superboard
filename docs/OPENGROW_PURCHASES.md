# OpenGrow Purchases

OpenGrow Purchases is the multi-tenant authority for Apple App Store, Google Play, and Stripe Web purchases. Client-submitted transactions remain provisional. Only provider-verified transactions can update an entitlement.

## Deployment

Apply every D1 migration, create the Billing queue and DLQ, and configure the versioned Store credential keyrings, ES256 CustomerInfo signing keyset, and Apple root certificates as Cloudflare secrets.

Never add Apple `.p8` files, Store service-account JSON, Stripe secrets, or signing private keys to Wrangler variables or source control. The dashboard sends credentials to controlled API routes, which create separate AES-GCM ciphertexts for the API and Billing execution domains.

## Identity

The existing `api-auth-gateway` remains the only application authentication authority. After application authentication, FlutterFlow exchanges the existing access token through `POST /auth/opengrow-token`. OpenGrow accepts only the resulting short-lived ES256 token with the configured issuer, `opengrow` audience, and opaque user subject.

No second application login, account, or session is created.

## Mobile API

Mobile routes require the project, platform, application identifier, and anonymous identity headers:

- `GET /purchases/v2/offerings`
- `GET /purchases/v2/customer-info`
- `POST /purchases/v2/identify`
- `POST /purchases/v2/receipts`
- `POST /purchases/v2/restore`
- `POST /purchases/v2/sync`

The SDK persists a transaction in encrypted secure storage before server validation. It calls `completePurchase` only after the server has verified and persisted the transaction and the SDK has verified the ES256 CustomerInfo signature. Pending purchases grant no entitlement. Network loss and application restarts resume the outbox automatically.

## Stripe Web

Stripe is Web-only for digital purchases. Checkout, Billing Portal, redemption, refunds, and disputes share the same entitlement projection as the native Stores. Mobile applications must not replace Apple or Google Play purchase buttons with Stripe Checkout.

Webhook signatures are verified before persistence and queueing. When Billing service mode is enabled, Checkout, Portal, redemption, and provider actions execute only in the private Billing Worker.

## App Store Server Notifications

Production and sandbox App Store Server Notifications use separate project-scoped V2 endpoints under `/api/v2/purchases/providers/webhooks/apple/{environment}/{project_id}`. The public API validates the project/environment pair, bounds the request body, and delegates the signed payload to Billing. Billing verifies Apple’s certificate chain, application identity, and environment before the event is persisted or queued.

The Purchases Stores section compares the live App Store Connect configuration with the required endpoints. Changing the live URLs requires an owner or administrator to open the confirmation dialog and submit the exact backend confirmation token. The backend updates both URLs and both notification versions in one App Store Connect request, reads the configuration back, persists only normalized readiness evidence, and records requested, completed, or failed administrator audit events.

The release gate remains closed unless both V2 URLs were verified within the configured Store-readiness window. A mismatch or stale observation cannot be overridden by manual certification evidence.

## FlutterFlow actions

- `opengrowInitializeAuthenticated`
- `opengrowPurchase`
- `opengrowRestore`
- `opengrowSync`
- `opengrowHasEntitlement`
- `opengrowGetOfferings`
- `opengrowGetCustomerInfoJson`
- `opengrowOpenSubscriptionManagement`
- `OpenGrowPaywall`
- `OpenGrowRestorePurchasesButton`

Application state must be updated only from verified CustomerInfo. Generated FlutterFlow files are not a source of truth; the libraries and Custom Actions are.

## Lifecycle automation bridge

The remote FlutterFlow paywall attaches a unique session identifier to every impression, selection, purchase, restore, and close event. A close, cancellation, or failed purchase is evaluated asynchronously after the Store flow settles. A verified purchase success in the same session suppresses abandonment, preventing false win-back messages.

Subscription cancellation while access remains available emits `churn_risk`; actual entitlement expiration emits `entitlement_expired`. Provider lifecycle and paywall projections use deterministic event identifiers, queue retries, and scheduled recovery. Growth can deliver chat, push, or in-app messages, but it cannot write any entitlement or billing projection.

## Legacy provider removal

1. Configure the temporary RevenueCat V2 source in Purchases Diagnostics with a read-only secret key that can list customers, aliases, and subscriptions.
2. Run the paginated production inventory. OpenGrow matches identities through existing customer aliases and records every active subscription without storing the provider response or secret in clear text.
3. Import access only through provider verification. Existing verified Apple, Google Play, or Stripe subscriptions are matched directly; Apple records may be imported through App Store Server API verification. Google Play records without a purchase token remain unresolved until a native restore supplies verifiable Store data.
4. Resolve every unmatched identity, product, unsupported provider, and missing verified subscription. A completed run with zero unresolved items is an automated release-gate prerequisite.
5. Record the completed run ID as the legacy inventory check reference, then destroy the temporary encrypted API key from Diagnostics.
6. Keep the legacy initiator during the mirror phase.
7. Compare purchase, trial, renewal, plan change, cancellation, grace period, refund, restore, device change, reinstall, network recovery, duplicate, and out-of-order scenarios.
8. Require full convergence and zero entitlement assignments from unverified events.
9. Switch the FlutterFlow paywall only after TestFlight and Play Internal evidence passes.
10. Remove legacy actions, packages, keys, and initialization only after the release gate explicitly permits removal.

RevenueCat V2 customer and subscription pagination follows the official [Developer API](https://www.revenuecat.com/docs/api-v2). The source is migration-only and is never included in a mobile SDK or treated as a billing authority.

## Certification authority

Purchases Diagnostics is the release authority. Automated prerequisites validate credentials, catalogs, Premium mappings, offerings, packages, and isolated Store credential copies. Manual checks require build, device, and provider/test-run evidence. Publication and legacy dependency removal remain blocked until every required check passes.

Certification evidence is run-based. Directly marking a check as passed is rejected unless it points to an immutable observation from a completed run. Provider transaction and Billing event references are resolved server-side; the stored observation contains a bounded snapshot and SHA-256 digest rather than a mutable free-text claim or raw provider payload.
