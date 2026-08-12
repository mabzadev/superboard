# SDK lifecycle and v3 promotion contract

`config/sdk-coverage.json` is the reviewed Reference view of Platform catalogue
schema v4. It separates the immutable SDK baseline compiled by the application
from the next SuperBoard candidate set.

| SDK | Lifecycle | Compiled/reference baseline | Candidate | Reference coverage |
| --- | --- | --- | --- | --- |
| Flutter | active | OpenGrow 2.1.4 | SuperBoard 3.0.0 | transitive Git override + lock |
| FlutterFlow | active | OpenGrow 2.2.5 | SuperBoard 3.0.0 | direct Git dependency + lock |
| Messaging / Support | archived | OpenGrow 1.3.0 | none; folded into FlutterFlow v3 | legacy direct dependency until v3 |
| Android | internal | OpenGrow 1.0.3 | none | immutable historical release |
| iOS | internal | OpenGrow 1.0.3 | none | immutable historical release |
| JavaScript | archived | OpenGrow 1.0.2 | none | immutable historical release |
| React Native | archived | OpenGrow 1.0.2 | none | immutable historical release |

Only Flutter and FlutterFlow are active products. Android and iOS remain
internal implementations of Flutter. Messaging/Support, JavaScript and React
Native remain reproducible historical entries but cannot trigger a new release.

## Baseline-first compilation

The Reference application compiles only against published immutable tags.
Platform `dev` can expose 3.0.0 source and candidate metadata without making an
unpublished package part of the deployable Reference artifact. The app and its
SDK status dialog continue to show both v3 candidates while `pubspec.yaml` and
`pubspec.lock` stay pinned to the published 2.x/1.x baseline.

FlutterFlow 2.2.5 still resolves Flutter transitively. The reviewed root
override converges that dependency to the separately published Flutter 2.1.4
tag and exact commit. This does not mutate either historical tag.

## Atomic promotion

The promotion policy is `complete-active-set`. Promotion fails unless:

- the catalogue uses schema version 4;
- exactly Flutter and FlutterFlow are `active`;
- both active entries are `released` at their 3.0.0 source versions;
- both released package coordinates use the SuperBoard namespace;
- Android and iOS remain `internal` and frozen;
- Support, JavaScript and React Native remain `archived` and frozen;
- every immutable tag and release SHA is valid.

When the complete active set is ready, the promotion script updates both active
Dart coordinates together, removes the standalone Support dependency, keeps its
historical coverage entry, regenerates `pubspec.lock`, and opens a protected PR.
An individual Flutter or FlutterFlow promotion is intentionally impossible.
The generated PR still passes through the full Flutter compile gate. It cannot
merge unless the v3 packages expose the reviewed transition surface or the
Reference bridge migration is included through a separately reviewed change.

## Secretless gates

```bash
npm run sdk:coverage:check
npm run sdk:coverage:verify
npm run sdk:coverage:catalog -- \
  --catalog /path/to/superboard/config/sdk-libraries.json
flutter pub get --enforce-lockfile
git diff --exit-code -- pubspec.lock
```

- `sdk:coverage:check` validates lifecycle, baseline locks, project metadata and
  the two displayed candidates.
- `sdk:coverage:verify` uses public Git reads and GitHub Release URLs to verify
  every immutable baseline and historical tag.
- `sdk:coverage:catalog` compares the Reference snapshot with the exact checked
  out Platform catalogue v4, including lifecycle and pending candidate state.

The iOS baseline consumes SwiftPM tag `1.0.3`, while its canonical historical
GitHub Release tag remains `sdk-ios-v1.0.3`; both must resolve to the same
commit. None of these gates requires a GitHub token, Cloudflare credential,
dispatch token or application secret.
