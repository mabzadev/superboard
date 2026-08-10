# OpenGrow FlutterFlow Reference

Canonical FlutterFlow reference application for the OpenGrow platform.

- Platform and library source: <https://github.com/mbzadev/opengrow-platform>
- This repository: <https://github.com/mbzadev/opengrow-reference>
- Development reference app: <https://reference.mbza.dev>
- Development back office: <https://grow.mbza.dev>
- Development API: <https://api.mbza.dev>
- Development short links: <https://in.mbza.dev>
- Development mail preview: <https://mail.mbza.dev>

This repository contains an executable Flutter reference shell and the
FlutterFlow import contract. It demonstrates integration without copying
OpenGrow SDK or custom-action implementations. FlutterFlow and Flutter consume
the packages from `opengrow-platform` through Git dependencies. The `dev` branch
tracks the platform `dev` branch; a production release must pin an immutable SDK
tag before it is merged to `main`.

The application exposes all 16 baseline journeys in demo mode and can switch to
live mode only through build configuration. `reference.project.json`,
`flutterflow/custom-code-catalog.json` and the validation matrix remain the
source of truth when reproducing the same screens inside FlutterFlow.
After the live journeys, the same public custom-job facade records a strict
`reference.acceptance` receipt bound to the exact platform/reference revisions;
the OpenGrow Infrastructure page can inspect it without exposing a private
Worker token to the client. The journey also calls the public cancellation
action and requires the exact terminal `job_not_cancellable` response because
reference receipts complete synchronously; failed-job retry remains available
only to Grow administrators.
The library versions and complete public action/widget surface are referenced
from `opengrow-platform/config/sdk-libraries.json` and
`opengrow-platform/config/flutterflow-custom-code.json`; this repository
contains no copied network implementation or Marketing adapter.
The complete platform data-store and duplicate inventory is maintained in
[`opengrow-platform/docs/REFERENCE_DATA_INVENTORY.md`](https://github.com/mbzadev/opengrow-platform/blob/dev/docs/REFERENCE_DATA_INVENTORY.md).

For a local checkout, generate an ignored dependency override without storing a
machine path in Git:

```bash
dart tool/use_local_platform.dart /path/to/opengrow-platform
flutter pub get
npm run check
flutter run -d chrome --dart-define-from-file=config/development.json
```

`config/development.json` contains public `mbza.dev` endpoints only. Live mode
requires an OpenGrow client project key and ID supplied by a separate ignored
config or CI environment. The client key is necessarily embedded in the Web
application, but it is never hardcoded in Git; server authorization continues
to rely on the application identity token and private Worker bindings. Its SDK
platform, identifier and test/production project must match an application
registered in the OpenGrow back office. Server secrets and user tokens never
belong in this file. GitHub CI checks out the public platform repository without
a repository read token.

Reference CI follows the same promotion boundary as the platform: pushes and
pull requests targeting `dev` validate against `opengrow-platform/dev`; `main`
validates against an exact `opengrow-platform` revision. The checked-in Git
dependency on `dev` is therefore a bootstrap/development-only fallback. After a
FlutterFlow or Support SDK release succeeds, the platform dispatches the exact
release SHA, promoted catalogue SHA, version and immutable tag. This repository
verifies the official tags, GitHub releases and catalogue before opening one
protected PR that updates both Git dependencies together. A deployable
promotion can therefore never point at an absent or mutable SDK ref, and the
automation never bypasses branch review.

After validation, a push to `dev` publishes the Flutter Web acceptance app to
`https://reference.mbza.dev` as a Cloudflare Static Assets Worker. Deployment
configuration is generated from `reference.project.json`; no account ID, API
token or project identity is committed. The GitHub `development` environment
provides `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`OPENGROW_PROJECT_KEY` and `OPENGROW_PROJECT_ID` as encrypted values. Pull
requests and `main` never deploy this MBZA test application. To verify the exact
Worker bundle without publishing it, run `npm run cloudflare:dry-run`.
Before a real publish, the script reads the zone, DNS and Worker custom-domain
state. It proceeds only when `reference.mbza.dev` is unused or already attached
to `opengrow-reference-app-dev`; it never adopts or removes an occupied record.

For a first account bootstrap, `npm run cloudflare:deploy:private` uploads the
same tested Static Assets Worker with `workers.dev` and preview URLs disabled
and with no route at all. `npm run cloudflare:dry-run:private` proves that
configuration without writing. This private bootstrap does not replace the
GitHub deployment flow and cannot make `reference.mbza.dev` public.

A successful `opengrow-platform/dev` deployment sends the
`platform-dev-updated` repository dispatch event. The reference workflow then
checks out the exact platform commit from `client_payload.platform_sha`, reruns
the complete acceptance validation from `opengrow-reference/dev`, records the
exact tested platform and reference SHAs, and builds the live artifact from
those two immutable revisions inside the protected `development` Environment.
The application displays both short SHAs and includes the complete values in
sanitized diagnostics. This keeps MBZA synchronized without using a mutable
platform ref during that cross-repository build.

The complete sixteen-journey manual acceptance procedure is in
[`docs/ACCEPTANCE_RUNBOOK.md`](docs/ACCEPTANCE_RUNBOOK.md). It defines exact
operation inputs, evidence, provider-only checks and the promotion receipt used
before VocoStar adoption.

## License

OpenGrow Reference is released under the [MIT License](./LICENSE).

Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues through the private process documented in [SECURITY.md](./SECURITY.md).
