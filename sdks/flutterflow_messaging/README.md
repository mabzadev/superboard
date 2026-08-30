# SuperBoard FlutterFlow Support

The canonical FlutterFlow integration is provided by the unified
`superboard_flutterflow` package and its `superboardSupport*` actions. The
current installation and Support API are documented in
[`../flutterflow/README.md`](../flutterflow/README.md).

<!-- opengrow-sdk-documentation:flutterflow-support:start -->

> **Lifecycle: archived.** This package is frozen for existing clients.
> Its historical release remains available, but no new version may be
> published.

## Historical installation

Add the published FlutterFlow Support package `opengrow_flutterflow_messaging`
at the immutable release `sdk-flutterflow-messaging-v1.3.0`:

```yaml
opengrow_flutterflow_messaging:
  git:
    url: https://github.com/mabzadev/superboard.git
    ref: sdk-flutterflow-messaging-v1.3.0
    path: sdks/flutterflow_messaging
```

No repository read token is required. Runtime credentials must never be
placed in the Git dependency or exported application source.

Then resolve the immutable dependency:

```bash
flutter pub get
```

<!-- opengrow-sdk-documentation:flutterflow-support:end -->
