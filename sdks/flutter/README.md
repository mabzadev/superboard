<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mabzadev/superboard/main/.github/logo.svg">
    <img src="https://raw.githubusercontent.com/mabzadev/superboard/main/.github/logo.svg" width="120" alt="SuperBoard">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mabzadev/superboard/releases"><img src="https://img.shields.io/github/v/release/mabzadev/superboard?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="https://github.com/mabzadev/superboard"><img src="https://img.shields.io/badge/distribution-public%20Git-4F46E5?style=flat-square" alt="Public Git"/></a>
  <a href="#"><img src="https://img.shields.io/badge/platforms-iOS%20%7C%20Android-4F46E5?style=flat-square" alt="Platforms"/></a>
  <a href="#"><img src="https://img.shields.io/badge/flutter-3.0%2B-4F46E5?style=flat-square&logo=flutter&logoColor=white" alt="Flutter"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mabzadev/superboard?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mabzadev/superboard/stargazers"><img src="https://img.shields.io/github/stars/mabzadev/superboard?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

<p align="center">
  Deep linking, attribution, and smart links for Flutter.<br/>
  Part of the <a href="https://github.com/mabzadev">SuperBoard</a> open-source mobile linking platform.
</p>

<p align="center">
  <a href="https://github.com/mabzadev/superboard/tree/main/sdks/flutter#quick-start">Quick Start</a> ·
  <a href="https://github.com/mabzadev/superboard/tree/main/sdks/flutter#api-reference">API Reference</a> ·
  <a href="https://github.com/mabzadev/superboard/tree/main/docs">Full Docs</a>
</p>

---

## SuperBoard 3 migration

The canonical package and import are now:

```dart
import 'package:superboard_flutter/superboard_flutter.dart';

final superboard = SuperBoard();
```

OpenGrow 2.x Dart symbols and entrypoint files remain as deprecated aliases for
one major release. Android manifest keys and iOS plist keys also fall back to
their 2.x spelling. The encrypted purchase outbox, anonymous identifier,
CustomerInfo cache, and JWKS cache deliberately keep their `opengrow.*`
physical storage keys so an upgrade or rollback cannot disconnect a user or
lose an unfinished purchase. Do not install the 2.x and 3.x packages together.
Follow the [complete 2.x to 3.x migration checklist](MIGRATION.md) before
regenerating the FlutterFlow or native application builds.

## SuperBoard Purchases

Version 2.1 adds resumable, server-verified App Store and Google Play purchases:

```dart
final purchases = SuperBoardPurchases.instance;
await purchases.configure(
  projectKey: 'my_project_key',
  platformIdentifier: 'com.example.app',
  identityTokenProvider: getShortLivedSuperBoardIdentityToken,
);

final offerings = await purchases.getOfferings();
final result = await purchases.purchasePackage(
  offerings.current!.packages.first,
);
final premium = result.customerInfo?.isEntitled('premium') == true;
```

Available APIs: `configure`, `logIn`, `logOut`, `getOfferings`,
`getCustomerInfo`, `isEntitled`, `purchasePackage`, `restorePurchases`,
`syncPurchases`, `customerInfoStream`, and `purchaseResultStream`.

## SuperBoard Support

Use the gateway URL exactly as configured for the application. The Support
client appends native resource paths such as `/conversations`; callers must not
append an additional API version.

```dart
import 'package:superboard_flutter/superboard_support.dart';

final support = SuperBoardSupportClient(
  baseUri: Uri.parse(
    'https://api.example.com/api/v1/support-client',
  ),
  projectId: 42,
  identityToken: identityToken,
  identityTokenProvider: refreshIdentityToken,
);

final conversation = await support.createConversation(
  clientConversationId: 'support-${DateTime.now().microsecondsSinceEpoch}',
  subject: 'Account question',
);
await support.sendMessage(
  conversation.id,
  body: 'Hello',
  clientMessageId: 'message-${DateTime.now().microsecondsSinceEpoch}',
);

final realtime = SuperBoardSupportRealtime(support);
realtime.events.listen(handleSupportEvent);
await realtime.connect(conversation.id);
```

