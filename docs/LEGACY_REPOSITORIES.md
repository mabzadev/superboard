# Archived SuperBoard repositories

GitHub was consolidated on 2026-08-12. `mabzadev/superboard` is the only active
source repository for SuperBoard development, pull requests, releases,
Cloudflare connections and documentation.

## Archived repositories

| Repository                      | Archived state                                    | Historical assets retained                    |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------- |
| `mabzadev/superboard-platform`  | Read-only; GitHub Actions and Dependabot disabled | 18 tags and 13 GitHub Releases                |
| `mabzadev/superboard-reference` | Read-only; GitHub Actions and Dependabot disabled | No tags or GitHub Releases existed at cutover |

The archived repository descriptions and homepages point to
`https://github.com/mabzadev/superboard`. Issues, projects and wikis are disabled.
Do not reconnect these repositories to Cloudflare or create new automation in
them.

## Immutable compatibility records

The archived tags and Releases must not be deleted, moved or recreated.
The SDK catalogue uses the canonical npm coordinates
`@mabzadev/superboard-js-sdk` and `@mabzadev/superboard-react-native-sdk`.
Their recorded versions and commits describe historical artifacts; changing
the catalogue does not republish or verify packages at these coordinates.
Original package metadata is retained in the operator's rename backup.
These archived SDKs are not active source-code dependencies.

All current source, package metadata, FlutterFlow DSL, deployment manifests and
operator documentation must use `https://github.com/mabzadev/superboard`.
