# SuperBoard Site

`apps/site` is the canonical Astro/Cloudflare site for SuperBoard. It serves
native EmDash Admin and the React views published by SuperBoard plugins. Both
use the same EmDash session and user account.

The SuperBoard operator console requires an active EmDash user with
`settings:manage`. Anonymous visitors are redirected to EmDash login;
authenticated users without this permission receive `403`. Public sign-in
routes remain available before authentication.

## Plugin packages

The operator catalogue exposes seven business packages plus the required core.
Vocostar appears only on its application target. The installable catalogue is
`scripts/config/superboard-plugin-catalog.json`, generated from
`scripts/config/superboard-plugin-packages.json` and the component contracts.
`scripts/config/emdash-plugin-topology.json` retains those internal contracts and must
not be used to count installed packages. See the [grouping and migration
reference](../../docs/technical-specs/SUPERBOARD_PLUGINS_REGROUPES_2026-09-09.md).

Use **SuperBoard** for the product name. `pnpm brand:check` validates the
brand contract, Front sources, and displayed plugin and SDK catalogue labels.
The same copy checks run in `lint`, `lint:quick`, and `lint:json`, including
files not yet added to Git. Published SDK coordinates, stored provider keys,
and legacy environment fallbacks retain their compatibility identifiers.

## Front navigation

Edit the console menu in **EmDash Admin → Menus → Front navigation** (English)
or **Navigation du front** (French), at
`/_emdash/admin/menus/superboard-admin?locale=fr`.
Labels, order, groups, and nested section pages come from these menu records.
Changes appear after reloading the front. Removing an item keeps it out of the
navigation; inactive plugins and unauthorized destinations are filtered out.

The bootstrap upgrades an untouched legacy menu and creates missing language
variants. Existing customized menus are preserved.

Run the complete menu check before changing navigation. The commit hook and
`.github/workflows/front-menu.yml` run this same check. The static rules also
run inside `lint`, `lint:quick`, and `lint:json`.

```bash
pnpm check:front-menu
```

The check covers calculated paths, renamed helpers, internal import aliases,
Astro template links, request-derived locale selection, and the English/French
front selector. Its integration test uses a separate SQLite database, native
EmDash menu handlers, the real menu cache, and the front renderer. It verifies
renaming, ordering, moving between levels, deletion, and language isolation.
EmDash Admin keeps its independent language list.

## Language

The language selector in the console header offers English and French. The choice persists across navigation, reloads, and login. An
explicit `?lang=` choice takes priority over the saved preference, followed by
the Identity URL language and the browser's supported language preferences.
Identity links and plugin contexts follow the console choice.

EmDash Admin has its own preference under **Settings → Language**. Its plugin
summaries reload in the selected admin language. These two preferences are
stored separately in this browser. The console supports English and French;
EmDash Admin retains its own language list.

Analytics views have English and French translations. Translation coverage
varies in other plugins; some older views still contain English text.

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

For an Astro dev server on port 4321 and a local API on port 8800, verify the
API, the site, and the native EmDash admin HTML before testing the console:

```bash
rtk proxy pnpm site:health --site http://127.0.0.1:4321 --api http://127.0.0.1:8800
```

Use the origins printed by your launcher if its ports differ. The target
orchestrator also checks the EmDash admin shell during startup and stops its
workers if the shell cannot be served. An empty `200` response does not pass.

The Astro development server, type checking, and production builds use separate
Vite caches. To exercise this isolation, start a fresh development server and
add `--typecheck` to `site:health`: the command runs Astro diagnostics before
requesting the admin shell. Stop the dev server before rebuilding workspace
packages, because those builds replace the dependency files it loads.

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

To test plugin activation and deactivation from EmDash Admin, provide
`SUPERBOARD_RELEASE_PRIVATE_JWK` in the repository-root `.env`: a private P-256
JWK with `alg: ES256` and an immutable `kid`. Keep the file and key out of Git.
Start the local target with Release operations enabled:

```bash
pnpm target:orchestrate start --target mbza-development --environment local --adapter local --release-operations
```

The option also applies to local `configure` and `migrate` commands. Each
generation enables Release operations and includes the signing secret in the
Site's required bindings. Omitting the option keeps Release operations disabled.
Wrangler loads `.env` only when no `.dev.vars` file takes precedence; see
[local environment variables and secrets](https://developers.cloudflare.com/workers/local-development/environment-variables/).

An authorized development rehearsal may enable the release endpoints only on
the explicit Site preview route:

```bash
node scripts/cloudflare/deploy.mjs \
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
