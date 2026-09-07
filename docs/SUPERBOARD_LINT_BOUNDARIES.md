# SuperBoard lint coverage

Run `pnpm lint` from an installed workspace to check the repository's JavaScript and TypeScript sources. The command runs the coverage tests, then each source's linter. Warnings, errors, invalid configurations, and failed linter processes fail the gate.

The root gate uses the existing project configurations:

| Source                                                                     | Configuration                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| EmDash packages and applications, Site, and SuperBoard runtime definitions | Root `.oxlintrc.json`, with type-aware checks                                                |
| Dashboard                                                                  | `apps/dashboard/eslint.config.mjs`                                                           |
| Plugin client components and `supbrd-front-ui`                             | Dashboard rules through `config/superboard-front-eslint.config.mjs`                          |
| MCP application                                                            | `apps/mcp/eslint.config.js`                                                                  |
| Analytics, Flows, Marketing, and Support Workers                           | Each Worker's `eslint.config.mjs`                                                            |
| Imported executable Flows SDK packages and E2E tests                       | Imported SDK Oxlint configurations, with type-aware checks                                   |
| Other SuperBoard JavaScript and TypeScript                                 | `config/superboard-lint.oxlintrc.json`, with correctness, `no-var`, and `prefer-const` rules |

The last group uses syntax checks because these sources have no common TypeScript project. Run `pnpm typecheck` separately to check the package and Worker type contracts. The root EmDash style configuration does not define the conventions of the historical Dashboard or Workers.

## Inspect the files being checked

`pnpm lint:coverage` prints the complete source inventory grouped by linter. It includes tracked files and untracked files that Git does not ignore. A new executable file receives a linter without adding it to an allowlist. New files inside an upstream EmDash package retain the package's rules.

The inventory also reports exclusions with a reason: generated output, declaration files, skill scaffolds, and imported Flows reference material. Flows `product/` and `reference/` are source references, as described in `sdks/flows/upstream/GENERATED.md`; the executable SDK lives under `packages/` and `tests/e2e/`. `pnpm flows-sdk:check:import` verifies the imported files against their recorded checksums, including the reference material.

An ESLint ignored-file warning remains a failing diagnostic. Do not add an exclusion to make an executable source disappear from the gate. Assign it the configuration that owns its conventions.

## Machine-readable results

`pnpm lint:json` returns an object with `diagnostics` and `coverage`. For a clean JSON stream independent of package-manager status messages, run `node scripts/superboard-lint.mjs --json` directly. An empty `diagnostics` array means the lint gate passed; it does not establish functional or browser-test coverage.

`pnpm lint:quick` uses the same file inventory and ESLint rules, with the type-aware Oxlint pass omitted. It does not replace `pnpm lint` or `pnpm typecheck` before delivery. `pnpm lint:fix` applies each owning linter's available fixes; review the resulting diff and rerun the full gate.

## Reinstall after a Flows source synchronization

The Flows synchronizer replaces its generated directory. Run `pnpm install --frozen-lockfile` after synchronization to restore local workspace links before running SDK builds, types, or E2E tests. All executable SDK packages, including `tests/e2e`, are part of the root pnpm workspace.

## Record plugin and view proofs

Run `node scripts/superboard-plugin-validation-report.mjs --evidence <evidence.json> --output <report.json>` to compare test evidence with `config/superboard-plugin-independence-baseline.json`. The command writes JSON and Markdown reports and exits with status 1 while required evidence is missing, failed, or insufficient. It never derives the expected routes from the modified implementation.

Evidence is a JSON array. Each entry supplies `plugin_id`, `route_id` (or `null` for lifecycle checks), `scenario`, `status` (`passed` or `failed`), `type` (`unit`, `integration`, or `browser`), and an existing `evidence_path`. Mutation proofs also supply nonempty `data_ids` identifying persisted test data. Keep credentials out of evidence artifacts.

Every view requires browser evidence for `render`, `reload`, `navigation`, and `functional`. Each menu entry requires `menu-active`, `menu-disabled`, and `menu-reactivated`. API entries require integration or browser evidence for `read` on GET endpoints and `mutation` on other methods. Each plugin requires `activate`, `deactivate`, `reactivate`, `standalone`, `data-retention`, `direct-route-rejection`, and `direct-api-rejection`; the `emdash-core` entry requires `all-disabled`. These lifecycle scenarios accept integration or browser evidence.

Unit tests supplement these results. They cannot replace browser or persisted-operation proofs. An unknown route or scenario fails the report, and a failed result stays failed when another entry claims success for the same check.
