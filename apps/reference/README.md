# SuperBoard FlutterFlow Reference

Canonical FlutterFlow reference application for the SuperBoard platform.

- Platform and library source: <https://github.com/mabzadev/superboard>
- This repository: <https://github.com/mabzadev/superboard>
- Development reference app: <https://reference.mbza.dev>
- Development back office: <https://board.mbza.dev>
- Development API: <https://api.mbza.dev>
- Development short links: <https://in.mbza.dev>
- Development mail preview: <https://mail.mbza.dev>

This repository contains an executable Flutter reference shell and the
FlutterFlow import contract. It demonstrates integration without copying
SuperBoard SDK or custom-action implementations. In the monorepo, FlutterFlow
and Flutter resolve the reviewed SuperBoard v3 workspace candidates directly;
the protected release promotion rewrites both coordinates to immutable Git
references before publishing a deployable Reference build.

The application exposes all 16 baseline journeys in demo mode and can switch to
live mode only through build configuration. `reference.project.json`,
`flutterflow/custom-code-catalog.json` and the validation matrix remain the
source of truth when reproducing the same screens inside FlutterFlow.
After the live journeys, the same public custom-job facade records a strict
`reference.acceptance` receipt bound to the exact platform/reference revisions;
the SuperBoard Infrastructure page can inspect it without exposing a private
Worker token to the client. The journey also calls the public cancellation
action and requires the exact terminal `job_not_cancellable` response because
reference receipts complete synchronously; failed-job retry remains available
only to Grow administrators.
The library versions and complete public action/widget surface are referenced
from `config/sdk-libraries.json` and
`config/flutterflow-custom-code.json` at the monorepo root; this application
contains no copied network implementation or Marketing adapter.
The complete platform data-store and duplicate inventory is maintained in
[`docs/REFERENCE_DATA_INVENTORY.md`](https://github.com/mabzadev/superboard/blob/dev/docs/REFERENCE_DATA_INVENTORY.md).

The default monorepo checkout already resolves the reviewed workspace packages.
To point the application at a different local SuperBoard checkout, generate an
ignored dependency override without storing that machine path in Git:

```bash
dart tool/use_local_platform.dart /path/to/superboard
flutter pub get
npm run check
flutter run -d chrome --dart-define-from-file=config/development.json
```

`pubspec.lock` is versioned because this repository is an application. It pins
the exact resolved dependency graph for either the coordinated workspace
candidate or the promoted immutable Git set. Support is part of the canonical
Flutter and FlutterFlow packages; the frozen standalone Support artifact is
retained for historical regression checks only and is never consumed or bundled
by this application. The Flutter, FlutterFlow, Support, iOS, Android, JavaScript
and React Native lifecycle contract is documented in
[`docs/SDK_COVERAGE.md`](docs/SDK_COVERAGE.md) and enforced from
`config/sdk-coverage.json`. Flutter and FlutterFlow are active, Android and iOS
are internal, and the standalone historical Support artifact, JavaScript and
React Native entries are archived. The optional override for a separate checkout
changes working-copy resolution to local paths; never commit that override.
Remove `pubspec_overrides.yaml` and run `flutter pub get` again before proposing
a dependency update.

`config/development.json` contains public `mbza.dev` endpoints only. Live mode
requires a SuperBoard client project key and ID supplied by a separate ignored
config or CI environment. The client key is necessarily embedded in the Web
application, but it is never hardcoded in Git; server authorization continues
to rely on the application identity token and private Worker bindings. Its SDK
platform, identifier and test/production project must match an application
registered in the SuperBoard back office. Server secrets and user tokens never
belong in this file. GitHub CI checks out the public platform repository without
a repository read token.

The MBZA development endpoint contract is closed: `reference.mbza.dev`,
`board.mbza.dev`, `api.mbza.dev`, `sdk.mbza.dev`, `in.mbza.dev`,
`files.mbza.dev`, `mail.mbza.dev`, and the single Support path
`api.mbza.dev/api/v1/support-client`. The project schema, build tooling and
runtime validation reject HTTP, embedded URL credentials, query strings,
fragments and every other path. `config/development.json` is also a strict
allowlist of reviewed Dart defines; adding a key or changing an endpoint fails
CI even if `reference.project.json` is changed at the same time.

Reference CI is part of the platform promotion boundary: pushes and pull
requests validate `apps/reference` against the same exact SuperBoard commit.
After a complete SDK release set succeeds, the protected promotion updates this
application in the monorepo. It verifies catalogue v5, immutable baseline and historical tags,
peeled commits, public GitHub Releases and the exact checked-out catalogue. A
protected promotion PR is created only after Flutter and FlutterFlow v3 are both
fully published. It updates the two active coordinates together and rejects any
standalone Support dependency; partial promotion is rejected. All coverage reads
are public and secretless.

After validation, a push to `dev` publishes the Flutter Web acceptance app to
`https://reference.mbza.dev` as a Cloudflare Static Assets Worker. Deployment
configuration is generated from `reference.project.json`; no account ID, API
token or project identity is committed. The GitHub `development` environment
provides `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`SUPERBOARD_PROJECT_KEY` and `SUPERBOARD_PROJECT_ID` as encrypted values.
Deprecated build-variable aliases are accepted only as CI input compatibility;
they are never emitted into the client or displayed in the application. Pull
requests and `main` never deploy this MBZA test application. To verify the exact
Worker bundle without publishing it, run `npm run cloudflare:dry-run`.
Before a real publish, the script reads the zone, DNS and Worker custom-domain
state. It proceeds only when `reference.mbza.dev` is unused or already attached
to the registered Reference Worker; it never adopts or removes an occupied
record. `superboard-reference` is the logical deployment name; the physical
Worker resource name remains an infrastructure-only deployment detail so
existing remote state is not replaced.

For a first account bootstrap, `npm run cloudflare:deploy:private` uploads the
same tested Static Assets Worker with `workers.dev` and preview URLs disabled
and with no route at all. `npm run cloudflare:dry-run:private` proves that
configuration without writing. This private bootstrap does not replace the
GitHub deployment flow and cannot make `reference.mbza.dev` public.

The root CI records the exact monorepo SHA used for the platform and reference
application, then builds both from that immutable revision. The application
displays the short revision and includes it in sanitized diagnostics. No
cross-repository dispatch or mutable platform checkout remains.

The complete sixteen-journey manual acceptance procedure is in
[`docs/ACCEPTANCE_RUNBOOK.md`](docs/ACCEPTANCE_RUNBOOK.md). It defines exact
operation inputs, evidence, provider-only checks and the promotion receipt used
before VocoStar adoption.

## License

SuperBoard Reference is released under the [MIT License](./LICENSE).

Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues through the private process documented in [SECURITY.md](./SECURITY.md).
