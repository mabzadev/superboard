# Migrate the Flutter SDK from OpenGrow 2.x to SuperBoard 3

SuperBoard 3 is a package rename with an intentionally conservative runtime
migration. Upgrade the dependency and imports in one change; do not install the
OpenGrow and SuperBoard packages together.

## 1. Change the package coordinate

```yaml
superboard_flutter:
  git:
    url: https://github.com/mabzadev/superboard.git
    ref: sdk-flutter-v3.0.0
    path: sdks/flutter
```

The v3 tag must exist and be validated by the protected release workflow before
an application uses this coordinate. The immutable `sdk-flutter-v2.1.4` tag is
the rollback baseline.

## 2. Change imports and public names

```dart
import 'package:superboard_flutter/superboard_flutter.dart';

final superboard = SuperBoard();
final purchases = SuperBoardPurchases.instance;
```

Every public type whose name started with `OpenGrow` now has a corresponding
`SuperBoard` name. Deprecated `OpenGrow*` aliases and the old Dart entrypoint
filenames remain available in 3.x, but should only be used to split a large app
migration into reviewable steps.

## 3. Change native configuration names

| Platform | SuperBoard 3 | OpenGrow 2.x fallback |
| --- | --- | --- |
| Android | `superboard_api_key` | `opengrow_api_key` |
| Android | `superboard_use_test_environment` | `opengrow_use_test_environment` |
| Android | `superboard_base_url` | `opengrow_base_url` |
| iOS | `SuperBoardApiKey` | `OpenGrowApiKey` |
| iOS | `SuperBoardUseTestEnvironment` | `OpenGrowUseTestEnvironment` |
| iOS | `SuperBoardBaseURL` | `OpenGrowBaseURL` |

The v3 plugin reads the canonical key first and the fallback second. Keep only
the canonical key after every supported application version has migrated.

## 4. Regenerate native plugin registrants

Run `flutter clean` once when moving from 2.x, followed by `flutter pub get`,
`pod install` for iOS, and a full Android build. The generated registrants must
reference:

- Android: `io.superboard.wrapper.SuperBoardPlugin`
- iOS: `SuperBoardPlugin`

The wrapper registers one plugin instance and the canonical `superboard` and
`superboard/deeplinks` channels. Dart falls back to the 2.x channels only when
a stale native build is detected.

## 5. Preserve user and purchase state

Do not rename or delete values whose physical keys start with `opengrow.*`.
SuperBoard 3 deliberately keeps the anonymous identifier, signed CustomerInfo,
JWKS cache, paywall cache, and encrypted purchase outbox under those keys. This
makes an upgrade and rollback read the same durable state and prevents duplicate
purchase validation or a disconnected anonymous user.

During the rolling backend migration, the SDK also accepts both SuperBoard and
OpenGrow purchase-JWT audiences/issuers and sends both generations of SDK
metadata headers. Remove the legacy protocol only after Worker telemetry proves
that no supported application version still depends on it.
