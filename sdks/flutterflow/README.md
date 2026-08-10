# OpenGrow FlutterFlow

Import-ready library for replacing RevenueCat actions in FlutterFlow.

1. Add the public Git dependency with an immutable ref:

   ```yaml
   opengrow_flutterflow:
     git:
       url: https://github.com/mbzadev/opengrow-platform.git
       ref: sdk-flutterflow-v2.2.5
       path: sdks/flutterflow
   ```

   No repository read token is required. Never put runtime credentials in the
   Git dependency or exported application code.

2. Add `OpenGrowBootstrap` once to the initial page. It never initializes
   Purchases anonymously. Call `opengrowInitializeAuthenticated` immediately
   after `userAuthenticate` with the existing access token issued by the
   application authentication gateway.
3. Use `OpenGrowPaywall` with a `placement`. Its published definition and A/B
   assignment resolve through `POST /api/v1/paywalls/resolve`; Products remains
   responsible only for offerings and purchases.
4. Use `OpenGrowOnboarding` with a placement such as `app_launch`. It renders
   the published screens and reports impression, step, progress, skip,
   abandonment and completion events.
5. Protect a page with `opengrowHasEntitlement('premium')` and redirect to the
   paywall when it returns false.
6. Add `OpenGrowCustomerCenter` to Settings. It includes purchase history,
   subscriptions, balances, and restoration.

FlutterFlow-ready actions:

- `opengrowInitializeAuto`
- `opengrowInitializeAuthenticated`
- `opengrowIdentify`
- `opengrowSetUserAttributesJson`
- `opengrowSetPushToken`
- `opengrowGenerateLinkJson`
- `opengrowGetUnreadMessageCount`
- `opengrowDisplayMessages`
- `opengrowGetLastDeepLinkJson`
- `opengrowGetLastPurchaseResultJson`
- `opengrowGetLastVerifiedCustomerInfoJson`
- `opengrowPurchaseLogin`, `opengrowPurchaseLogout`, purchase, restore,
  synchronization, offerings, and entitlements
- `opengrowGetPurchaseConfigurationJson`
- `opengrowGetCustomerInfoJson`
- `opengrowGetVirtualCurrenciesJson`
- `opengrowGetCustomerCenterJson`
- `opengrowOpenSubscriptionManagement`
- `opengrowRecordCertificationResultJson`
- `opengrowRecordCustomerEvent`
- `opengrowRecordCustomerEventsJson`
- `opengrowApplicationCreateCustomJobJson`
- `opengrowApplicationListCustomJobsJson`
- `opengrowApplicationGetCustomJobJson`
- `opengrowApplicationRestoreSessionJson`
- `opengrowApplicationCurrentSessionJson`
- `opengrowApplicationAccessToken`

Use `OpenGrowBootstrap.onPurchaseResultJson` to handle the terminal result of
a pending purchase or a purchase recovered after restart. Use
`onVerifiedCustomerInfoJson` as the only callback source for Premium UI state.
Hosts that manage their own lifecycle bridge can subscribe to
`opengrowPurchaseResultJsonStream` and
`opengrowVerifiedCustomerInfoJsonStream` instead. The CustomerInfo stream emits
only payloads that passed SDK JWS verification.

The configured application Identity service remains the only authentication
authority; during the VocoStar transition this can still be the historical
gateway. The library never issues an application token. It exchanges the existing
access token for a short-lived ES256 OpenGrow identity JWT through
`POST /auth/opengrow-token`. A purchase cannot start when this exchange fails.
The short-lived identity JWT is reused until shortly before expiration and
concurrent refreshes are deduplicated. Store transactions received during SDK
startup are buffered, then processed serially with outbox recovery.
Purchase actions always return a structured JSON result, including identity or
network failures that happen before the Store sheet opens.
No Apple or Google secret is embedded in the application.

Application access and rotating refresh tokens are owned by the SDK session
manager and persisted only through the operating system's encrypted credential
storage. `opengrowApplicationInitialize` restores and refreshes that session
before protected application calls. FlutterFlow App State must never persist
either token. Sign-in actions return the access token only as an ephemeral
action result so the host can update its in-memory authentication state; the
refresh token never leaves the SDK session manager.

Custom application jobs use the same exchange and the same configured
`PROJECT-KEY`, platform and application identifier. The library calls only
`/api/v1/sdk/custom/v1/jobs`; it never receives the private Worker token and never
supplies an authoritative project or user ID. Reuse the same idempotency key when
retrying one logical creation request.

`OpenGrowBootstrap` configures both widgets with `PROJECT-KEY`, the native
application identifier, platform and environment. Resolutions use a five-minute
cache and may use the last successful value for up to seven days during a
network outage. A successful empty resolution is cached and renders nothing;
use `onUnavailable` when the host application needs its own fallback. Event
retries reuse the same identifier and `Idempotency-Key`, so telemetry is not
double-counted.

Customer acquisition and engagement events use the same Access Key configured
by `OpenGrowBootstrap`. `opengrowRecordCustomerEvent` sends one typed event;
`opengrowRecordCustomerEventsJson` sends an outbox batch of at most 100 events.
Provide a stable event ID (and a stable batch idempotency key for persisted
batches). Timestamps are normalized to ISO-8601 UTC before they are sent to
`POST /api/v1/app/events`.

For a real-device certification run, pass `appVersion`, `buildNumber`, and the
Purchases SDK version during initialization. Generate the expiring, run-scoped
device challenge in Purchases Diagnostics, then call
`opengrowRecordCertificationResultJson` with the run ID, challenge, check key,
device model, OS version, and the documented assertion JSON. The action uses
the already configured identity token; anonymous evidence is rejected. It
returns the immutable device result ID that an administrator reviews in the
same dashboard. Retries for the same run, scenario, outcome, build, and device
reuse a deterministic result ID, so a lost response cannot create duplicate
evidence. Never save the challenge in application state or source code.
The first verified customer claims the challenge and may submit all remaining
scenarios for that run. Every Apple and Google Play scenario requires this
authenticated result; provider-backed scenarios also require the matching
verified transaction or Billing event in Purchases Diagnostics.
