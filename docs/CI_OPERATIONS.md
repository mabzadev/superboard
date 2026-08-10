# Continuous integration and deployment ownership

## GitHub Actions

Pull-request GitHub Actions validate changes without deploying Cloudflare
services. A push to `dev` or `main` can deploy only after the separate workflow
receives a successful completed `CI` run for that branch. The deployment checks
out the exact validated SHA and skips a revision that has already been
superseded before it reaches Cloudflare.

Every push to the default branch and every pull request starts one short planning job. That job runs the secret scan, enforces the neutral-English product-copy policy, and selects only the affected supported domains:

- API, Billing, legacy Messaging compatibility, and Web Purchases;
- Email, Identity, Files, Observability, all seven domain Workers, and both
  checked-in custom Worker implementations;
- the target-deployed MCP Worker and its shared local/plugin implementation;
- the unified dashboard;
- Flutter, FlutterFlow, and FlutterFlow Messaging.

Worker validation uses Wrangler deployment dry runs. A dry run builds and validates the bundle without uploading a Worker, applying a migration, changing a Queue consumer, or publishing a route.

Every maintained SDK family is part of the automatic matrix. JavaScript changes
run a clean install and Webpack build. React Native changes run an immutable
Yarn install, typecheck, 65 tests and the complete Bob/codegen package build.
iOS changes run the simulator test script on `macos-latest`; Android changes
install the pinned API 35/Build Tools 34 components and run the library unit
tests. MCP source changes select the Worker matrix and run the Worker tests,
shared MCP application suite, typechecks, build, lint, both dependency audits,
standalone Docker build and Wrangler dry run. Flutter SDK changes still validate
both the Flutter package and its FlutterFlow consumer.

Manual workflow dispatch runs the complete supported matrix. Use it only when a complete validation is intentionally required. Concurrency cancellation stops an obsolete run when a newer commit arrives on the same branch or pull request.

The SDK catalogue is validated in the planning job even when no SDK build is
selected. Immutable package tags are created only by the separate
`Prepare immutable SDK release` workflow, protected by the `sdk-release`
GitHub Environment. The tag-driven release workflow validates that the source
version and tag are identical before publishing. It then proposes the released
catalogue state through a PR; it never pushes through branch protection. Once
the complete FlutterFlow/Support set is merged into `dev`, a separate workflow
verifies all tags and GitHub releases before dispatching one protected PR to
`opengrow-reference`.

Release concurrency is isolated by immutable tag. Publishing several different
SDKs therefore cannot cancel queued releases, while a repeated event for the
same tag cannot overtake its own publication. During a repository bootstrap,
create at most three tags per Git push because GitHub does not emit tag events
for larger batches; the normal preparation workflow creates one reviewed tag at
a time and is not affected by this platform limit.

The preparation workflow explicitly dispatches the publication workflow after
creating the tag. GitHub deliberately suppresses ordinary push-triggered
workflows for refs created with `GITHUB_TOKEN`; `workflow_dispatch` is the
supported non-recursive exception. Publication checks out the requested tag,
proves its dereferenced commit belongs to official `dev`, and passes that exact
tag and SHA to every test, package, release and catalogue-promotion step. A
catalogue PR created by automation is validated through an explicit CI dispatch
on its protected promotion branch for the same reason.

Moving the canonical source repository never authorizes reusing a published
package version for changed bytes. The catalogue keeps the historical release
reference installable while the changed source is marked `pending-release` with
the next semantic version. This applies equally to SwiftPM tags, Maven
coordinates and npm packages, even when the former repository remains public.

Both repositories keep the default `GITHUB_TOKEN` permission at read-only.
Their declared workflow policy enables GitHub Actions to create PRs only so the
two promotion workflows can request `contents: write` and
`pull-requests: write` explicitly. No workflow approves or merges its own PR;
the required human review and `CI gate`/`Reference gate` remain authoritative.

