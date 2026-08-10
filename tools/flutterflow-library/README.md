# OpenGrow FlutterFlow library

This directory is the Git authority for the reusable FlutterFlow project named
`OpenGrow`. The remote FlutterFlow project is a compiled deployment target, not
the source of truth.

The DSL contains only reusable adapters. Runtime URLs, project identifiers,
environment selection and link domains are FlutterFlow library values supplied
by each application. Identity refresh tokens are owned by the encrypted native
session in `opengrow_flutterflow`; they are never stored in FlutterFlow App
State.

The machine-enforced public surface is:

- 11 application-supplied Library Values;
- 5 reusable widgets: `OpenGrowBootstrap`, `OpenGrowPaywall`,
  `OpenGrowOnboarding`, `OpenGrowRestorePurchasesButton` and
  `OpenGrowCustomerCenter`;
- 3 reusable pages: `OpenGrowPaywallPage`, `OpenGrowOnboardingPage` and
  `OpenGrowCustomerCenterPage`;
- 64 adapter actions covering session/authentication, Google and Apple account
  linking, push, files, custom jobs, support, purchases, onboarding, marketing
  consent and dynamic links.

The migration remaps existing widget-node references from
`OGBootstrapBridge`, `OGPaywallBridge` and `OGRestoreBridge` to the canonical
widgets above, then removes the legacy definitions. Re-running the DSL is
idempotent.

## Local verification

Initialize the workspace with environment-owned credentials, then test it:

```bash
flutterflow ai init tools/flutterflow-library \
  --project "$FF_LIBRARY_PROJECT_ID" \
  --api-key "$FF_API_KEY" \
  --no-save
cd tools/flutterflow-library
flutterflow ai test
```

The public SDK dependencies must exist as immutable Git tags before a remote
push. The GitHub sync workflow enforces the tags, runs `flutterflow ai test`,
and only then updates the configured FlutterFlow library project.

Application targets configure their own values; for the MBZA development
target the short-link value is `in.mbza.dev`.
