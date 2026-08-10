# OpenGrow

Public canonical monorepo for the OpenGrow platform and SDKs. The repository is
the only source of truth; Cloudflare targets are isolated by declarative manifests
and never fork this code.

- Platform repository: <https://github.com/mbzadev/opengrow-platform>
- FlutterFlow reference application: <https://github.com/mbzadev/opengrow-reference>
- Development reference app: <https://reference.mbza.dev>
- Development dashboard: <https://grow.mbza.dev>
- Development API: <https://api.mbza.dev>
- Development short links: <https://in.mbza.dev>
- Development MCP: <https://mcp.mbza.dev/mcp>
- Development mail preview: <https://mail.mbza.dev>

## Layout

| Path                | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `apps/dashboard`    | Next.js dashboard deployed with OpenNext on Workers             |
| `workers/api`       | Hono API, OAuth, short links, purchases and queues              |
| `workers/mcp`       | Target-deployed stateless MCP Worker with a private API binding |
| `apps/mcp`          | Local MCP adapter, reusable tool catalogue and editor plugin    |
| `sdks/flutter`      | `opengrow_flutter`                                              |
| `sdks/flutterflow`  | `opengrow_flutterflow` actions and paywall                      |
| `sdks/ios`          | OpenGrow iOS SDK implementation                                 |
| `sdks/android`      | `io.opengrow:opengrow-android`                                  |
| `sdks/javascript`   | `@mbzadev/opengrow-js`                                          |
| `sdks/react-native` | `@mbzadev/opengrow-react-native`                                |
| `packages/shared`   | Shared utilities                                                |
| `deploy/targets`    | Non-secret target manifests and schema                          |

The root `Package.swift` exposes the iOS SDK directly from `sdks/ios`.

## Local validation

```bash
npm ci
npm run test:all
npm run platform:readiness
```

To include a reviewed external FlutterFlow client in the fail-closed readiness
report without committing its source, provide its absolute path by application:

```bash
npm run platform:readiness -- \
  --client-sources 'vocostar=/absolute/path/to/app-vocostar-ff'

OPENGROW_CLIENT_SOURCE_VOCOSTAR=/absolute/path/to/app-vocostar-ff \
  npm run flutterflow:source:verify:vocostar

OPENGROW_CLIENT_SOURCE_VOCOSTAR=/absolute/path/to/app-vocostar-ff \
  npm run flutterflow:migration:plan:vocostar
```

`test:all` includes every Worker, the Dashboard, MCP, Flutter/FlutterFlow,
JavaScript, React Native and the Chatwoot migration tools. Affected iOS and
Android changes are tested on their provisioned GitHub runners. The readiness
report is read-only and lists unresolved resource IDs, Git state, pending SDK
releases and credential names without ever returning secret values. Add
`--remote` for GitHub inspection or `--strict` to make incomplete operational
prerequisites fail with exit code 2.

The application migration plan groups every authenticated FlutterFlow
convergence gate into ordered work items, verifies all replacement symbols
against the public SDK catalogue and is embedded in the same readiness report.

The GitHub control plane is also fail-closed. `npm run github:bootstrap` plans
creation of the two declared repositories with their exact public/private
visibility without changing GitHub;
`npm run github:history:plan -- --fetch` verifies both canonical remotes,
detects unrelated or divergent histories and derives exact audit refs without
committing or pushing;
`npm run github:reconcile` separately plans repository-setting drift, branch
protection, Environments and non-secret variables. Both mutation modes require
their own schema-versioned exact confirmation, and neither command commits,
pushes or uploads secret values.

## Cloudflare targets

`deploy/targets/<target>.json` contains non-secret names, domains and resource
identifiers, but never credentials or Cloudflare account IDs. Development and
production are separate targets and may live in different Cloudflare accounts.
The account is selected at runtime with a scoped environment variable derived
from `accountAlias`, with `CLOUDFLARE_ACCOUNT_ID` as a CI-friendly fallback.

