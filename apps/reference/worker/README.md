# App-specific Workers

SuperBoard common features belong to plugins under `packages/plugins/`. An application gets one
custom Worker only when it has jobs or integrations that are genuinely unique.

Rules:

1. Start from `apps/reference/worker`; keep it in the `mabzadev/superboard` monorepo.
2. Declare its source, description, and capabilities in the target manifest.
3. Expose only the versioned private contract from `@superboard/contracts/custom-worker`.
4. Reach it from the API through a Service Binding, never through a public admin endpoint.
5. Every job carries an idempotency key and `projectRef`; queued handlers persist idempotency before side effects.
6. Secrets are Worker secrets. Public configuration belongs in the target manifest or SuperBoard admin data.
7. Never hand-write the Cloudflare `Env`: `scripts/cloudflare/types.mjs` generates the
   variables, D1 and Service Binding types from the owning target manifest and
   appends only the declared secret names.
8. One app-specific package has one target owner. A feature that is needed by a
   second app graduates to a shared plugin service.

`pnpm run custom:check -- --target <target>` validates the single extension
selected by a deployment. `pnpm run custom:check:all` discovers every unique
`customWorker.packagePath` from `infra/targets` for the repository-wide CI
gate. Neither workflow contains an application-specific package list.
Both commands regenerate the target-driven binding types before TypeScript and
runtime tests. `pnpm run cloudflare:types:check` also fails when any checked-in
custom binding declaration is stale.

The reference `reference.echo` capability is deliberately development-only and
exists solely to verify the integration contract.
