# SuperBoard monorepo

`mbzadev/superboard` is the only active source repository for the reusable
SuperBoard foundation.

## Source layout

| Path | Ownership |
| --- | --- |
| `/apps/dashboard` | SuperBoard back-office at `board.mbza.dev` |
| `/apps/reference` | MBZA reference application and acceptance contract |
| `/workers` | Common Cloudflare Workers and application extensions |
| `/sdks/flutter` | Active Flutter SDK |
| `/sdks/flutterflow` | Active unified FlutterFlow library |
| `/deploy/targets` | Non-secret deployment manifests for every account |

VocoStar remains a separate product repository. It consumes published
SuperBoard libraries and the shared Cloudflare platform; its application code
is not copied into this foundation repository.

## Legacy repositories

`mbzadev/superboard-platform` and `mbzadev/superboard-reference` are migration
sources only. New code, issues, releases and Cloudflare Git connections must
target `mbzadev/superboard`. Historical package coordinates and immutable tags
are retained until consumers have moved to SuperBoard v3.

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