```bash
# Validate the OpenGrow development target (no remote write)
npm run cloudflare:bootstrap -- --target mbza-development --environment development

# Compare the complete paginated remote inventory with a target-scoped token
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  npm run cloudflare:bootstrap -- \
  --target mbza-development --environment development --remote

# Apply only the unchanged reviewed plan and its emitted exact confirmation
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  npm run cloudflare:bootstrap -- \
  --target mbza-development --environment development --apply \
  --confirm "CLOUDFLARE:BOOTSTRAP:mbza-development:development:<plan-digest>"

# Generate and deploy
npm run cloudflare:deploy -- --target mbza-development --service api --environment development
npm run cloudflare:deploy -- --target mbza-development --service mcp --environment development
npm run cloudflare:deploy -- --target mbza-development --service dashboard --environment development
```

Google/Apple audiences, web origins and numeric Support project IDs can be
planned and updated without editing a Worker or hardcoding an application:

```bash
npm run target:configure-application -- \
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
npm run cloudflare:deploy:all -- \
  --target vocostar --environment production \
  --backup-directory /secure/opengrow/d1
```

Runtime secrets are provisioned by logical contract. The first command is a
value-free plan. During an authorized operation, the approved secret manager
must emit the exact JSON payload on stdout and pipe it directly to the second
command; the checkout never receives a secret file:

```bash
npm run cloudflare:secrets:upload -- \
  --target vocostar --environment production --contracts api-jwt-secret

<approved-secret-manager-export> | npm run cloudflare:secrets:upload -- \
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
npm run cloudflare:rotate-oauth -- --target mbza-development --environment development

npm run cloudflare:rotate-oauth -- \
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
The live OpenChat inventory, duplicate-feature decision and guarded Support
retirement plan are in `docs/OPENCHAT_SUPPORT_CONVERGENCE.md`.
The value-free cross-Worker secret graph, production provenance rules and
rotation protocol are in `docs/SECRET_MANAGEMENT.md`.

## SDK releases

`config/sdk-libraries.json` is the canonical, machine-validated SDK catalogue.
It records each package path, source version, latest immutable release, install
snippet, package-local MIT licence and whether the current source still needs a
release. The Dashboard exposes the same read-only catalogue and licence links at
`/app/libraries`; it never rewrites Git.

- `npm run sdk:catalog:check` verifies source versions, tags and the complete
  FlutterFlow public-code surface.
- `.github/workflows/prepare-sdk-release.yml` is the reviewed manual authority
  that creates a new immutable tag from a release-ready catalogue entry.
- `.github/workflows/release-sdk.yml` validates that tag again before testing
  and publishing the selected package, then opens a protected catalogue PR.
- `.github/workflows/promote-reference-sdk.yml` waits until the complete
  FlutterFlow and Support set is published, verifies every official tag and
  GitHub release, then dispatches one atomic set promotion to the reference
  repository. The reference opens its own protected dependency PR.
- iOS additionally receives the root SemVer alias recorded in `releaseRef`, as
  required by Swift Package Manager; all other SDKs use their namespaced tag.
- FlutterFlow consumes the public repository by immutable `ref` and package
  `path`; no repository read token is required or stored in exported source.

`tools/flutterflow-library` is the Git authority for the reusable FlutterFlow
project named `OpenGrow`. `config/flutterflow-library.json` inventories its 11
target-supplied Library Values and 64 custom actions. Run
`npm run flutterflow-library:check` to prove that its DSL, public HTTPS
dependencies, immutable refs, token-state policy and GitHub sync workflow stay
aligned. Both reviewed FlutterFlow SDK tags are now published and the reference
application pins them immutably. The protected `sync-flutterflow-library.yml`
workflow initializes the workspace from the `FF_LIBRARY_PROJECT_ID` variable,
tests the DSL, then updates the remote project with `FF_API_KEY`; neither value
is hardcoded in Git. Remote synchronization remains intentionally gated until
that encrypted Environment secret is installed.

The migration provenance and source SHAs are documented in
`docs/HISTORY_MIGRATION.md`.

## License

OpenGrow is released under the [MIT License](./LICENSE).

Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues through the private process documented in [SECURITY.md](./SECURITY.md).
