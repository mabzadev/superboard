# SuperBoard

Public canonical monorepo for the SuperBoard platform and SDKs. The repository is
the only source of truth; Cloudflare targets are isolated by declarative manifests
and never fork this code.

- Canonical repository: <https://github.com/mabzadev/superboard>
- Archived-repository record: [`docs/LEGACY_REPOSITORIES.md`](docs/LEGACY_REPOSITORIES.md)
- FlutterFlow reference application: [`apps/reference`](apps/reference)
- Development reference app: <https://reference.mbza.dev>
- Development dashboard: <https://board.mbza.dev>
- Development API: <https://api.mbza.dev>
- Development short links: <https://in.mbza.dev>
- Development MCP: <https://mcp.mbza.dev/mcp>
- Development mail preview: <https://mail.mbza.dev>

## Integrated EmDash foundation

This repository contains the complete EmDash 0.35.0 source at commit
`1717d31b351164a5f78e95fe004ee582c7c50f40` from
[`emdash-cms/emdash`](https://github.com/emdash-cms/emdash.git). The non-squashed merge keeps the
upstream history, and
`config/emdash-integration.json` pins the imported commit and deterministic
root overlay.

The historical Next/OpenNext Dashboard remains available while the Release Front
parity, migration receipts, development rehearsal, production cutover, and
observation required by [issue #33](https://github.com/mabzadev/superboard/issues/33)
are incomplete. It is not the target Front SuperBoard. The audited integration
details are in
[`docs/EMDASH_UPSTREAM_1717D31_INTEGRATION_2026-08-29.md`](docs/EMDASH_UPSTREAM_1717D31_INTEGRATION_2026-08-29.md).

The first executable target slice lives in `apps/site`. It mounts the native
EmDash Admin, a generic fail-closed Front runtime, the closed Release Front
contract, D1 activation receipts, and a Last Verified Release cache that never
becomes activation authority. Release operations are disabled by default.

Use the integrated pnpm gates from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm emdash:typecheck
pnpm emdash:test
pnpm site:check
pnpm support:check
pnpm flows:check
```

## Layout

| Path                         | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `apps/dashboard`             | SuperBoard back-office deployed with OpenNext on Workers              |
| `apps/reference`             | Executable Flutter/FlutterFlow reference application and its tests    |
| `workers/api`                | Hono API, OAuth, short links, purchases and queues                    |
| `workers/mcp`                | Target-deployed stateless MCP Worker with a private API binding       |
| `apps/mcp`                   | Local MCP adapter, reusable tool catalogue and editor plugin          |
| `sdks/flutter`               | Active `superboard_flutter` 3.x SDK                                   |
| `sdks/flutterflow`           | Active unified `superboard_flutterflow` 3.x library                   |
| `sdks/flutterflow_messaging` | Archived 1.3 compatibility package; merged into FlutterFlow 3.x       |
| `sdks/ios`                   | Internal native implementation embedded by the Flutter SDK            |
| `sdks/android`               | Internal native implementation embedded by the Flutter SDK            |
| `sdks/javascript`            | Archived historical JavaScript package                                |
| `sdks/react-native`          | Archived historical React Native package                              |
| `packages/shared`            | Shared utilities                                                      |
| `deploy/targets`             | Non-secret target manifests and physical-resource migration contracts |

The root `Package.swift` exposes the iOS SDK directly from `sdks/ios`.

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm run test:all
pnpm run platform:readiness
```

To include a reviewed external FlutterFlow client in the fail-closed readiness
report without committing its source, provide its absolute path by application:

```bash
pnpm run platform:readiness -- \
  --client-sources 'vocostar=/absolute/path/to/app-vocostar-ff'

SUPERBOARD_CLIENT_SOURCE_VOCOSTAR=/absolute/path/to/app-vocostar-ff \
  pnpm run flutterflow:source:verify:vocostar

SUPERBOARD_CLIENT_SOURCE_VOCOSTAR=/absolute/path/to/app-vocostar-ff \
  pnpm run flutterflow:migration:plan:vocostar
```

`test:all` includes every Worker, the Dashboard, MCP, Flutter/FlutterFlow,
JavaScript, React Native and the internal Support audit tools. Affected iOS and
Android changes are tested on their provisioned GitHub runners. The readiness
report is read-only and lists unresolved resource IDs, Git state, pending SDK
releases and credential names without ever returning secret values. Add
`--remote` for GitHub inspection or `--strict` to make incomplete operational
prerequisites fail with exit code 2.

The application migration plan groups every authenticated FlutterFlow
convergence gate into ordered work items, verifies all replacement symbols
against the public SDK catalogue and is embedded in the same readiness report.

The GitHub control plane is also fail-closed. The canonical repository contains
the platform, back-office, Workers, SDKs and reference application. The former
`superboard-platform` and `superboard-reference` repositories are archived,
read-only migration sources. Their immutable tags, releases and package
coordinates remain available, but all code, issues, releases and Cloudflare Git
connections now belong to `mabzadev/superboard`;
`pnpm run github:history:plan -- --fetch` verifies both canonical remotes,
detects unrelated or divergent histories and derives exact audit refs without
committing or pushing;
`pnpm run github:history:bridge:plan` fails closed once published `main` and
`dev` have no merge base and emits the exact non-mutating two-parent bridge
procedure documented in
[`docs/GIT_HISTORY_BRIDGE.md`](docs/GIT_HISTORY_BRIDGE.md);
`pnpm run github:reconcile` separately plans repository-setting drift, branch
protection, Environments and non-secret variables. Both mutation modes require
their own schema-versioned exact confirmation, and neither command commits,
pushes or uploads secret values.

## Cloudflare targets

`deploy/targets/<target>.json` selects an Instance's features, Workers, domains,
and physical resources. The target compiler joins that manifest with the plugin
topology, migrations, bindings, routes, secret contracts, and health checks.
Its `environments` entries materialize the same logical graph for local and
Cloudflare execution. Separate Instances use separate targets and may live in
different Cloudflare accounts. The account is selected at runtime with a scoped
environment variable derived from `accountAlias`, with
`CLOUDFLARE_ACCOUNT_ID` as a CI-friendly fallback.

`pnpm target:orchestrate` compiles the selected target before every lifecycle
operation. The compiler compares the logical graph checksum across available
environments and stops when their plugins, bindings, resources, migrations,
routes, secrets, or health checks differ.
The automated ownership rules are documented in
[`docs/CONFIGURATION_BOUNDARIES.md`](docs/CONFIGURATION_BOUNDARIES.md) and can
be audited offline with `pnpm run configuration:check`.
Use the [Site local validation guide](apps/site/README.md#local-validation) to
configure, migrate, and start the complete local graph.

The following command displays the local lifecycle plan:

```bash
pnpm target:orchestrate plan --target mbza-development --environment local --adapter local
```

The following command compares the complete remote inventory with the compiled
development artifact:

```bash
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  pnpm target:orchestrate provision \
  --target mbza-development --environment development --adapter cloudflare --remote
```

Apply the unchanged plan with the exact confirmation emitted by the preceding
command:

```bash
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  pnpm target:orchestrate provision \
  --target mbza-development --environment development --adapter cloudflare \
  --remote --apply \
  --confirm "CLOUDFLARE:BOOTSTRAP:mbza-development:development:<plan-digest>"
```

The following command generates, migrates, and deploys the API Worker:

```bash
pnpm target:orchestrate deploy --target mbza-development \
  --environment development --adapter cloudflare --service api
```

Google/Apple audiences, web origins and numeric Support project IDs can be
planned and updated without editing a Worker or hardcoding an application:

```bash
pnpm run target:configure-application -- \
  --target mbza-development --environment development \
  --google-audiences <public-google-client-id> \
  --apple-audiences <public-apple-service-id> \
  --support-project-ids <numeric-project-id>
```

The plan is read-only. Applying it requires repeating the options with
`--apply --confirm <exact-confirmation>`. Credential values remain exclusively
in Cloudflare secret contracts and are never accepted by this command.

Normal `dev` and `main` releases use the protected GitHub workflow; direct
deploy commands are retained for an explicitly authorized operator recovery or
bootstrap session.

For production the deploy command requires an absolute protected backup
directory. It exports every service-owned D1 before the first migration,
verifies the complete database batch and its SHA-256-scoped receipt, then begins
the Worker rollout. Complete or recoverable failure artifacts are encrypted
before retention. Generated Wrangler files are ignored; production backups are
never written into Git:

```bash
pnpm run cloudflare:deploy:all -- \
  --target vocostar --environment production \
  --backup-directory /secure/superboard/d1
```

Runtime secrets are provisioned by logical contract. The first command is a
value-free plan. During an authorized operation, the approved secret manager
must emit the exact JSON payload on stdout and pipe it directly to the second
command; the checkout never receives a secret file:

```bash
pnpm run cloudflare:secrets:upload -- \
  --target vocostar --environment production --contracts api-jwt-secret

<approved-secret-manager-export> | pnpm run cloudflare:secrets:upload -- \
  --target vocostar --environment production --contracts api-jwt-secret \
  --apply --confirm CLOUDFLARE:SECRET-BUNDLE:<target>:<environment>:<digest>
```

The compatibility command `cloudflare:set-secret` is deliberately non-mutating:
it maps an old service/name request to its owning contract and exits. It never
reads stdin and cannot call the immediately activating `wrangler secret put`.
The bundle uploader returns a value-free receipt for
`cloudflare:secrets:promote`; promotion rechecks exact version tags and captures
rollback version IDs before any traffic change. Shared internal tokens use
`--overlap`: accepting Workers receive both the new value and an optional
`*_PREVIOUS` value, are promoted before new-token-only producers, and therefore
rotate without a maintenance outage. The promotion receipt is then passed to
`cloudflare:secrets:retire` after at least thirty minutes; retirement verifies
the exact account and active versions before removing only the previous
bindings, with automatic rollback on failure. The overlap-capable runtime must
be deployed once with the current token unchanged before the first rotation;
non-overlap shared promotion is limited to a private, traffic-free bootstrap or
an explicitly approved maintenance window.

OAuth rotation is planned before mutation and requires migration 0056. The
command uploads a tagged inactive Dashboard version, moves the current D1
verifier into a bounded overlap slot, activates that exact version, and restores
the previous verifier if activation fails. No clear client secret is written to
disk or printed.

```bash
pnpm run cloudflare:rotate-oauth -- --target mbza-development --environment development

pnpm run cloudflare:rotate-oauth -- \
  --target mbza-development --environment development \
  --apply --confirm CLOUDFLARE:OAUTH-ROTATE:<target>:<environment>:<digest>
```

See `docs/CLOUDFLARE.md` for the GitHub-controlled Cloudflare rollout.
The production hostname gate and its snapshot-bound FlutterFlow client receipt
are documented in `docs/PUBLIC_ROUTING_CUTOVER.md`.
The target topology, development procedure and exhaustive FlutterFlow/data
inventory are documented in `docs/ARCHITECTURE_CIBLE_FR.md`,
`docs/REFERENCE_ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md` and
`docs/REFERENCE_DATA_INVENTORY.md`.
The last VocoStar FlutterFlow mapping is in
`docs/VOCOSTAR_FLUTTERFLOW_CONVERGENCE.md`; the evidence-backed implementation
and external-readiness status is in `docs/IMPLEMENTATION_AUDIT_2026-08-08.md`.
The pinned Support behavior inventory and its publication-leak gate are kept in
the build-excluded `scripts/support-audit` workspace.
The value-free cross-Worker secret graph, production provenance rules and
rotation protocol are in `docs/SECRET_MANAGEMENT.md`.

## SDK releases

`config/sdk-libraries.json` is the canonical, machine-validated SDK catalogue.
It records each package path, source version, latest immutable release, install
snippet when one really exists, package-local MIT licence and whether the
current source is `released`, `pending-release` or still `unreleased`. An
unreleased entry cannot declare a release ref, release SHA or installation
command. The Dashboard exposes the same read-only catalogue and licence links at
`/app/libraries`; it never rewrites Git.

- `pnpm run sdk:catalog:check` verifies source versions, tags and the complete
  FlutterFlow public-code surface.
- `pnpm run sdk:documentation:check` proves that every canonical installation
  section uses the catalogue's published coordinate, immutable ref and version;
  `pnpm run sdk:documentation:write` refreshes those bounded sections after a
  protected catalogue promotion.
- `.github/workflows/prepare-sdk-release.yml` is the reviewed manual authority
  that creates a new immutable tag from a release-ready catalogue entry.
- `.github/workflows/release-sdk.yml` validates that tag again before testing
  and binds an `sdk-release` Environment approval to its exact tag and SHA
  before publishing the selected package, then opens a protected catalogue PR.
- `.github/workflows/promote-reference-sdk.yml` waits until the complete
  FlutterFlow and Support set is published, verifies every official tag and
  GitHub release, then dispatches one atomic set promotion to the reference
  repository. The reference opens its own protected dependency PR.
- iOS additionally receives the root SemVer alias recorded in `releaseRef`, as
  required by Swift Package Manager; all other SDKs use their namespaced tag.
- FlutterFlow consumes the public repository by immutable `ref` and package
  `path`; no repository read token is required or stored in exported source.

`tools/flutterflow-library` is the Git authority for the reusable FlutterFlow
project named `SuperBoard`. `config/flutterflow-library.json` inventories its 11
target-supplied Library Values and 64 custom actions. Run
`pnpm run flutterflow-library:check` to prove that its DSL, public HTTPS
dependencies, immutable refs, token-state policy and GitHub sync workflow stay
aligned. Published status and the immutable dependency ref come only from the
SDK catalogue; reference promotion refuses any pending entry. The protected
`sync-flutterflow-library.yml` workflow initializes the workspace from the
`FF_LIBRARY_PROJECT_ID` variable, tests the DSL, then updates the remote project
with `FF_API_KEY`; neither value is hardcoded in Git. Remote synchronization
remains intentionally gated until that encrypted Environment secret is
installed.

The migration provenance and source SHAs are documented in
`docs/HISTORY_MIGRATION.md`.

## License

SuperBoard is released under the [MIT License](./LICENSE).

Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues through the private process documented in [SECURITY.md](./SECURITY.md).
