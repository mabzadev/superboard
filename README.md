# SuperBoard

Public canonical monorepo for the SuperBoard platform and SDKs. The repository is
the only source of truth; Cloudflare targets are isolated by declarative manifests
and never fork this code.

- Canonical repository: <https://github.com/mabzadev/superboard>
- Archived-repository record: [`docs/LEGACY_REPOSITORIES.md`](docs/LEGACY_REPOSITORIES.md)
- FlutterFlow reference application: [`apps/reference`](apps/reference)
- Development reference app: <https://reference.mbza.dev>
- Development Front: <https://board.mbza.dev>
- Development API: <https://api.mbza.dev>
- Development short links: <https://in.mbza.dev>
- Development MCP: <https://mcp.mbza.dev/mcp>
- Development mail preview: <https://mail.mbza.dev>

## Integrated EmDash foundation

This repository integrates EmDash 0.35.0 from commit
`1717d31b351164a5f78e95fe004ee582c7c50f40` from
[`emdash-cms/emdash`](https://github.com/emdash-cms/emdash.git).
`scripts/config/emdash-integration.json` records the imported revision and the root
overlay used by the integrated repository.

The operator Front runs in `apps/site`. EmDash supplies operator sessions,
the administration interface and the publication of active plugin views.
The plugins own their React components, business commands and Worker runtimes.
`packages/supbrd-front-ui` contains their shared presentation components.

Plugin activation publishes a verified Front Release and preserves plugin data
when its views are disabled. The historical route and menu inventory is retained
in `scripts/config/superboard-plugin-independence-baseline.json`.

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

| Path                | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `apps/`             | Executable applications, including the Site and reference client                  |
| `packages/`         | EmDash foundation and shared libraries                                            |
| `packages/plugins/` | Plugins, their Front sources and their service packages                           |
| `sdks/`             | Client libraries; lifecycle and versions are recorded in the SDK catalogue        |
| `scripts/config/`   | Global configuration and its validation schemas                                   |
| `infra/targets/`    | Deployment target manifests                                                       |
| `infra/generated/`  | Generated deployment output                                                       |
| `scripts/`          | Commands grouped by usage; see [the scripts guide](scripts/README.md)             |
| `tests/`            | E2E journeys, fixtures, linters and checks; see [the test guide](tests/README.md) |

The root `Package.swift` exposes the iOS SDK from `sdks/ios`.
See [the monorepo guide](docs/MONOREPO.md) for the remaining EmDash directories,
plugin ownership and local development commands.

## Local validation

```bash
pnpm install --frozen-lockfile
pnpm run test:all
pnpm run platform:readiness
```

Application-specific source and deployment targets belong in their own workspaces.

`test:all` includes every Worker, the EmDash Site and its plugins, MCP, Flutter/FlutterFlow,
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

`infra/targets/<target>.json` contains non-secret names, domains and resource
identifiers, but never credentials or Cloudflare account IDs. Development and
production are separate targets and may live in different Cloudflare accounts.
The account is selected at runtime with a scoped environment variable derived
from `accountAlias`, with `CLOUDFLARE_ACCOUNT_ID` as a CI-friendly fallback.
The automated ownership rules are documented in
[`docs/CONFIGURATION_BOUNDARIES.md`](docs/CONFIGURATION_BOUNDARIES.md) and can
be audited offline with `pnpm run configuration:check`.

```bash
# Validate the SuperBoard development target (no remote write)
pnpm run cloudflare:bootstrap -- --target mbza-development --environment development

# Compare the complete paginated remote inventory with a target-scoped token
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  pnpm run cloudflare:bootstrap -- \
  --target mbza-development --environment development --remote

# Apply only the unchanged reviewed plan and its emitted exact confirmation
CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT=... CLOUDFLARE_API_TOKEN=... \
  pnpm run cloudflare:bootstrap -- \
  --target mbza-development --environment development --apply \
  --confirm "CLOUDFLARE:BOOTSTRAP:mbza-development:development:<plan-digest>"

# Generate and deploy
pnpm run cloudflare:deploy -- --target mbza-development --service api --environment development
pnpm run cloudflare:deploy -- --target mbza-development --service mcp --environment development
pnpm run cloudflare:deploy -- --target mbza-development --service site --environment development
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
  --target mbza-development --environment development \
  --backup-directory /secure/superboard/d1
```

Runtime secrets are provisioned by logical contract. The first command is a
value-free plan. During an authorized operation, the approved secret manager
must emit the exact JSON payload on stdout and pipe it directly to the second
command; the checkout never receives a secret file:

```bash
pnpm run cloudflare:secrets:upload -- \
  --target mbza-development --environment development --contracts api-jwt-secret

<approved-secret-manager-export> | pnpm run cloudflare:secrets:upload -- \
  --target mbza-development --environment development --contracts api-jwt-secret \
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

See `docs/CLOUDFLARE.md` for the GitHub-controlled Cloudflare rollout.
The production hostname gate and its snapshot-bound FlutterFlow client receipt
are documented in `docs/PUBLIC_ROUTING_CUTOVER.md`.
The target topology, development procedure and exhaustive FlutterFlow/data
inventory are documented in `docs/ARCHITECTURE_CIBLE_FR.md`,
`docs/REFERENCE_ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md` and
`docs/REFERENCE_DATA_INVENTORY.md`.
The evidence-backed implementation
and external-readiness status is in `docs/IMPLEMENTATION_AUDIT_2026-08-08.md`.
The pinned Support behavior inventory and its publication-leak gate are kept in
the build-excluded `packages/plugins/superboard-support/scripts/support-audit` workspace.
The value-free cross-Worker secret graph, production provenance rules and
rotation protocol are in `docs/SECRET_MANAGEMENT.md`.

## SDKs

The four application SDKs are:

| SDK         | Source             | Use                                                       |
| ----------- | ------------------ | --------------------------------------------------------- |
| Flutter     | `sdks/flutter`     | Flutter applications                                      |
| FlutterFlow | `sdks/flutterflow` | FlutterFlow actions and widgets built on Flutter          |
| Web         | `sdks/web`         | JavaScript and TypeScript browser applications            |
| Tauri       | `sdks/tauri`       | Desktop applications using the Web client and native HTTP |

Flutter owns its native implementations in `sdks/flutter/native/`.
Web owns the Identity and Flows components in `sdks/web/identity/` and
`sdks/web/flows/`. These are internal dependencies, not additional SDKs to
install. Historical release coordinates remain recorded in
`scripts/config/sdk-libraries.json`; archived source is retained by Git history.

Run `pnpm sdk:catalog:check` to validate the public catalogue and internal
components. `pnpm sdk:documentation:check` verifies installation instructions
against published release metadata. A source version marked `unreleased` has
no registry version or immutable installation tag yet.

`pnpm web:check`, `pnpm tauri:check` and `pnpm flutter:check` validate the SDKs.
The FlutterFlow reusable project lives in `scripts/clients/flutterflow-library`;
its public actions are inventoried in `scripts/config/flutterflow-custom-code.json`.

## License

SuperBoard is released under the [MIT License](./LICENSE).

Contributions follow [CONTRIBUTING.md](./CONTRIBUTING.md). Report security
issues through the private process documented in [SECURITY.md](./SECURITY.md).

## Local development

Run `pnpm local:start` to build SuperBoard, apply local migrations and start EmDash at `http://127.0.0.1:4321` with its local Workers. Stop the services with `pnpm local:stop`.

Local databases, generated secrets and service logs are stored under `~/.local/share/superboard/local/mbza-development/`. Restarting preserves this data. The command uses the platform development target and does not load application addons.

Run `pnpm local:test` against the running local server to verify plugin activation, deactivation and persistence in the browser. The test restores Communication to its initial state.
