# Archived SuperBoard repositories

GitHub was consolidated on 2026-08-12. `mabzadev/superboard` is the only active
source repository for SuperBoard development, pull requests, releases,
Cloudflare connections and documentation.

## Archived repositories

| Repository | Archived state | Historical assets retained |
| --- | --- | --- |
| `mabzadev/superboard-platform` | Read-only; GitHub Actions and Dependabot disabled | 18 tags and 13 GitHub Releases |
| `mabzadev/superboard-reference` | Read-only; GitHub Actions and Dependabot disabled | No tags or GitHub Releases existed at cutover |

The archived repository descriptions and homepages point to
`https://github.com/mabzadev/superboard`. Issues, projects and wikis are disabled.
Do not reconnect these repositories to Cloudflare or create new automation in
them.

## Immutable compatibility records

The archived tags and Releases must not be deleted, moved or recreated. The
historical npm packages `@mbzadev/opengrow-js-sdk` and
`@mbzadev/opengrow-react-native-sdk`, and the Maven package
`io.opengrow:opengrow-android-sdk`, remain attached to
`mabzadev/superboard-platform` in GitHub Packages. Their registry coordinates are
therefore deliberately retained in `config/sdk-libraries.json`; this is not an
active source-code dependency.

All current source, package metadata, FlutterFlow DSL, deployment manifests and
operator documentation must use `https://github.com/mabzadev/superboard`.
