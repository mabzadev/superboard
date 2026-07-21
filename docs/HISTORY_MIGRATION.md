# History migration

The monorepo was assembled with non-squashed `git subtree` imports. Original
commit objects, authors and timestamps remain reachable. The import merge commits
record `git-subtree-split`, which provides the exact old-to-new SHA relation.

| Historical repository | Imported SHA | New path |
| --- | --- | --- |
| `grovs-io/backend` | `6a20f36994ca587cdeb554e08a25689c4f5240e8` | `workers/api` |
| `grovs-io/dashboard` | `43b8fde26bf5d19b3fb1bdea6cb35d2f68e486b7` | `apps/dashboard` |
| `grovs-io/mcp` | `c01b4bca89d0475a817f6671ca42efa9bec02c28` | `apps/mcp` |
| `grovs-io/grovs-utils` | `49e30506df68704acfb8402c3b64ea56f8a54d65` | `packages/shared` |
| `grovs-io/grovs-flutter` | `eec1c65b9732034db5b4679c65ded0b66e3e5c46` | `sdks/flutter` |
| `grovs-io/grovs-iOS` | `fd90467273ac63752be93d84e961941b5bdf149c` | `sdks/ios` |
| `grovs-io/grovs-Android` | `1116eddf93507aab001e7d60080f38767af58b94` | `sdks/android` |
| `grovs-io/grovs-js` | `20fc5ab75e48697037daa3bc5b8b193dd679c35f` | `sdks/javascript` |
| `grovs-io/grovs-react-native` | `864d3bee900a34b24fce334d81abdf32e41b27ea` | `sdks/react-native` |

The old names in this table are provenance, not supported aliases. Historical D1
migration filenames are also left unchanged because Cloudflare tracks migration
application by filename. Their credential seeds were redacted and disabled; new
installations converge through `0010_opengrow_identity.sql` and secure OAuth
rotation.

Verification:

```bash
git log --merges --grep='Import .* history' --format=fuller
git cat-file -t 6a20f36994ca587cdeb554e08a25689c4f5240e8
git cat-file -t 864d3bee900a34b24fce334d81abdf32e41b27ea
```
