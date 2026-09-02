# SuperBoard Site

`apps/site` is the Astro/Cloudflare Site that mounts native EmDash Admin and the
generic Front SuperBoard runtime. It is the executable target slice for issue
[#33](https://github.com/mabzadev/superboard/issues/33); it does not replace the
historical Dashboard until the parity, data migration, development rollout,
production cutover, rollback, and observation gates have passed.

## Runtime boundaries

- `/_emdash/*` belongs exclusively to native EmDash routes.
- `/superboard-system/health` reports process health without reading the Front
  release pointer.
- `/superboard-system/readiness` returns `503` until the Instance has an active
  verified Front Release.
- `/superboard-system/api/releases/compile` compiles and stages a closed Front
  Release Candidate. It requires an EmDash administrator session, same-origin
  CSRF proof, an ES256 release key, and `SUPERBOARD_RELEASE_OPERATIONS=enabled`.
- All other paths are resolved by `supbrd-core` from the Last Verified Release.
  Without one, the Front returns maintenance while EmDash Admin remains
  recoverable.

D1 is the activation authority. `RELEASE_CACHE` stores only a cryptographically
verified fallback and never decides which release becomes active. Release key
IDs are immutable: reusing a `kid` with different public key material fails.

## Local validation

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm target:orchestrate check --target mbza-development --environment local --adapter local
pnpm site:check
```

Generate the Site, Gateway, and enabled Worker configurations from the local
target materialization:

```bash
pnpm target:orchestrate configure --target mbza-development --environment local --adapter local
```

Apply every target-owned migration to local Wrangler storage, then start the
Site, Gateway, and enabled Workers:

```bash
pnpm target:orchestrate migrate --target mbza-development --environment local --adapter local
pnpm target:orchestrate start --target mbza-development --environment local --adapter local
```

The generated local configuration keeps Release operations disabled. Copy
`.dev.vars.example` to `.dev.vars` only for an authorized local exercise and
provide a private P-256 JWK with `alg: ES256` and an immutable `kid`. Never
commit that file or key.

An authorized development rehearsal may enable the release endpoints only on
the explicit Site preview route:

```bash
node scripts/cloudflare-deploy.mjs \
  --target mbza-development \
  --environment development \
  --service site \
  --site-preview-route \
  --release-operations
```

The flag is rejected for production, for another service, without the preview
route, or during preflight. The deployment still requires the separately
provisioned `SUPERBOARD_RELEASE_PRIVATE_JWK` secret.

## Known promotion blockers

This slice intentionally remains fail-closed until the following evidence is
available:

- an operator strong-reauthentication receipt and approval endpoint;
- renderer registry and plugin compatibility receipts for every concrete page;
- target-manifest identities for D1, R2, Session KV, Release KV, Worker Loader,
  domains, secrets, monitors, and service bindings;
- a verified FTS5-capable backup/restore path;
- Worker Loader entitlement, bounded plugin fan-out, and dynamic-isolate
  observability on the development account;
- parity receipts, development rehearsal, progressive traffic cutover,
  production rollback, and the required observation period.
