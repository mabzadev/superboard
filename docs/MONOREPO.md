# SuperBoard monorepo

`mabzadev/superboard` is the only active source repository for the reusable
SuperBoard foundation.

## Source layout

| Path                                                     | Ownership                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/site`                                              | Astro Site, EmDash Admin and composition of the SuperBoard Front                                        |
| `apps/reference`                                         | Flutter reference application, acceptance contract and custom Worker                                    |
| `apps/mcp`                                               | Standalone MCP server                                                                                   |
| `packages/plugins`                                       | EmDash plugins and the eight SuperBoard plugin packages                                                 |
| `packages/core`, `packages/admin`, other EmDash packages | Integrated EmDash foundation                                                                            |
| `packages/supbrd-core`                                   | Shared SuperBoard contracts and plugin runtime helpers                                                  |
| `packages/supbrd-front-ui`                               | Shared browser components                                                                               |
| `packages/contracts`, `packages/email-transport`         | Shared service contracts and email transport                                                            |
| `sdks`                                                   | Client libraries; lifecycle and release coordinates are recorded in `scripts/config/sdk-libraries.json` |
| `scripts/config`                                         | Global configuration, schemas and versioned integration artifacts                                       |
| `infra/targets`                                          | Non-secret deployment manifests                                                                         |
| `infra/generated`                                        | Generated deployment configurations and build artifacts                                                 |
| `scripts`                                                | Commands grouped by usage; see the [scripts guide](../scripts/README.md)                                |
| `tests`                                                  | Maintained test suites, fixtures, linters and checks; see the [test guide](../tests/README.md)          |
| `scripts/clients/flutterflow-library`                    | Reusable FlutterFlow library source                                                                     |

The other EmDash directories retain their existing roles: documentation,
templates, assets, translation tooling,
dependency patches and agent skills.

## Work on a plugin

Start in `packages/plugins/<plugin-id>`. A SuperBoard plugin owns its Front
sources, component declarations and service packages. A single service lives in
`worker/`; grouped services use their existing names, such as `billing/` and
`products/`. Each service retains its compiler configuration and migrations.
Plugin-specific operational scripts live with that plugin. Their test suites
are grouped under `tests/checks/plugins/<plugin-id>/`; reusable test data lives
under `tests/fixtures/`.

The installable SuperBoard packages are `supbrd-core`, `supbrd-plug-identity`,
`supbrd-plug-data`, `supbrd-plug-commerce`, `supbrd-plug-communication`,
`supbrd-plug-journeys`, `supbrd-plug-support` and `supbrd-plug-analytics`.
The library `packages/supbrd-core` provides shared mechanisms; the package
`packages/plugins/supbrd-core` supplies the platform plugin.

`scripts/config/superboard-plugin-packages.json` assigns components to plugins.
`scripts/cloudflare/services.mjs` records the source package of each logical
service. Deployment groups can combine several services without changing their
plugin ownership. The Site assembles the plugins' contributions; the standalone
MCP application remains in `apps/mcp`.

Keep database migrations with their existing service or CMS owner. Moving a
service does not change migration names, database bindings, service names or
public API paths.

## Legacy repositories

`mabzadev/superboard-platform` and `mabzadev/superboard-reference` are archived
migration sources. Their immutable tags, releases and historical package
coordinates are retained for existing clients, but their workflows and
Dependabot automation are disabled. New code, issues, releases and Cloudflare
Git connections must target `mabzadev/superboard`.

The verified cutover inventory and the narrow historical-package exception are
recorded in [`LEGACY_REPOSITORIES.md`](LEGACY_REPOSITORIES.md).

## Development

Install the workspace and build the Site with its dependencies:

```bash
pnpm install --frozen-lockfile
pnpm --filter @superboard/site... build
pnpm typecheck
```

The root commands such as `plugins:test`, `support:check`, `modules:typecheck`
and `local:start` resolve the current package locations. Some integration commands
target the configured development environment; use the local test variants when
working without remote services.

Run an isolated local instance without using the normal development databases:

```bash
pnpm local:start --state-directory /tmp/superboard-validation
pnpm local:stop --state-directory /tmp/superboard-validation
```

The local supervisor waits for each service to answer on its health endpoint
before starting the next service. This avoids concurrent SQLite recovery when
restarting an existing local instance.

The normal local state directory remains
`~/.local/share/superboard/local/mbza-development/`. See
[Development workflow](DEVELOPMENT_WORKFLOW.md) for the operational procedure.
