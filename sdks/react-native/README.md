<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg">
      <img src="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg" width="120" alt="OpenGrow">
    </picture>
  </a>
</p>

<p align="center">
  Deep linking, attribution, and smart links for React Native.<br/>
  Part of the <a href="https://github.com/mbzadev">OpenGrow</a> open-source mobile linking platform.
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/react-native#usage">Quick Start</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/react-native#api-reference">API Reference</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/docs">Full Docs</a>
</p>

---

The OpenGrow React Native SDK provides deep linking, universal links, app links, link generation, in-app messaging, revenue tracking, and attribution for your React Native apps.

## Features

- **Deep linking & universal links** — route users to the right in-app screen, even after install
- **Smart link generation** — create trackable links with metadata, custom redirects, and UTM parameters
- **In-app messaging** — display messages and announcements from the OpenGrow dashboard
- **Push notifications** — receive push notifications for dashboard-sent messages
- **Revenue tracking** — log App Store, Google Play, and custom purchases with automatic attribution
- **User identity** — attach user IDs and attributes for analytics and segmentation
- **Self-hosting support** — point the SDK at your own backend
- **Expo support** — config plugin for automated native setup

## Requirements

- React Native 0.70+
- iOS 13.0+
- Android API 21+ (Android 5.0)

<!-- opengrow-sdk-documentation:react-native:start -->

## Installation

```bash
# npm
npm install @mbzadev/opengrow-react-native-sdk@1.0.1

# yarn
yarn add @mbzadev/opengrow-react-native-sdk@1.0.1
```

### Android dependency

Add the released native Android SDK to `android/app/build.gradle`:

```kotlin
implementation("io.opengrow:opengrow-android-sdk:1.0.3")
```

### iOS dependency

The React Native pod consumes the native OpenGrow podspec directly from its
reviewed immutable Git tag; it does not claim a CocoaPods Trunk release:

```ruby
pod 'OpenGrow', :podspec => 'https://raw.githubusercontent.com/mbzadev/opengrow-platform/sdk-ios-v1.0.2/sdks/ios/OpenGrow.podspec'
```

The URL is pinned to `sdk-ios-v1.0.2`. Run `pod install` after updating
the dependency.

<!-- opengrow-sdk-documentation:react-native:end -->

## Expo Integration

If you're using Expo with a development build, the config plugin automates all native setup. Add to your `app.json`:

```json
{
  "plugins": [
    ["@mbzadev/opengrow-react-native-sdk", {
      "apiKey": "your-api-key",
      "scheme": "your_app_scheme",
      "useTestEnvironment": false,
      "associatedDomains": ["your_app_host", "your_app_test_host"],
      "baseURL": "https://your-domain.com"
    }]
  ]
}
```

| Property | Required | Description |
|---|---|---|
| `apiKey` | Yes | Your OpenGrow API key |
| `scheme` | Yes | Custom URL scheme for deep links |
| `useTestEnvironment` | No | Use test environment (default: `false`) |
| `associatedDomains` | No | Universal link domains for deep linking |
| `baseURL` | No | Custom base URL for self-hosted backends |

Then run `npx expo prebuild` and build with `npx expo run:ios` / `npx expo run:android`.

> **Note:** This requires a development build (`expo-dev-client`), not Expo Go.

## Manual Configuration

### Android

**1. Initialize the SDK** in your `MainApplication` class:

```kotlin
override fun onCreate() {
    super.onCreate()
    OpenGrow.configure(this, "your-api-key", useTestEnvironment = false)
    // Optional: use a custom base URL for self-hosted backends
    // OpenGrow.configure(this, "your-api-key", useTestEnvironment = false, baseURL = "https://your-domain.com")
}
```

**2. Handle incoming links** in your `MainActivity`:

```kotlin
override fun onStart() {
    super.onStart()
    OpenGrow.onStart(this)
}

override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    OpenGrow.onNewIntent(intent, this)
}
```

**3. Add intent filters** to your launcher activity in `AndroidManifest.xml`:

```xml
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
```

### iOS

**1. Initialize the SDK** in `AppDelegate.swift`:

```swift
import OpenGrow

func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    OpenGrow.configure(APIKey: "your-api-key", useTestEnvironment: false, delegate: self)
    // Optional: use a custom base URL for self-hosted backends
    // OpenGrow.configure(APIKey: "your-api-key", useTestEnvironment: false, baseURL: "https://your-domain.com", delegate: self)
    OpenGrow.setDebug(level: .info)
    return true
}

func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?, tracking: [String: Any]?) {
    // Native delegate callback
}
```

**2. Handle incoming links** in `AppDelegate.swift`:

```swift
func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
}

func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return OpenGrow.handleAppDelegate(open: url, options: options)
}
```

**3. Configure Associated Domains** in Xcode:

1. Select your app target → **Signing & Capabilities**
2. Add **Associated Domains** capability
3. Add `applinks:your_app_host` and `applinks:your_app_test_host`

