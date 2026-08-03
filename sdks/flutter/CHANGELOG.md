## 2.0.0

* Added remote paywall configuration with per-placement offline caching
* Added targeting and deterministic experiment assignment models
* Added paywall funnel events and stable Purchases v2 errors
* Added typed subscriptions, active subscriptions, management URLs, and virtual currencies
* Added Customer Center configuration and richer customer information
* Changed the default Purchases endpoint to `/purchases/v2` while the server keeps v1 compatible

## 1.1.1

* Relaxed the `shared_preferences` constraint for FlutterFlow 2.5.3 compatibility

## 1.1.0

* Added automatic Bundle ID / Package Name discovery
* Added native-configuration initialization
* Added Flutter message-center count and display methods
* Added server-verified StoreKit 2 and Google Play purchases
* Added offerings, packages, entitlements, and signed customer information
* Added login/logout, restore, sync, offline cache, and customer info stream
* Added explicit purchased, cancelled, pending, and failed outcomes
* Added custom base URL support via Info.plist (iOS) and AndroidManifest.xml (Android)
* Added revenue tracking with `logInAppPurchase` and `logCustomPurchase` methods
* Added `TransactionType` enum (buy, cancel, refund)
* Embedded the native Android implementation for credential-free private Git builds

## 1.0.1

* Documentation improvements
* Added iOS Associated Domains configuration instructions
* Enhanced API documentation with comprehensive examples
* Updated README with complete setup guide
* Improved code comments and inline documentation

## 1.0.0

* Initial release of OpenGrow Flutter Plugin
* Deep linking support for iOS and Android
* Link generation with custom redirects and tracking parameters
* UTM campaign tracking (utm_campaign, utm_source, utm_medium)
* User identification and custom attributes
* Push notification token management
* In-app messaging support
* Configurable debug levels
* Stream-based deeplink event handling
* Platform-specific configuration via Info.plist (iOS) and AndroidManifest.xml (Android)
* Support for iOS 13.0+ and Android API 21+
