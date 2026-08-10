<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg">
    <img src="https://raw.githubusercontent.com/mbzadev/opengrow-platform/main/.github/logo.svg" width="120" alt="OpenGrow">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform/releases"><img src="https://img.shields.io/github/v/release/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="https://github.com/mbzadev/opengrow-platform/packages"><img src="https://img.shields.io/badge/GitHub%20Packages-private-4F46E5?style=flat-square" alt="GitHub Packages"/></a>
  <a href="#"><img src="https://img.shields.io/badge/API-21%2B-4F46E5?style=flat-square" alt="API 21+"/></a>
  <a href="#"><img src="https://img.shields.io/badge/kotlin-1.9%2B-4F46E5?style=flat-square&logo=kotlin&logoColor=white" alt="Kotlin"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mbzadev/opengrow-platform/stargazers"><img src="https://img.shields.io/github/stars/mbzadev/opengrow-platform?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

<p align="center">
  Deep linking, attribution, and smart links for Android.<br/>
  Part of the <a href="https://github.com/mbzadev">OpenGrow</a> open-source mobile linking platform.
</p>

<p align="center">
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/android#quick-start">Quick Start</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/sdks/android#api-reference">API Reference</a> ·
  <a href="https://github.com/mbzadev/opengrow-platform/tree/main/docs">Full Docs</a>
</p>

---

The OpenGrow Android SDK provides deep linking, app links, link generation, in-app messaging, revenue tracking, and attribution for your Android apps. It supports both Kotlin and Java.

## Features

- **Deep linking & app links** — route users to the right in-app screen, even after install
- **Smart link generation** — create trackable links with metadata, custom redirects, and UTM parameters
- **In-app messaging** — display messages and announcements from the OpenGrow dashboard
- **Push notifications** — receive push notifications for dashboard-sent messages via Firebase Cloud Messaging
- **Revenue tracking** — log Google Play Billing and custom purchases with automatic attribution
- **User identity** — attach user IDs and attributes for analytics and segmentation
- **Self-hosting support** — point the SDK at your own backend

## Requirements

- Android API 21+ (Android 5.0)
- Kotlin 1.6+ or Java 8+
- Android Studio Arctic Fox+

## Installation

### Gradle

Add the OpenGrow dependency to your app-level `build.gradle`:

```groovy
dependencies {
    implementation("io.opengrow:opengrow-android-sdk:1.0.2")
}
```

## Quick Start

### 1. Initialize the SDK

Configure the SDK in your `Application` class:

```kotlin
import io.opengrow.OpenGrow

class MyApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        OpenGrow.configure(this, "your-api-key", useTestEnvironment = false)

        // Optional: enable debug logging
        OpenGrow.setDebug(LogLevel.INFO)

        // Optional: set user identity for analytics
        OpenGrow.identifier = "user_id_from_your_app"
        OpenGrow.attributes = mapOf("name" to "John Doe", "plan" to "premium")
    }
}
```

Every application must pass its `baseURL` parameter (domain only — the SDK appends the API path):

```kotlin
OpenGrow.configure(this, "your-api-key", useTestEnvironment = false, baseURL = "https://your-domain.com")
```

### 2. Forward lifecycle events

In your **launcher activity**, forward lifecycle events to the SDK:

```kotlin
class MainActivity : AppCompatActivity() {
    override fun onStart() {
        super.onStart()
        OpenGrow.onStart(this)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        OpenGrow.onNewIntent(intent, this)
    }
}
```

### 3. Add intent filters

Add these intent filters to your launcher activity in `AndroidManifest.xml`:

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

### 4. Handle deep links

Register a listener in your launcher activity to receive deep link events:

```kotlin
OpenGrow.setOnDeeplinkReceivedListener(this) { deeplinkDetails ->
    // Route the user based on payload data
    val link = deeplinkDetails.link
    val payload = deeplinkDetails.data
    val tracking = deeplinkDetails.tracking

    payload?.get("screen")?.let { screen ->
        navigateTo(screen as String)
    }
}
```

Or use Kotlin Flow for a coroutine-based approach:

```kotlin
lifecycleScope.launch {
    OpenGrow.Companion::openedLinkDetails.flow.collect { deeplinkDetails ->
        deeplinkDetails?.let {
            Log.d("OpenGrow", "Link: ${it.link}, data: ${it.data}")
        }
    }
}
```