**4. Configure URL scheme:**

1. In Xcode, select your target → **Info** tab
2. Under **URL Types**, click **+** and add the URL scheme from your OpenGrow dashboard

## Usage

### Handle deep links

```typescript
import OpenGrow from '@mbzadev/opengrow-react-native-sdk';

const listener = OpenGrow.onDeeplinkReceived((response) => {
    console.log('Link:', response.link);
    console.log('Data:', response.data);

    // Route the user based on payload
    if (response.data?.screen === 'product') {
        navigation.navigate('Product', { id: response.data.productId });
    }
});

// When you no longer need the listener
listener.remove();
```

### Set user identity

```typescript
OpenGrow.setIdentifier('user-123');
OpenGrow.setAttributes({
    name: 'John Doe',
    plan: 'premium',
});
```

## Link Generation

Create smart links with metadata, payload data, and tracking parameters:

```typescript
try {
    const link = await OpenGrow.generateLink(
        'Check out this product',           // title
        'Limited time offer',               // subtitle
        'https://example.com/image.jpg',    // imageURL
        {                                   // data
            productId: '12345',
            screen: 'product_detail',
        },
        ['promotion', 'share'],             // tags
        {                                   // customRedirects
            android: { link: 'https://example.com/android', open_if_app_installed: true },
            ios: { link: 'https://example.com/ios', open_if_app_installed: true },
            desktop: { link: 'https://example.com/desktop', open_if_app_installed: false },
        },
        false,                              // showPreviewIos
        false,                              // showPreviewAndroid
        {                                   // tracking
            utm_campaign: 'spring_sale',
            utm_source: 'in_app',
            utm_medium: 'share_button',
        }
    );
    console.log('Generated:', link);
} catch (error) {
    console.error('Error:', error);
}
```

## Messages

> If console messages have **automatic display** enabled in your dashboard, they will appear in your app without any additional integration.

### Push notifications

Pass the FCM token to receive push notifications for dashboard-sent messages:

```typescript
import messaging from '@react-native-firebase/messaging';

const token = await messaging().getToken();
if (token) {
    OpenGrow.setPushToken(token);
}
```

Upload your Firebase or APNs credentials in the OpenGrow Dashboard deployed for the active application target.

### Display messages

```typescript
// Show the messages list as a modal
await OpenGrow.displayMessages();

// Get unread count for badges
const count = await OpenGrow.numberOfUnreadMessages();
console.log(`Unread: ${count}`);
```

## Revenue Tracking

> Revenue tracking is currently in **beta**.

### Setup

1. Enable revenue tracking in the OpenGrow Dashboard deployed for the active application target, under **Settings → Revenue Tracking**
2. Configure platform notifications:
   - **Android** — Set up Google Play Real-Time Developer Notifications
   - **iOS** — Configure App Store Server Notifications in App Store Connect

### Platform store purchases

```typescript
// iOS: pass the StoreKit 2 transaction ID as a string
// Android: pass the Google Play purchase.originalJson string
const success = await OpenGrow.logInAppPurchase(transactionId);
```

> The SDK automatically extracts price, currency, and product info. Duplicates are filtered.

### Custom purchases

```typescript
const success = await OpenGrow.logCustomPurchase(
    'buy',              // type: 'buy' | 'cancel' | 'refund'
    999,                // priceInCents: $9.99
    'USD',              // currency code
    'premium_monthly',  // product identifier
);
```

Use `'cancel'` and `'refund'` types for cancellations and refunds. For store purchases, these are detected automatically via platform server notifications.

## API Reference

### Key Methods

| Method | Description |
|---|---|
| `onDeeplinkReceived(callback)` | Register deep link listener (returns `{ remove }`) |
| `setSDK(enabled)` | Enable or disable the SDK |
| `setDebug(level)` | Set logging level (`'info'`, `'error'`) |
| `setPushToken(token)` | Set FCM/APNs push token |
| `setIdentifier(identifier)` | Set user ID for dashboard and reports |
| `setAttributes(attributes)` | Set user attributes for analytics |
| `generateLink(title, subtitle, imageURL, data, tags, customRedirects, showPreviewIos, showPreviewAndroid, tracking)` | Generate a smart link |
| `displayMessages()` | Show messages modal |
| `numberOfUnreadMessages()` | Get unread message count |
| `logInAppPurchase(transactionId)` | Log a store purchase |
| `logCustomPurchase(type, priceInCents, currency, productId, startDate)` | Log a custom purchase |

Full API reference: [React Native SDK API reference](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/react-native#api-reference)

## Example App

A demo project is included in [`sdks/react-native/example`](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/react-native/example).

## Migration Guides

- Migration procedures are maintained in the [canonical OpenGrow documentation](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Documentation

Full documentation is maintained in the [canonical repository](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Support

For technical support, use the support channel configured for the active target or open a repository issue.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.