The same client covers contact attributes, events, inbox members, eligible
proactive support, conversation labels, transcripts, Help Center content, CSAT,
attachments, and configured meetings. Errors are exposed as
`SuperBoardSupportException` with stable `code`, `retryable`, `requestId`, and
redacted `details` fields.

The SDK sends StoreKit 2 JWS transactions or Google purchase tokens to SuperBoard.
It stores unfinished transactions in an encrypted outbox, verifies the ES256
CustomerInfo JWS, and completes a purchase only after server verification and
durable local persistence. Never put App Store Connect or Google
service-account credentials in the application.

The SuperBoard Flutter SDK provides deep linking, app links, universal links, link generation, in-app messaging, revenue tracking, and attribution for your Flutter apps. It wraps the native iOS and Android SDKs.

## Features

- **Deep linking & universal links** — route users to the right in-app screen, even after install
- **Smart link generation** — create trackable links with metadata, custom redirects, and UTM parameters
- **In-app messaging** — display messages and announcements from the SuperBoard dashboard
- **Push notifications** — receive push notifications for dashboard-sent messages
- **Revenue tracking** — log App Store, Google Play, and custom purchases with automatic attribution
- **User identity** — attach user IDs and attributes for analytics and segmentation
- **Self-hosting support** — point the SDK at your own backend
- **Auto-configuration** — platform config via `AndroidManifest.xml` and `Info.plist`

## Requirements

- Flutter 3.3.0+
- Dart 3.9.2+
- iOS 13.0+
- Android API 24+ (Android 7.0)

<!-- opengrow-sdk-documentation:flutter:start -->

> **Lifecycle: active.** New versions may be published only through the
> protected immutable-release workflow.

## Installation

Add the published Flutter package `opengrow_flutter`
at the immutable release `sdk-flutter-v2.1.4`:

```yaml
opengrow_flutter:
  git:
    url: https://github.com/mabzadev/superboard.git
    ref: sdk-flutter-v2.1.4
    path: sdks/flutter
```

No repository read token is required. Runtime credentials must never be
placed in the Git dependency or exported application source.

Then resolve the immutable dependency:

```bash
flutter pub get
```

<!-- opengrow-sdk-documentation:flutter:end -->

## Platform Setup

### Android

**1. Add configuration to `AndroidManifest.xml`**

Add the SuperBoard API key and environment setting inside the `<application>` tag in `android/app/src/main/AndroidManifest.xml`:

```xml
<application>
    <meta-data
        android:name="superboard_api_key"
        android:value="YOUR_API_KEY" />
    <meta-data
        android:name="superboard_use_test_environment"
        android:value="true" /> <!-- Set to false for production -->

    <!-- Optional: Custom base URL for self-hosted backends -->
    <meta-data
        android:name="superboard_base_url"
        android:value="https://your-domain.com" />
</application>
```

**2. Add intent filters**

Add these to your main activity for deep link handling:

```xml
<activity android:name=".MainActivity">
    <!-- Custom URL scheme -->
    <intent-filter>
        <data android:scheme="your_app_scheme" android:host="open" />
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
    </intent-filter>

    <!-- App links (production) -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="your_app_host" />
    </intent-filter>

    <!-- App links (test) -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="your_app_test_host" />
    </intent-filter>
</activity>
```

### iOS

**1. Add configuration to `Info.plist`**

Add to `ios/Runner/Info.plist`:

```xml
<key>SuperBoardApiKey</key>
<string>YOUR_API_KEY</string>
<key>SuperBoardUseTestEnvironment</key>
<true/> <!-- Set to <false/> for production -->

<!-- Optional: Custom base URL for self-hosted backends -->
<key>SuperBoardBaseURL</key>
<string>https://your-domain.com</string>
```

**2. Configure URL schemes**

Add custom URL scheme support to `Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>your_app_scheme</string>
        </array>
    </dict>
</array>
```