You can also retrieve details for a specific link path:

```kotlin
// Using a callback
OpenGrow.linkDetails(path = "/my-link-path", lifecycleOwner = this) { details, error ->
    details?.let { Log.d("OpenGrow", "Details: $it") }
}

// Using coroutines
val details = OpenGrow.linkDetails(path = "/my-link-path")
```

## Link Generation

Create smart links with metadata, payload data, and tracking parameters:

```kotlin
OpenGrow.generateLink(
    title = "Check out this product",
    subtitle = "Limited time offer",
    imageURL = "https://example.com/image.jpg",
    data = mapOf("productId" to "12345", "screen" to "product_detail"),
    tags = listOf("promotion", "share"),
    tracking = TrackingParams(
        utmCampaign = "spring_sale",
        utmSource = "in_app",
        utmMedium = "share_button"
    ),
    lifecycleOwner = this,
    listener = { link, error ->
        link?.let { Log.d("OpenGrow", "Generated: $it") }
        error?.let { Log.e("OpenGrow", "Error: $it") }
    }
)
```

Or using coroutines:

```kotlin
lifecycleScope.launch {
    try {
        val link = OpenGrow.generateLink(
            title = "Check out this product",
            subtitle = "Limited time offer",
            imageURL = "https://example.com/image.jpg",
            data = mapOf("productId" to "12345"),
            tags = listOf("promotion"),
            tracking = TrackingParams(
                utmCampaign = "spring_sale",
                utmSource = "in_app",
                utmMedium = "share_button"
            )
        )
        Log.d("OpenGrow", "Generated: $link")
    } catch (e: OpenGrowException) {
        Log.e("OpenGrow", "Error: ${e.message}")
    }
}
```

### Custom redirects

Override where a link sends users on each platform:

```kotlin
val redirects = CustomRedirects(
    ios = CustomLinkRedirect(link = "https://example.com/ios-promo"),
    android = CustomLinkRedirect(link = "https://example.com/android-promo"),
    desktop = CustomLinkRedirect(link = "https://example.com/desktop-promo", openAppIfInstalled = false)
)

OpenGrow.generateLink(
    title = "Special offer",
    data = mapOf("promoId" to "summer25"),
    customRedirects = redirects,
    lifecycleOwner = this,
    listener = { link, error ->
        link?.let { Log.d("OpenGrow", "Generated: $it") }
    }
)
```

### Share intent

Launch a share intent after generating a link:

```kotlin
OpenGrow.generateLink(
    title = "Share this",
    data = mapOf("itemId" to "abc"),
    lifecycleOwner = this,
    listener = { link, _ ->
        link?.let {
            val sendIntent = Intent().apply {
                action = Intent.ACTION_SEND
                putExtra(Intent.EXTRA_TEXT, it)
                type = "text/plain"
            }
            startActivity(Intent.createChooser(sendIntent, "Share via"))
        }
    }
)
```

## Messages

> If console messages have **automatic display** enabled in your dashboard, they will appear in your app without any additional integration.

### Push notifications

To receive push notifications for messages sent from the OpenGrow dashboard:

**1. Add Firebase Cloud Messaging** — If your app doesn't already use Firebase, add your app in the [Firebase Console](https://console.firebase.google.com), download `google-services.json`, and add the dependencies:

```groovy
// project-level build.gradle
plugins {
    id("com.google.gms.google-services") version "4.4.2" apply false
}

// app-level build.gradle
plugins {
    id("com.google.gms.google-services")
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")
}
```

**2. Upload your Firebase credentials** — In the [Firebase Console](https://console.firebase.google.com), go to **Project Settings → Service Accounts** and generate a new private key. Upload the JSON key file and enter your Firebase Project ID in the OpenGrow Dashboard deployed for the active application target, under **Android Setup → Push Notifications**.

**3. Request notification permission** (Android 13+):

```kotlin
import android.Manifest
import android.os.Build

if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
}
```

Add to your `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

**4. Pass the FCM token to OpenGrow:**

```kotlin
FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
    OpenGrow.pushToken = token
}
```

Also update the token when it refreshes:

```kotlin
class MyMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        OpenGrow.pushToken = token
    }
}
```

Register the service in `AndroidManifest.xml`:

```xml
<service
    android:name=".MyMessagingService"
    android:exported="false">
    <intent-filter>
        <action android:name="com.google.firebase.MESSAGING_EVENT" />
    </intent-filter>
