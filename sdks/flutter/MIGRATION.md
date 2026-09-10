# Upgrade to SuperBoard Flutter 4

Version 4.0.0 is not published yet. This source removes deprecated namespace
aliases and uses the canonical protocol throughout. Published 3.0.0 tags retain
their original contents.

Import the canonical entrypoint and use the current public types:

```dart
import 'package:superboard_flutter/superboard_flutter.dart';

final superboard = SuperBoard();
final purchases = SuperBoardPurchases.instance;
```

Configure the native wrapper using these keys:

| Platform | Keys                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| Android  | `superboard_api_key`, `superboard_use_test_environment`, `superboard_base_url` |
| iOS      | `SuperBoardApiKey`, `SuperBoardUseTestEnvironment`, `SuperBoardBaseURL`        |

Run `flutter clean`, `flutter pub get` and `pod install` for iOS, then rebuild the
native application. The registrants must use
`io.superboard.wrapper.SuperBoardPlugin` on Android and `SuperBoardPlugin` on iOS.
The wrapper registers the `superboard` and `superboard/deeplinks` channels.
Missing native wrappers raise an error; there is no fallback channel.

The application and backend must use the same protocol version. HTTP metadata
uses `X-SuperBoard-*` headers. Purchase signatures use `superboard-purchases` as
issuer and `superboard-sdk` as audience.

Local persistence keys also use the canonical namespace. Before upgrading an
existing application, complete pending purchase submissions, retain a stable
authenticated user identifier, and verify purchase restoration. Previous cached
signatures are not accepted by version 4.

For backend configuration and existing databases, see the
[namespace upgrade guide](../../docs/SUPERBOARD_NAMESPACE_UPGRADE.md).