**3. Configure Associated Domains**

1. Open your project in Xcode
2. Select your app target → **Signing & Capabilities** tab
3. Click **+ Capability** → add **Associated Domains**
4. Add `applinks:your_app_host` and `applinks:your_app_test_host`

## Quick Start

### Initialize and configure

```dart
import 'package:superboard_flutter/superboard_flutter.dart';

final superboard = SuperBoard();

// Optional: enable debug logging
await superboard.setDebugLevel('info');

// Optional: set user identity for analytics
await superboard.setUserIdentifier('user_id_from_your_app');
await superboard.setUserAttributes({
  'name': 'John Doe',
  'plan': 'premium',
});
```

### Handle deep links

Subscribe to the `onDeeplinkReceived` stream to handle incoming deep links:

```dart
import 'dart:async';
import 'package:superboard_flutter/superboard_flutter.dart';

StreamSubscription<DeeplinkDetails>? _subscription;

@override
void initState() {
  super.initState();
  _subscription = superboard.onDeeplinkReceived.listen((details) {
    final link = details.link;
    final payload = details.data;
    final tracking = details.tracking;

    print('Opened from: $link');

    // Route the user based on payload
    if (payload?['screen'] == 'product') {
      navigateToProduct(payload?['productId']);
    }
  });
}

@override
void dispose() {
  _subscription?.cancel();
  super.dispose();
}
```

## Link Generation

Create smart links with metadata, payload data, and tracking parameters:

```dart
import 'package:superboard_flutter/superboard_flutter.dart';
import 'package:superboard_flutter/models/superboard_link.dart';

try {
  final link = await superboard.generateLink(
    GenerateLinkParams(
      title: 'Check out this product',
      subtitle: 'Limited time offer',
      imageURL: 'https://example.com/image.jpg',
      data: {
        'screen': 'product',
        'productId': '12345',
      },
      tags: ['promotion', 'share'],
      tracking: TrackingParams(
        utmCampaign: 'spring_sale',
        utmSource: 'in_app',
        utmMedium: 'share_button',
      ),
    ),
  );
  print('Generated: $link');
} on SuperBoardException catch (e) {
  print('Error: ${e.message}');
}
```

### Custom redirects

Override where a link sends users on each platform:

```dart
final link = await superboard.generateLink(
  GenerateLinkParams(
    title: 'Special offer',
    data: {'promoId': 'summer25'},
    customRedirects: CustomRedirects(
      ios: CustomLinkRedirect(url: 'https://example.com/ios-promo'),
      android: CustomLinkRedirect(url: 'https://example.com/android-promo'),
      desktop: CustomLinkRedirect(url: 'https://example.com/desktop-promo', openAppIfInstalled: false),
    ),
  ),
);
```

### Share dialog

Launch the platform share sheet after generating a link:

```dart
import 'package:share_plus/share_plus.dart';

final link = await superboard.generateLink(
  GenerateLinkParams(title: 'Share this', data: {'itemId': 'abc'}),
);
Share.share(link);
```

## Messages

> If console messages have **automatic display** enabled in your dashboard, they will appear in your app without any additional integration.

### Push notifications

Pass the device token to receive push notifications for dashboard-sent messages:

```dart
import 'package:firebase_messaging/firebase_messaging.dart';

// Get and set the token
final token = await FirebaseMessaging.instance.getToken();
if (token != null) {
  await superboard.setPushToken(token);
}

// Listen for token refreshes
FirebaseMessaging.instance.onTokenRefresh.listen((newToken) {
  superboard.setPushToken(newToken);
});
```

Upload your Firebase or APNs credentials in the SuperBoard Dashboard deployed for the active application target, under your platform's push notification settings.

> Push notifications require a physical device. They do not work in the iOS Simulator.

## Revenue Tracking

> Revenue tracking is currently in **beta**.

### Setup