</service>
```

> Push notifications require a physical device or an emulator with Google Play Services.

### Display messages

```kotlin
// Show the messages list as a modal fragment
OpenGrow.displayMessagesFragment {
    // Fragment was dismissed
}

// Get unread count for badges
lifecycleScope.launch {
    val count = OpenGrow.numberOfUnreadMessages()
    Log.d("OpenGrow", "Unread: $count")
}
```

## Revenue Tracking

> Revenue tracking is currently in **beta**.

### Setup

1. Enable revenue tracking in the OpenGrow Dashboard deployed for the active application target, under **Settings → Revenue Tracking**
2. Configure Google Play Real-Time Developer Notifications — the OpenGrow dashboard provides an automated setup script under **Developers → Android Setup → Revenue**, or you can configure Pub/Sub manually

### Google Play purchases

```kotlin
// In your PurchasesUpdatedListener
override fun onPurchasesUpdated(billingResult: BillingResult, purchases: List<Purchase>?) {
    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
        for (purchase in purchases) {
            OpenGrow.logInAppPurchase(purchase.originalJson)
        }
    }
}
```

> The SDK automatically extracts price, currency, and product info from the purchase JSON. Duplicates are filtered.

### Custom purchases

```kotlin
OpenGrow.logCustomPurchase(
    type = PaymentEventType.BUY,
    priceInCents = 999,       // $9.99
    currency = "USD",
    productId = "premium_monthly"
)
```

Use `CANCELLATION` and `REFUND` payment event types for cancellations and refunds. For Google Play purchases, these are detected automatically via Real-Time Developer Notifications.

## API Reference

### Properties

| Property | Type | Description |
|---|---|---|
| `useTestEnvironment` | `Boolean` | Enable or disable test environment |
| `identifier` | `String?` | User ID shown in dashboard and reports |
| `attributes` | `Map<String, Any>?` | User attributes for analytics |
| `openedLinkDetails` | `DeeplinkDetails?` | Kotlin Flow emitting deep link details |
| `pushToken` | `String?` | FCM device token for push notifications |

### Key Methods

| Method | Description |
|---|---|
| `configure(application, apiKey, useTestEnvironment, baseURL)` | Initialize the SDK |
| `setSDK(enabled)` | Enable or disable the SDK |
| `setDebug(level)` | Set logging level (`INFO`, `ERROR`) |
| `onStart(activity)` | Forward launcher activity's `onStart()` |
| `onNewIntent(intent, activity)` | Forward launcher activity's `onNewIntent()` |
| `generateLink(...)` | Generate a smart link (callback or coroutine) |
| `setOnDeeplinkReceivedListener(activity, listener)` | Register deep link listener |
| `linkDetails(path, ...)` | Get details for a link path (callback or coroutine) |
| `displayMessagesFragment(onDismissed)` | Show messages modal fragment |
| `numberOfUnreadMessages()` | Get unread message count (suspend) |
| `logInAppPurchase(originalJson)` | Log a Google Play Billing purchase |
| `logCustomPurchase(type, priceInCents, currency, productId, startDate)` | Log a custom purchase |

Full API reference: [Android SDK API reference](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/android#api-reference)

## Example App

A demo project is included in [`sdks/android/OpenGrow/app`](https://github.com/mbzadev/opengrow-platform/tree/main/sdks/android/OpenGrow/app).

## Setup Guides

- Adding a Gradle dependency — see [Installation](#installation)
- Getting the package name — use your Android application ID
- Getting the SHA-256 fingerprint — use the certificate registered with the selected target
- Adding an intent filter — see [Quick Start](#quick-start)

## Migration Guides

- Migration procedures are maintained in the [canonical OpenGrow documentation](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Documentation

Full documentation is maintained in the [canonical repository](https://github.com/mbzadev/opengrow-platform/tree/main/docs).

## Support

For technical support, use the support channel configured for the active target or open a repository issue.

## License

See [LICENSE](LICENSE) for details.
