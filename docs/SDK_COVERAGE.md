# Seven-SDK reference contract

`config/sdk-coverage.json` is the reviewed, versioned coverage manifest for the
complete public SuperBoard SDK set. It is deliberately separate from
`reference.project.json`: the latter describes the two libraries imported
directly by the FlutterFlow application, while the coverage manifest describes
every SDK release that belongs to the reusable platform baseline.

| SDK                 | Version | Coverage in this repository       | Immutable release tag                 |
| ------------------- | ------- | --------------------------------- | ------------------------------------- |
| Flutter             | 2.1.4   | transitive Git override + lock    | `sdk-flutter-v2.1.4`                  |
| FlutterFlow         | 2.2.5   | direct Git dependency + lock      | `sdk-flutterflow-v2.2.5`              |
| Messaging / Support | 1.3.0   | direct Git dependency + lock      | `sdk-flutterflow-messaging-v1.3.0`    |
| iOS                 | 1.0.3   | release/catalogue contract        | `sdk-ios-v1.0.3`                      |
| Android             | 1.0.3   | release/catalogue contract        | `sdk-android-v1.0.3`                  |
| JavaScript          | 1.0.2   | release/catalogue contract        | `sdk-js-v1.0.2`                       |
| React Native        | 1.0.2   | release/catalogue contract        | `sdk-react-native-v1.0.2`             |

The executable Web reference cannot run native iOS, Android, JavaScript or
React Native packages. Their `release-contract` mode therefore proves the
public package identity, source path, version, catalogue state, immutable tag,
peeled commit SHA and GitHub Release. Platform SDK repositories remain
responsible for each package's own build and test suite.

FlutterFlow 2.2.5 was published before Flutter 2.1.4 and its immutable tag still
contains a path dependency whose package version is 2.1.3. The root
`dependency_overrides` declaration intentionally selects the separately
published `sdk-flutter-v2.1.4` tag. `pubspec.lock` records its exact peeled SHA,
so this convergence neither mutates nor replaces the FlutterFlow release tag.

## Secretless gates

Run the same gates locally or in CI:

```bash
npm run sdk:coverage:check
npm run sdk:coverage:verify
npm run sdk:coverage:catalog -- \
  --catalog /path/to/superboard-platform/config/sdk-libraries.json
flutter pub get --enforce-lockfile
git diff --exit-code -- pubspec.lock
```

- `sdk:coverage:check` validates the seven identities and validates every Dart
  dependency against `pubspec.yaml`, `reference.project.json` and
  `pubspec.lock`.
- `sdk:coverage:verify` performs public `git ls-remote` reads, peels annotated
  tags, compares every commit SHA, and checks each public GitHub Release URL.
- `sdk:coverage:catalog` compares the manifest with the exact catalogue from
  the platform revision checked out by CI.

These commands use no GitHub token, Cloudflare credential, dispatch token or
application secret. The iOS package is the only dual-ref case: Swift Package
Manager consumes `1.0.3`, while the canonical GitHub Release is
`sdk-ios-v1.0.3`; both tags must peel to the same commit.

The SDK promotion script updates the complete manifest and the Flutter override
from a fully released seven-entry catalogue. It fails closed on a missing,
pending, non-canonical or incomplete entry. Regenerating the Dart lockfile and
opening the protected update PR remain separate reviewed steps; the coverage
gate does not need or use a cross-repository dispatch token.
