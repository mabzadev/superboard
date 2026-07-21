# OpenGrow

Private canonical monorepo for the OpenGrow platform and SDKs. The repository is
the only source of truth; Cloudflare targets are isolated by declarative manifests
and never fork this code.

## Layout

| Path | Purpose |
| --- | --- |
| `apps/dashboard` | Next.js dashboard deployed with OpenNext on Workers |
| `workers/api` | Hono API, OAuth, short links, purchases and queues |
| `apps/mcp` | OpenGrow MCP server and plugin |
| `sdks/flutter` | `opengrow_flutter` |
| `sdks/flutterflow` | `opengrow_flutterflow` actions and paywall |
| `sdks/ios` | OpenGrow iOS SDK implementation |
| `sdks/android` | `io.opengrow:opengrow-android` |
| `sdks/javascript` | `@mbzadev/opengrow-js` |
| `sdks/react-native` | `@mbzadev/opengrow-react-native` |
| `packages/shared` | Shared utilities |
| `deploy/targets` | Non-secret target manifests and schema |

The root `Package.swift` exposes the iOS SDK directly from `sdks/ios`.

## Local validation

```bash
npm ci
npm run typecheck
npm test
npm run dashboard:cf-build

cd sdks/flutter && flutter test
cd ../flutterflow && flutter test
cd ../.. && xcodebuild -project sdks/ios/OpenGrow.xcodeproj -scheme OpenGrow \
  -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
```

Android, JavaScript, React Native and MCP validation commands are mirrored in
`.github/workflows/ci.yml`.

## Cloudflare targets

`deploy/targets/<target>.json` contains names, domains and resource identifiers,
but never credentials. Production and staging bindings are distinct. Vocostar
reuses its existing production D1, KV, R2 and queues; only Worker names and the
deployment mechanism change.

```bash
# Validate/preview an existing target
npm run cloudflare:bootstrap -- --target vocostar --environment staging

# Provision missing resources with a target-scoped token
CLOUDFLARE_API_TOKEN=... npm run cloudflare:bootstrap -- \
  --target vocostar --environment staging --apply

# Generate and deploy
npm run cloudflare:deploy -- --target vocostar --service api --environment staging
npm run cloudflare:deploy -- --target vocostar --service dashboard --environment staging
```

For production the deploy command exports D1 before migrations. Generated
Wrangler files and backups are ignored. Runtime secrets are uploaded over stdin:

```bash
security find-generic-password ... | npm run cloudflare:set-secret -- \
  --target vocostar --environment production --service api --name JWT_SECRET
```

OAuth rotation is atomic from the operator's perspective: the command generates a
high-entropy value, updates D1 through a protected temporary SQL file, writes the
matching dashboard Worker secret, and removes the file.

```bash
npm run cloudflare:rotate-oauth -- --target vocostar --environment staging
```

See `docs/CLOUDFLARE.md` for blue/green rollout and Workers Builds settings.

## Private SDK releases

All OpenGrow SDKs start at `1.0.0` and remain private.

- `sdk-android-v1.0.0`, `sdk-js-v1.0.0`, `sdk-react-native-v1.0.0` publish to GitHub Packages.
- `sdk-ios-v1.0.0`, `sdk-flutter-v1.0.0`, `sdk-flutterflow-v1.0.0` create immutable GitHub releases.
- FlutterFlow consumes the private repository by immutable `ref` and package
  `path`; the fine-grained read token belongs in FlutterFlow's private dependency
  authentication, never in exported source.

The migration provenance and source SHAs are documented in
`docs/HISTORY_MIGRATION.md`.
