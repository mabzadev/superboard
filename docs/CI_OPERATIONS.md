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
version and tag are identical, then pauses at the `authorize-publication` job
in the same Environment before any selected Flutter, iOS, Android or npm job
can publish. The approval is therefore bound to the validated immutable tag and
SHA, not only to the later catalogue proposal. The workflow then proposes the
released catalogue state through a PR; it never pushes through branch
protection. Once
the complete FlutterFlow/Support set is merged into `dev`, a separate workflow
verifies all tags and GitHub releases before opening one protected PR for
`apps/reference` in `mabzadev/superboard`.

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
The catalogue-promotion job also uses an explicit `always()` guard: each SDK
release deliberately skips every non-selected package job, and GitHub would
otherwise suppress the downstream promotion despite the successful aggregate
release gate.

Moving the canonical source repository never authorizes reusing a published
package version for changed bytes. The catalogue keeps the historical release
reference installable while the changed source is marked `pending-release` with
the next semantic version. This applies equally to SwiftPM tags, Maven
coordinates and npm packages, even when the former repository remains public.

The canonical repository keeps the default `GITHUB_TOKEN` permission at
read-only. Its declared workflow policy enables GitHub Actions to create PRs
only so the promotion workflows can request `contents: write` and
`pull-requests: write` explicitly. No workflow approves or merges its own PR;
the required human review and `CI gate`/`Reference gate` remain authoritative.

## GitHub Environment hardening lifecycle

`config/github-control-plane.json` is also the source of truth for managed
Environment protections. Each managed Environment declares the eligible
reviewer identities, minimum eligible reviewer count, self-review policy, wait
timer, administrator-bypass policy, and the exact branch/tag deployment
patterns. `github:readiness:remote` compares every field without requesting a
secret value. `github:reconcile` can plan the documented Environment REST
updates and missing branch/tag policies, but never deletes an unexpected remote
policy automatically. The administrator-bypass switch remains an explicit
manual operation because GitHub's documented Environment update payload does
not expose that switch.

Protection intent initially uses `enforcement: pending-external`. In that
state, readiness is deliberately incomplete and reconciliation emits an
`activate-environment-protection` manual action without generating a protection
mutation. This prevents a control-plane PR from unexpectedly pausing existing
publication or deployment runs. Activation requires a separate reviewed change
to `enforcement: enforced` after every pending reason has been resolved.

The current activation contract is:

- `development`: branch `dev` only, no reviewer and no wait timer, preserving
  automatic development deployment after the successful aggregate CI gate;
- `production`: branch `main` only, five-minute wait, self-review prevented and
  administrator bypass disabled;
- `sdk-release`: branch `dev` plus the seven declared `sdk-*-v*` tag families,
  self-review prevented and administrator bypass disabled.

`production` and `sdk-release` require at least two eligible human identities.
GitHub needs only one approval, but `preventSelfReview` guarantees that the
approver is not the run initiator. The repository currently declares only
`mabzadev`; therefore those protections stay `pending-external` until a second
trusted human has repository read access and is added by stable GitHub user ID.
Do not weaken `minimumEligibleReviewers` or temporarily enable administrator
bypass to work around that prerequisite.

Branch and tag policies are installed only after the Environment has been
switched to custom deployment policies. Perform activation with no pending jobs
because GitHub rejects policy creation before that switch and an empty custom
policy set blocks every ref. Re-read the Environment after application and
verify the exact policy set before starting the next release or deployment.

The reusable FlutterFlow project has a separate protected Environment named
`flutterflow-library`. Its non-secret project identifier is the Environment
variable `FF_LIBRARY_PROJECT_ID`; its API credential is the encrypted secret
`FF_API_KEY`. Both names and the known non-secret project ID are governed by
`config/github-control-plane.json`. After the required SDK tag workflows
succeed, `sync-flutterflow-library.yml` derives every release ref from
`config/flutterflow-library.json`, tests the Git-owned DSL and updates the
remote `SuperBoard` project. It never accepts a branch ref or repository token.

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
working tree. Client configuration such as `SUPERBOARD_PROJECT_KEY` is injected
from the protected application environment and is never written to a Git-owned
FlutterFlow manifest or generated Dart source.

## Cloudflare deployment

The versioned deployment contract is
`config/cloudflare-deployments.json`. `dev` selects `mbza-development` and
declares Cloudflare Workers Builds as its authority; `main` selects
`vocostar-production` and declares GitHub Actions. The production workflow asks
the matrix selector only for `github-actions` entries, and is triggered only for
`main`, so it can neither require a development API token nor duplicate a native
MBZA deployment.
The target name is committed in the matrix and must exactly match the
`SUPERBOARD_TARGET` variable of the selected GitHub Environment. This redundant
selection is intentional: a mutable Environment variable cannot redirect an
approved revision to another target or account boundary.

Immediately before upload, the workflow regenerates and compares every
Cloudflare binding type, reads only the configured Cloudflare secret names for
each enabled Worker, and fails if the target-specific required contract is
incomplete. Secret values are never downloaded or printed. Run the same
read-only check manually with:

```bash
npm run cloudflare:secrets:check -- \
  --target <target> --environment <environment>
```

Each target has exactly one automatic deployment authority. The production
workflow provisions nothing implicitly: resource creation remains an explicit bootstrap operation whose
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
