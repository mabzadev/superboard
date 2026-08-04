# OpenGrow FlutterFlow

Import-ready library for replacing RevenueCat actions in FlutterFlow.

1. Add the private Git dependency with an immutable ref:

   ```yaml
   opengrow_flutterflow:
     git:
       url: git@github.com:mbzadev/opengrow.git
       ref: sdk-flutterflow-v2.1.6
       path: sdks/flutterflow
   ```

   Configure a fine-grained, read-only GitHub token in FlutterFlow and limit it
   to this repository. Never include that token in exported application code.
2. Add `OpenGrowBootstrap` once to the initial page. It never initializes
   Purchases anonymously. Call `opengrowInitializeAuthenticated` immediately
   after `userAuthenticate` with the existing access token issued by the
   application authentication gateway.
3. Use `OpenGrowPaywall` with a `placement`. Its content, offering, and
   experiment assignment are loaded remotely with an offline fallback.
4. Protect a page with `opengrowHasEntitlement('premium')` and redirect to the
   paywall when it returns false.
5. Add `OpenGrowCustomerCenter` to Settings. It includes purchase history,
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

Use `OpenGrowBootstrap.onPurchaseResultJson` to handle the terminal result of
a pending purchase or a purchase recovered after restart. Use
`onVerifiedCustomerInfoJson` as the only callback source for Premium UI state.
Hosts that manage their own lifecycle bridge can subscribe to
`opengrowPurchaseResultJsonStream` and
`opengrowVerifiedCustomerInfoJsonStream` instead. The CustomerInfo stream emits
only payloads that passed SDK JWS verification.

`api-auth-gateway` remains the only application authentication authority. The
library never issues an application token. It exchanges the existing access
token for a short-lived ES256 OpenGrow identity JWT through
`POST /auth/opengrow-token`. A purchase cannot start when this exchange fails.
Purchase actions always return a structured JSON result, including identity or
network failures that happen before the Store sheet opens.
No Apple or Google secret is embedded in the application.

For a real-device certification run, pass `appVersion`, `buildNumber`, and the
Purchases SDK version during initialization. Generate the expiring device
challenge in Purchases Diagnostics, then call
`opengrowRecordCertificationResultJson` with the run ID, challenge, check key,
device model, OS version, and the documented assertion JSON. The action uses
the already configured identity token; anonymous evidence is rejected. It
returns the immutable device result ID that an administrator reviews in the
same dashboard. Never save the challenge in application state or source code.
