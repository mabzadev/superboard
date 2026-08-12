# SuperBoard monorepo

`mabzadev/superboard` is the only active source repository for the reusable
SuperBoard foundation.

## Source layout

| Path                  | Ownership                                                                        |
| --------------------- | -------------------------------------------------------------------------------- |
| `/apps/dashboard`     | SuperBoard back-office at `board.mbza.dev`                                       |
| `/apps/reference`     | MBZA reference application and acceptance contract                               |
| `/workers`            | Common Cloudflare Workers and application extensions                             |
| `/packages/contracts` | Versioned envelopes and trust-boundary contracts shared by producers and Workers |
| `/sdks/flutter`       | Active Flutter SDK                                                               |
| `/sdks/flutterflow`   | Active unified FlutterFlow library                                               |
| `/deploy/targets`     | Non-secret deployment manifests for every account                                |

VocoStar remains a separate product repository. It consumes published
SuperBoard libraries and the shared Cloudflare platform; its application code
is not copied into this foundation repository.

Feature boundaries are directories and independently deployable Workers inside
this monorepo, not additional source repositories. Analytics and Marketing own
their D1 migrations and queues while sharing only versioned contracts through
`packages/contracts`; neither Worker imports another Worker's implementation or
opens another module's D1 directly.

## Legacy repositories

`mabzadev/superboard-platform` and `mabzadev/superboard-reference` are archived
migration sources. Their immutable tags, releases and historical package
coordinates are retained for existing clients, but their workflows and
Dependabot automation are disabled. New code, issues, releases and Cloudflare
Git connections must target `mabzadev/superboard`.

The verified cutover inventory and the narrow historical-package exception are
recorded in [`LEGACY_REPOSITORIES.md`](LEGACY_REPOSITORIES.md).

## Development

Install the two lockfiles independently, then run both contracts:

```bash
npm ci
npm run reference:install
npm run test:all
npm run reference:check
```

The root CI gate validates both the platform and `apps/reference`; it never
clones another SuperBoard repository.
