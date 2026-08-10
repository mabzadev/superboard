# VocoStar FlutterFlow configuration

This workspace applies both the SuperBoard Library Values and the brownfield
client migration to the existing VocoStar FlutterFlow project. The values are
generated from the target manifests; the FlutterFlow project ID, SuperBoard
library project ID, FlutterFlow API key and SuperBoard client project key are supplied by the protected
`flutterflow-vocostar` GitHub Environment.

`generated/application_bindings.dart` is generated from
`config/flutterflow-application-bindings.json`. Do not edit it directly.

`dsl/migration.dart` performs the idempotent application-specific cutover. It
preserves FlutterFlow protobuf identifiers while it:

- moves refresh-token ownership to encrypted SuperBoard SDK storage;
- keeps only an ephemeral access-token bridge for FlutterFlow custom auth;
- replaces direct Google/Apple calls with SuperBoard Identity;
- rewrites every direct logout graph to the common session action and removes
  the legacy FlutterFlow logout endpoint after proving there are no references;
- routes account deletion through the durable SuperBoard erasure workflow, then
  clears Purchases and transient FlutterFlow authentication state;
- replaces direct file hosts and media conversion with Files IDs and the
  VocoStar Custom Worker;
- replaces direct Chatwoot code and state with common Support;
- binds maintenance/update checks to the target runtime policy;
- repairs legacy data-struct list serialization and removes genuinely unused
  API variables without breaking action-graph bindings.

The migration has a fixture-based idempotence test and is also compiled through
`flutterflow ai validate` against the real VocoStar project before release. A
validation run is a dry run and never pushes the remote project.

The deployment workflow initializes this workspace against the existing
project, compiles and tests the DSL, verifies immutable SuperBoard SDK tags, then
pushes the configuration. It is intentionally sequenced after the SuperBoard
FlutterFlow library sync.

The migration requires the single immutable
`sdk-flutterflow-v3.0.0` package. That package includes the complete Support
surface; the archived Messaging package must not be installed beside it. Until
the v3 tag exists in the public platform repository, only local tests and remote
dry-run validation are allowed; the remote FlutterFlow project must not be
mutated. The atomic cutover and rollback gates are documented in
`docs/SUPERBOARD_FLUTTERFLOW_V3_CUTOVER.md`.
