# SuperBoard FlutterFlow v3 cutover

SuperBoard FlutterFlow 3.0.0 replaces two historical packages with one active
package:

- `superboard_flutterflow` at the immutable ref
  `sdk-flutterflow-v3.0.0`;
- its transitive active dependency is `superboard_flutter` at
  `sdk-flutter-v3.0.0`;
- `opengrow_flutterflow_messaging` remains frozen at 1.3.0 only as a rollback
  artefact. It must not be installed beside `superboard_flutterflow`.

The Git-owned FlutterFlow library is the deployment authority. The real
VocoStar export is not edited from this repository and no `.flutterflow/.env`
file or API key is committed.

## Release prerequisites

1. Merge and validate the Flutter 3.0.0 and FlutterFlow 3.0.0 source commits.
2. Publish immutable tags in dependency order:
   `sdk-flutter-v3.0.0`, then `sdk-flutterflow-v3.0.0`.
3. Verify that both tags resolve to the reviewed commits. Never move or reuse a
   failed tag.
4. Configure `SUPERBOARD_PROJECT_KEY`, `FF_API_KEY`,
   `FF_LIBRARY_PROJECT_ID`, `FF_APPLICATION_PROJECT_ID`, and
   `FF_LIBRARY_SUPERBOARD_ONBOARDING_PAGE_KEY` in the protected GitHub
   environments. Values remain outside Git.
5. Run the library and VocoStar edits first with `flutterflow ai test` and
   `--dry-run` against the MBZA development project.

Source verification uses `SUPERBOARD_CLIENT_SOURCE_VOCOSTAR`. During the
migration window only, the verifier and migration-plan CLI also accept
`OPENGROW_CLIENT_SOURCE_VOCOSTAR` as a fallback alias; when both are present,
the SuperBoard variable wins. Neither variable is committed with an export
path.

## One FlutterFlow commit

The following changes form one indivisible FlutterFlow commit. Do not publish
an intermediate project state.

1. Export and retain the last validated VocoStar project snapshot and its
   receipt.
2. Remove both `opengrow_flutterflow` and
   `opengrow_flutterflow_messaging` from Pub dependencies.
3. Add only `superboard_flutterflow`, pinned to
   `sdk-flutterflow-v3.0.0` over public HTTPS.
4. Replace the Library dependency with the SuperBoard library and bind all 11
   `superboard_*` Library Values. The project key comes from
   `SUPERBOARD_PROJECT_KEY`; it is never copied into Git or App State.
5. Apply the Git-owned VocoStar migration. It renames generated custom actions
   to `superboard*`, widgets/pages to `SuperBoard*`, and routes to
   `/superboard-*` while preserving FlutterFlow protobuf identifiers wherever
   action graphs already reference them.
6. Replace the reviewed 35 `opengrow*` VocoStar function references and the
   `OpenGrowOnboarding` widget reference. v3 still exports deprecated aliases
   so generated-code ordering inside this single commit remains safe.
7. Write native v3 keys (`superboard_*` on Android and `SuperBoard*` on iOS).
   The Flutter plugin reads these first and retains v2 key fallbacks.
8. Confirm that no old and new FlutterFlow packages coexist, no mutable branch
   ref or SSH Git URL remains, and no access/refresh token is persisted in
   FlutterFlow App State.
9. Run FlutterFlow validation, diagnostics, native Android/iOS builds, identity
   sign-in/restore/logout, purchase/restore, upload, custom jobs, support
   realtime/attachment, onboarding/newsletter consent, and deep-link checks.
10. Publish only to the MBZA development project. Production VocoStar stays on
    the reviewed v2 snapshot until the development acceptance gates pass.

The secure application session is transactionally mirrored under the v3
`superboard.application_session.v1.*` key and the v2
`opengrow.application_session.v1.*` key during this compatibility window.
Logout and account deletion clear both.

## Promotion

After development acceptance, generate a fresh source snapshot and receipt,
run `flutterflow:source:test`, `flutterflow-library:check`, and
`flutterflow-applications:check`, then promote the exact accepted FlutterFlow
commit to VocoStar. Do not regenerate dependencies or tags during promotion.

## Rollback

Rollback restores the retained pre-cutover FlutterFlow snapshot as one commit,
thereby restoring `opengrow_flutterflow@2.2.5` and
`opengrow_flutterflow_messaging@1.3.0` at their existing immutable refs. Remove
`superboard_flutterflow` in the same commit. The mirrored v2 secure-session key
keeps current sessions recoverable. Re-run native identity, purchase, support,
and file smoke tests before reopening traffic.

Rollback never deletes the v3 secure key and never changes immutable tags; a
later validated v3 redeployment can resume from it.
