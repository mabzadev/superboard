# SDK lifecycle and v3 promotion contract

`config/sdk-coverage.json` is the reviewed Reference view of Platform catalogue
schema v5. It separates historical release evidence from the coordinated
SuperBoard workspace candidate compiled by the monorepo application.

This manifest intentionally projects only the seven SDKs consumed or preserved
by the Reference application. The Platform catalogue may contain additional
governed products, including the initially unreleased Flows web packages,
without making them Reference dependencies.

| SDK | Lifecycle | Compiled/reference baseline | Candidate | Reference coverage |
| --- | --- | --- | --- | --- |
| Flutter | active | OpenGrow 2.1.4 | SuperBoard 3.0.0 | reviewed transitive workspace path + lock |
| FlutterFlow | active | OpenGrow 2.2.5 | SuperBoard 3.0.0 | reviewed direct workspace path + lock |
| Standalone Support artifact | archived | OpenGrow 1.3.0 | none; Support is native in Flutter/FlutterFlow v3 | historical regression evidence only; never consumed or bundled |
| Android | internal | OpenGrow 1.0.3 | none | immutable historical release |
| iOS | internal | OpenGrow 1.0.3 | none | immutable historical release |
| JavaScript | archived | OpenGrow 1.0.2 | none | immutable historical release |
| React Native | archived | OpenGrow 1.0.2 | none | immutable historical release |

Only Flutter and FlutterFlow are active products. Android and iOS remain
internal implementations of Flutter. The standalone historical Support artifact,
JavaScript and React Native remain reproducible audit entries but cannot trigger
a new release or become Reference runtime dependencies.

## Candidate compilation and immutable promotion

The monorepo Reference application compiles the reviewed Flutter and FlutterFlow
3.0.0 workspace candidates so every Support action is validated against the
same source revision. `pubspec.yaml` and `pubspec.lock` therefore contain the
coordinated local paths during development. Release promotion replaces both
active coordinates atomically with immutable SuperBoard Git references before a
published Reference build is accepted. Candidate or lifecycle status is not
rendered in the application UI.

## Atomic promotion

The promotion policy is `complete-active-set`. Promotion fails unless:

- the catalogue uses schema version 5;
- exactly Flutter and FlutterFlow are `active` in the seven-entry Reference
  projection (other active Platform packages are ignored by this app);
- both active entries are `released` at their 3.0.0 source versions;
- both released package coordinates use the SuperBoard namespace;
- Android and iOS remain `internal` and frozen;
- the standalone Support artifact, JavaScript and React Native remain `archived`
  and frozen;
- every immutable tag and release SHA is valid.

When the complete active set is ready, the promotion script updates both active
Dart coordinates together, proves that no standalone Support dependency exists,
keeps its historical coverage entry, regenerates `pubspec.lock`, and opens a
protected PR.
An individual Flutter or FlutterFlow promotion is intentionally impossible.
The generated PR still passes through the full Flutter compile gate. It cannot
merge unless the v3 packages expose the complete reviewed SuperBoard surface.

## Secretless gates

```bash
npm run sdk:coverage:check
npm run sdk:coverage:verify
npm run sdk:coverage:catalog -- \
  --catalog /path/to/superboard/config/sdk-libraries.json
flutter pub get --enforce-lockfile
git diff --exit-code -- pubspec.lock
```

- `sdk:coverage:check` validates lifecycle, candidate paths, baseline evidence,
  project metadata and the two coordinated active packages.
- `sdk:coverage:verify` uses public Git reads and GitHub Release URLs to verify
  every immutable baseline and historical tag.
- `sdk:coverage:catalog` compares the Reference snapshot with the exact checked
  out Platform catalogue v5, including lifecycle and candidate state.

The iOS baseline consumes SwiftPM tag `1.0.3`, while its canonical historical
GitHub Release tag remains `sdk-ios-v1.0.3`; both must resolve to the same
commit. None of these gates requires a GitHub token, Cloudflare credential,
dispatch token or application secret.