The reusable FlutterFlow project has a separate protected Environment named
`flutterflow-library`. Its non-secret project identifier is the Environment
variable `FF_LIBRARY_PROJECT_ID`; its API credential is the encrypted secret
`FF_API_KEY`. Both names and the known non-secret project ID are governed by
`config/github-control-plane.json`. After the required SDK tag workflows
succeed, `sync-flutterflow-library.yml` derives every release ref from
`config/flutterflow-library.json`, tests the Git-owned DSL and updates the
remote `OpenGrow` project. It never accepts a branch ref or repository token.

Run the same supported validation locally with:

```bash
npm run test:all
```

The local command includes Flutter Purchases, FlutterFlow Purchases, FlutterFlow
Support, JavaScript, React Native and the complete Chatwoot migration tool suite.
A financial, support-migration or portable-SDK regression therefore cannot be
hidden by a green Worker or dashboard test. Native iOS/Android checks remain
automatic on correctly provisioned hosted runners because they require platform
SDKs that may not exist on every developer machine.

## Dependency updates

Dependabot groups compatible minor and patch updates. It watches the root Node workspace and the Flutter and FlutterFlow packages used by the application. FlutterFlow Messaging checks monthly. Standalone Swift and Android SDK dependency updates are not scheduled automatically.

Every external GitHub Action is pinned to a full immutable commit SHA; the
human-readable major version remains beside the SHA so Dependabot can propose
reviewable updates. The workflow token defaults to read-only and write access is
granted only to the isolated jobs that create a tag, package, release or
promotion PR. `npm run secrets:scan` scans both Git history and the complete
working tree. Client configuration such as `OPENGROW_PROJECT_KEY` is injected
from the protected application environment and is never written to a Git-owned
FlutterFlow manifest or generated Dart source.

## Cloudflare deployment

The dedicated deployment workflow reads
`config/cloudflare-deployments.json`. `dev` currently selects the protected
`development` GitHub Environment and `main` selects `production`, but a branch
may select several Environments. Every matrix entry supplies its own target name,
Cloudflare environment, account ID and least-privilege API token, so the same
validated Git commit can deploy several applications to different Cloudflare
accounts without copying or editing the workflow.

Immediately before upload, the workflow regenerates and compares every
Cloudflare binding type, reads only the configured Cloudflare secret names for
each enabled Worker, and fails if the target-specific required contract is
incomplete. Secret values are never downloaded or printed. Run the same
read-only check manually with:

```bash
npm run cloudflare:secrets:check -- \
  --target <target> --environment <environment>
```

The workflow is the only automatic deployment authority. It provisions nothing
implicitly: resource creation remains an explicit bootstrap operation whose
resolved non-secret IDs are reviewed in the target manifest. On deployment it
applies tracked D1 migrations, deploys every enabled Worker in dependency order,
and publishes the dashboard last. A production rollout exports every enabled D1
before the first migration, verifies the complete migration batch and its
digest, then starts deploying Workers. The workflow encrypts complete or
recoverable failure artifacts with the protected Environment key before
retention. GitHub Environment reviewers and branch protection are the release
approval boundary.

Pull-request CI remains read-only: Wrangler dry runs do not upload Workers,
apply migrations, change Queues or publish routes.

Before a Billing cutover, run:

```bash
npm run cloudflare:billing-preflight
```

The preflight is read-only and blocks on pending migrations, incorrect main-queue or DLQ ownership, financial failures or stale work, incomplete Worker readiness, invalid public signing keys, or missing secret names. Follow [Billing Worker controlled cutover](./BILLING_WORKER_CUTOVER.md) for the separately authorized mutation procedure.

## Usage budget behavior

When the GitHub Actions spending budget is zero after included minutes are exhausted, GitHub creates failed jobs with no executed steps. That state is an account billing block, not a test failure. Reducing the matrix prevents unnecessary future usage, but it cannot restart blocked jobs until the allowance resets or the account budget changes.