1. Enable revenue tracking in the SuperBoard Dashboard deployed for the active application target, under **Settings → Revenue Tracking**
2. Configure platform notifications:
   - **Android** — Set up Google Play Real-Time Developer Notifications
   - **iOS** — Configure App Store Server Notifications in App Store Connect

### Platform store purchases

```dart
// iOS: pass the StoreKit transaction ID as a string
// Android: pass the purchase originalJson string
await superboard.logInAppPurchase('transaction_id_or_json');
```

> The SDK automatically extracts price, currency, and product info. Duplicates are filtered.

### Custom purchases

```dart
import 'package:superboard_flutter/models/superboard_link.dart';

await superboard.logCustomPurchase(
  type: TransactionType.buy,
  priceInCents: 999,       // $9.99
  currency: 'USD',
  productId: 'premium_monthly',
);
```

Use `.cancel` and `.refund` transaction types for cancellations and refunds. For store purchases, these are detected automatically via platform server notifications.

## Flows

Flows is native Dart code and connects directly to the SuperBoard Flows Worker.
It does not embed a web view or depend on an external Flows runtime. Supply the
absolute SuperBoard API URL for the active target:

```dart
await SuperBoardFlows.initialize(
  apiUrl: 'https://your-board.example/api/v1/flows',
  projectId: 'project_ref',
  environment: 'production',
  sdkKey: 'environment_sdk_key',
  userId: currentUser.id,
  language: 'fr-CH',
  userProperties: {'plan': 'pro'},
);
```

The environment key is sent only in the dedicated HTTP header and in the
WebSocket authentication query. It is not written to encrypted block storage,
event payloads, analytics, or debug logs. Rotating the key and calling
`setContext` with the new value reconnects realtime with the new credential.

Place `SuperBoardFlowsOverlay` around the application content for floating
blocks and use `SuperBoardFlowsSlot(slotId: 'home')` for inline blocks. Wrap
native targets with `SuperBoardFlowAnchor(name: 'settings-button')` so tours,
hints, and tooltips can locate them without DOM selectors.

The SDK provides native Card, Floating Checklist, Hint, Modal, Tooltip, Survey,
Tour, and `superboard-commerce` rendering. The commerce component delegates
offer loading, checkout, receipt validation, and restoration to
`SuperBoardPurchases`; configure Purchases before rendering it. Flows receives
only the verified outcome transition and never reports price or revenue.
Register application-specific components with
`SuperBoardFlowBuilderRegistry.instance.register`. The client exposes
`startWorkflow`, individual/global reset, `fetchWorkflows`, language and user
property updates, as well as floating/slot streams. Blocks and progress context
are cached in encrypted device storage, including running tours and triggered
surveys; HTTP recovery does not depend on the WebSocket, and realtime updates
reconnect with bounded backoff.

## API Reference

### Properties

| Property | Type | Description |
|---|---|---|
| `onDeeplinkReceived` | `Stream<DeeplinkDetails>` | Stream of deep link events |

### Key Methods

| Method | Description |
|---|---|
| `setDebugLevel(level)` | Set logging level (`'info'`, `'error'`) |
| `setPushToken(token)` | Set FCM/APNs push token |
| `setUserIdentifier(identifier)` | Set user ID for dashboard and reports |
| `setUserAttributes(attributes)` | Set user attributes for analytics |
| `generateLink(params)` | Generate a smart link |
| `logInAppPurchase(transactionId)` | Log a store purchase |
| `logCustomPurchase(type, priceInCents, currency, productId, startDate)` | Log a custom purchase |

Full API reference: [Flutter SDK API reference](https://github.com/mabzadev/superboard/tree/main/sdks/flutter#api-reference)

## Example App

A demo project is included in the [`example/`](example/) directory.

## Migration Guides

- Migration procedures are maintained in the [canonical SuperBoard documentation](https://github.com/mabzadev/superboard/tree/main/docs).

## Documentation

Full documentation is maintained in the [canonical repository](https://github.com/mabzadev/superboard/tree/main/docs).

## Support

For technical support, use the support channel configured for the active target or open a repository issue.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
