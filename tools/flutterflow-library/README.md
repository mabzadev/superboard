# SuperBoard FlutterFlow library

This directory is the Git authority for the reusable FlutterFlow project named
`SuperBoard`. The remote FlutterFlow project is a compiled deployment target, not
the source of truth.

The DSL contains only reusable adapters. Runtime URLs, project identifiers,
environment selection and link domains are FlutterFlow library values supplied
by each application. Identity refresh tokens are owned by the encrypted native
session in `superboard_flutterflow`; they are never stored in FlutterFlow App
State.

The machine-enforced public surface is:

- 11 application-supplied Library Values;
- 9 reusable widgets: `SuperBoardBootstrap`, `SuperBoardFlowsBootstrap`,
  `SuperBoardFlutterFlowFlowsSlot`, `SuperBoardFlutterFlowFlowsOverlay`,
  `SuperBoardFlutterFlowFlowAnchor`, `SuperBoardPaywall`,
  `SuperBoardOnboarding`, `SuperBoardRestorePurchasesButton` and
  `SuperBoardCustomerCenter`;
- 3 reusable pages: `SuperBoardPaywallPage`, `SuperBoardOnboardingPage` and
  `SuperBoardCustomerCenterPage`;
- 88 adapter actions covering session/authentication, Google and Apple account
  linking, push, files, custom jobs, support, purchases, onboarding, marketing
  consent and dynamic links.

The migration remaps existing widget-node references from
`OGBootstrapBridge`, `OGPaywallBridge` and `OGRestoreBridge` to the canonical
widgets above, then removes the legacy definitions. Re-running the DSL is
idempotent.

Updates preserve existing widget and action identifiers. Compatibility actions
keep their names and call the canonical SDK; their former package imports are
replaced. Existing composed pages and action blocks remain available. Tests
check nullable FlutterFlow inputs against the Dart fields exposed by widgets.

## Local verification

The manual `sync-flutterflow-library.yml` workflow runs from `dev`. It checks
published SDK tags, creates an isolated CLI workspace, runs the DSL tests,
and synchronizes the existing library selected by `FF_LIBRARY_PROJECT_ID`.
The `flutterflow-library` GitHub Environment supplies that variable and
`FF_API_KEY`. The workflow does not run on pushes.

For a local run, initialize a separate, empty directory. The CLI uses the
saved FlutterFlow credential or `FF_API_KEY` from the environment:

```bash
flutterflow ai init /tmp/superboard-library-sync \
  --project "$FF_LIBRARY_PROJECT_ID" \
  --base-url https://api.flutterflow.io/v2 --no-save
cp tools/flutterflow-library/dsl/edit.dart /tmp/superboard-library-sync/dsl/edit.dart
cp tools/flutterflow-library/test/app_test.dart /tmp/superboard-library-sync/test/app_test.dart
cd /tmp/superboard-library-sync
flutterflow ai test test/app_test.dart
flutterflow ai run dsl/edit.dart --project-id "$FF_LIBRARY_PROJECT_ID" \
  --commit-message "Sync SuperBoard library"
```

The SDK dependencies must exist as immutable Git tags before a remote push.
Application targets configure their own values; for the MBZA development
target the short-link value is `in.mbza.dev`.
