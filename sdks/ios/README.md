<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg">
    <img src="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg" width="120" alt="OpenGrow">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform/releases"><img src="https://img.shields.io/github/v/release/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="https://github.com/mbzadev/opengrow-platform"><img src="https://img.shields.io/badge/distribution-SwiftPM-4F46E5?style=flat-square&logo=swift&logoColor=white" alt="Swift Package Manager"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mbzadev/opengrow-platform/stargazers"><img src="https://img.shields.io/github/stars/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

<p align="center">
  Deep linking, attribution, and smart links for iOS.<br/>
  Part of the <a href="https://github.com/mbzadev">OpenGrow</a> open-source mobile linking platform.
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/ios#quick-start">Quick Start</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/ios#api-reference">API Reference</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/docs">Full Docs</a>
</p>

---

The OpenGrow iOS SDK provides deep linking, universal linking, link generation, in-app messaging, revenue tracking, and attribution for your iOS apps. It supports both Swift and Objective-C.

## Features

- **Deep linking & universal links** — route users to the right in-app screen, even after install
- **Smart link generation** — create trackable links with metadata, custom redirects, and UTM parameters
- **In-app messaging** — display messages and announcements from the OpenGrow dashboard
- **Push notifications** — receive push notifications for dashboard-sent messages
- **Revenue tracking** — log StoreKit 2 and custom purchases with automatic attribution
- **User identity** — attach user IDs and attributes for analytics and segmentation
- **Self-hosting support** — point the SDK at your own backend

## Requirements

- iOS 13.0+
- Swift 5.0+
- Xcode 14+

<!-- opengrow-sdk-documentation:ios:start -->

## Installation

### Swift Package Manager

The published iOS SDK is distributed from public Git with Swift Package
Manager at the exact release `1.0.3`:

```swift
.package(url: "https://github.com/mbzadev/opengrow-platform.git", exact: "1.0.3")
```

In Xcode, use **File → Add Package Dependencies**, enter
`https://github.com/mbzadev/opengrow-platform.git`, and select exact version
`1.0.3`. CocoaPods Trunk is not a published or supported
distribution channel for this SDK.

<!-- opengrow-sdk-documentation:ios:end -->

## Quick Start

### 1. Initialize the SDK

Import the module and configure the SDK in your `AppDelegate`:

```swift
import OpenGrow

func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    OpenGrow.configure(APIKey: "your-api-key", useTestEnvironment: false, delegate: self) { success in
        if success {
            print("OpenGrow SDK is ready")
        }
    }

    // Optional: enable debug logging
    OpenGrow.setDebug(level: .info)

    // Optional: set user identity for analytics
    OpenGrow.userIdentifier = "user_id_from_your_app"
    OpenGrow.userAttributes = ["name": "John Doe", "plan": "premium"]

    return true
}
```

Every application must pass its `baseURL` parameter (domain only — the SDK appends the API path):

```swift
OpenGrow.configure(APIKey: "your-api-key", useTestEnvironment: false, baseURL: "https://your-domain.com", delegate: self)
```

### 2. Forward delegate calls

#### Apps using SceneDelegate

```swift
func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    OpenGrow.handleSceneDelegate(openURLContexts: URLContexts)
}

func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    OpenGrow.handleSceneDelegate(continue: userActivity)
}

func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    OpenGrow.handleSceneDelegate(options: connectionOptions)
}
```

#### Apps using AppDelegate only

```swift
func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
}

func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    return OpenGrow.handleAppDelegate(open: url, options: options)
}
```

### 3. Handle deep links

Conform to the `OpenGrowDelegate` protocol to receive deep link callbacks:

```swift
class YourViewController: UIViewController, OpenGrowDelegate {

    override func viewDidLoad() {
        super.viewDidLoad()
        OpenGrow.delegate = self
    }

    func opengrowReceivedPayloadFromDeeplink(link: String?, payload: [String: Any]?, tracking: [String: Any]?) {
        // Route the user based on payload data
        if let screen = payload?["screen"] as? String {
            navigateTo(screen)
        }
    }
}
```

You can also retrieve past payloads:

```swift
// Get the most recent payload
OpenGrow.lastReceivedPayload { payload in
    print("Last payload: \(payload)")
}

// Get all payloads received since app launch
OpenGrow.allReceivedPayloadsSinceStartup { payloads in
    guard let payloads = payloads else { return }
    for payload in payloads {
        print("Payload: \(payload)")
    }
}
```

## Link Generation

Create smart links with metadata, payload data, and tracking parameters:

```swift
OpenGrow.generateLink(
    title: "Check out this product",
    subtitle: "Limited time offer",
    imageURL: "https://example.com/image.jpg",
    data: ["productId": "12345", "screen": "product_detail"],
    tags: ["promotion", "share"],
    trackingCampaign: "spring_sale",
    trackingSource: "in_app",
    trackingMedium: "share_button"
) { url in
    guard let url = url else { return }
    print("Generated link: \(url)")
}
```

### Custom redirects

Override where a link sends users on each platform:

```swift
let redirects = CustomRedirects(
    ios: CustomLinkRedirect(link: "https://example.com/ios-promo"),
    android: CustomLinkRedirect(link: "https://example.com/android-promo"),
    desktop: CustomLinkRedirect(link: "https://example.com/desktop-promo", openAppIfInstalled: false)
)

OpenGrow.generateLink(title: "Special offer", data: ["promoId": "summer25"], customRedirects: redirects) { url in
    guard let url = url else { return }
    print("Generated link: \(url)")
}
```

### Share sheet

Present a share sheet after generating a link:

```swift
OpenGrow.generateLink(title: "Share this", data: ["itemId": "abc"]) { url in
    guard let url = url else { return }
    let activityVC = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    self.present(activityVC, animated: true)
}
```

## Messages

> If console messages have **automatic display** enabled in your dashboard, they will appear in your app without any additional integration.

### Push notifications

To receive push notifications for messages sent from the OpenGrow dashboard:

**1. Add capabilities** — In Xcode, add the **Push Notifications** capability and enable **Remote notifications** under **Background Modes**.

**2. Upload your APNs key** — In [Apple Developer → Keys](https://developer.apple.com/account/resources/authkeys/list), create a key with APNs enabled. Upload the `.p8` file, Key ID, and Team ID in the OpenGrow Dashboard deployed for the active application target, under **Settings → Push Notifications**.

**3. Request permission and register:**

```swift
import UserNotifications

UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
    if granted {
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}
```

**4. Pass the device token to OpenGrow:**

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    OpenGrow.pushToken = token
}
```

> Push notifications do not work in the iOS Simulator. Test on a physical device.

### Display messages

```swift
// Show the messages list as a modal
OpenGrow.displayMessagesViewController {
    // Modal was dismissed
}

// Get unread count for badges
OpenGrow.numberOfUnreadMessages { count in
    print("Unread: \(count)")
}
```

## Revenue Tracking

> Revenue tracking is currently in **beta**.

### Setup

1. Enable revenue tracking in the OpenGrow Dashboard deployed for the active application target, under **Settings → Revenue Tracking**
2. Configure App Store Server Notifications in [App Store Connect](https://appstoreconnect.apple.com) — set the production and sandbox URLs shown in the OpenGrow dashboard under **Developers → iOS Setup → Revenue**

### App Store purchases (StoreKit 2)

```swift
import StoreKit

let result = try await Product.purchase(...)

if case .success(let verification) = result,
   case .verified(let transaction) = verification {

    OpenGrow.logInAppPurchase(transactionID: transaction.id) { success in
        if success {
            Task { await transaction.finish() }
        }
    }
}
```

> Requires iOS 15+. The SDK automatically extracts price, currency, and product info. Duplicates are filtered.

### Custom purchases

```swift
OpenGrow.logCustomPurchase(
    type: .buy,
    priceInCents: 999,       // $9.99
    currency: "USD",
    productID: "premium_monthly"
) { success in
    // Revenue event recorded
}
```

Use `.cancel` and `.refund` transaction types for cancellations and refunds. For App Store purchases, these are detected automatically via App Store Server Notifications.

## API Reference

### Properties

| Property | Type | Description |
|---|---|---|
| `delegate` | `OpenGrowDelegate?` | Receives deep link callbacks |
| `userIdentifier` | `String?` | User ID shown in dashboard and reports |
| `userAttributes` | `[String: Any]?` | User attributes for analytics |
| `pushToken` | `String?` | APNs device token for push notifications |

### Key Methods

| Method | Description |
|---|---|
| `configure(APIKey:useTestEnvironment:baseURL:delegate:completion:)` | Initialize the SDK |
| `setSDK(enabled:)` | Enable or disable the SDK |
| `setDebug(level:)` | Set logging level (`.info`, `.warn`, `.error`) |
| `generateLink(...)` | Generate a smart link |
| `lastReceivedPayload(completion:)` | Get the last deep link payload |
| `allReceivedPayloadsSinceStartup(completion:)` | Get all payloads since launch |
| `linkDetails(path:completion:)` | Get details for a link path |
| `displayMessagesViewController(completion:)` | Show messages modal |
| `numberOfUnreadMessages(completion:)` | Get unread message count |
| `logInAppPurchase(transactionID:completion:)` | Log a StoreKit 2 purchase |
| `logCustomPurchase(type:priceInCents:currency:productID:startDate:completion:)` | Log a custom purchase |

Full API reference: [iOS SDK API reference](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/ios#api-reference)

## Example App

A demo project is included in [`sdks/ios`](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/ios).

## Setup Guides

- Custom URL scheme — see [Quick Start](#quick-start)
- Associated Domains — see [Quick Start](#quick-start)
- Apple App Prefix — use the Team ID registered with the selected target
- Bundle identifier — use the identifier registered with the selected target

## Migration Guides

- Migration procedures are maintained in the [canonical OpenGrow documentation](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Documentation

Full documentation is maintained in the [canonical repository](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Support

For technical support, use the support channel configured for the active target or open a repository issue.

## License

See [LICENSE](LICENSE) for details.
