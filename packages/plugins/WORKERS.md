# SuperBoard workers

`workers/` contains the source packages used by registered targets in
`infra/targets/`. Run `pnpm workers:inventory` to list them and detect unused
packages, missing entrypoints and stale workspace declarations.

The `mbza-development` target uses 17 packages here. Its console lives in
`apps/site`. The consolidated deployment profile groups these sources as follows:

| Deployment group    | Source packages                                                             |
| ------------------- | --------------------------------------------------------------------------- |
| API                 | `api`, `app`, `products`, `paywalls`, `onboardings`, `dynamic-links`, `mcp` |
| Authentication      | `identity`                                                                  |
| Files               | `files`                                                                     |
| Payments            | `billing`                                                                   |
| Communications      | `email`, `marketing`; the push consumer is in `email/src/push-consumer.ts`  |
| Automations         | `flows`                                                                     |
| Support             | `support`                                                                   |
| Analytics           | `analytics`                                                                 |
| Monitoring          | `observability`                                                             |
| Reference extension | `custom/reference`                                                          |

The deployment grouping is defined in `scripts/cloudflare/deployment-groups.mjs`.
Grouped services still need their source packages, migrations and tests. Local
development can run the logical services separately.

Legacy Messaging is retired. Support handles conversations. The legacy SQL
migrations are retained in `scripts/database/legacy-messaging-migrations`
for existing database imports; they are not an executable workspace package.

Shared worker tooling and Hono versions use `catalog:workers` in
`pnpm-workspace.yaml`, backed by `package.catalogs` in
`scripts/config/emdash-root.overlay.json`. MCP uses the default TypeScript 6 catalog;
the other workers retain TypeScript 5. The existing JOSE 5 and JOSE 6 consumers
keep their respective major versions.

After changing worker dependencies, update the lockfile and verify the install
with `pnpm install --frozen-lockfile`. Run `pnpm cloudflare:test:services`,
`pnpm typecheck`, and the affected workers' test scripts before deployment.
