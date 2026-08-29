# Issue #51 — Site EmDash Cloudflare control-plane evidence

## Implemented boundary

`site` is a first-class platform service and D1 schema owner. Both checked-in
targets now declare separate, non-secret identities for the Site Worker, Site
D1, MEDIA R2 bucket, SESSION KV namespace, Last Verified Release KV namespace,
Worker Loader binding, cron schedule, hostname, secrets and observability.

The target build compiles Astro first, overlays only the selected target values,
and deploys `apps/site/dist/server/wrangler.json`. The artifact keeps
`SUPERBOARD_RELEASE_OPERATIONS=disabled`, contains no public route and omits
`global_fetch_strictly_public`. EmDash D1 sessions remain disabled in
`apps/site/astro.config.mjs`; Astro sessions use only the explicit SESSION KV.

## Local evidence

- `pnpm site:check`: green; Astro reports 0 errors, 0 warnings and 0 hints.
- `pnpm cloudflare:test:targets`: 296/296 green, including every enabled D1
  owner against a fresh schema.
- `pnpm cloudflare:types:check`: green; the checked output includes
  `apps/site/worker-configuration.d.ts`.
- Target artifact dry-run: 429 modules, 9,585.32 KiB upload and 2,418.47 KiB
  gzip; all Site bindings are present and no route is attached.
- Generated configuration tests cover both `mbza-development/development` and
  `vocostar/production` with validation-only placeholder IDs where the target is
  intentionally unprovisioned.

## Remote read-only plans

No mutation was performed and no credential value is included below.

### mbza-development / development

- Mode: `remote-read-only`.
- Account fingerprint: `b25745e5a154`.
- Inventory: 46 resources; 13 planned operations; 0 blockers.
- Site resources absent and creatable: `siteD1`, `siteSessionKv`,
  `siteReleaseKv`, `siteMedia`.
- Exact plan confirmation: `CLOUDFLARE:BOOTSTRAP:mbza-development:development:e50e38670e8e`.
- The plan is applicable but was deliberately not applied in #51.

### vocostar / production

- Mode: `remote-read-only`.
- Account fingerprint: `8eaef53cb5a7`.
- Inventory: 41 resources; 28 planned operations; 11 blockers.
- Site resources absent: `siteD1`, `siteSessionKv`, `siteReleaseKv`,
  `siteMedia`.
- Existing configured resources reported missing in the selected production
  account: `d1`, `kv`, `emailD1`, `identityD1`, `filesD1`, `moduleD1.app`,
  `moduleD1.products`, `moduleD1.paywalls`, `moduleD1.dynamicLinks`,
  `moduleD1.marketing`, `moduleD1.onboardings`.
- Exact plan confirmation: `CLOUDFLARE:BOOTSTRAP:vocostar:production:52d8cf7e5abc`.
- The plan is not applicable until the account/resource ownership drift is
  resolved. No production mutation is authorized by #51.
