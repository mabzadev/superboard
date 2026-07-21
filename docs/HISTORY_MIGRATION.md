# History migration

The monorepo was assembled with non-squashed `git subtree` imports. Authors,
timestamps, commit messages and topology are preserved. Before the first remote
push, detected credentials were replaced throughout the imported history, so
affected commit IDs changed intentionally. The source and sanitized IDs below
provide the audit mapping. Historical tags are preserved under `legacy/<project>/`.

| Historical repository | Source SHA | Sanitized SHA | New path |
| --- | --- | --- | --- |
| `grovs-io/backend` | `6a20f36994ca587cdeb554e08a25689c4f5240e8` | `9d0be511b6da74854253a2b1dbe8a96125324064` | `workers/api` |
| `grovs-io/dashboard` | `43b8fde26bf5d19b3fb1bdea6cb35d2f68e486b7` | `f400c9df5f08fefd6752b5cb9e7abe9f45eddb5b` | `apps/dashboard` |
| `grovs-io/mcp` | `c01b4bca89d0475a817f6671ca42efa9bec02c28` | `52466a0c2e9f5fd10268960aecb75af366cd97c1` | `apps/mcp` |
| `grovs-io/grovs-utils` | `49e30506df68704acfb8402c3b64ea56f8a54d65` | `49e30506df68704acfb8402c3b64ea56f8a54d65` | `packages/shared` |
| `grovs-io/grovs-flutter` | `eec1c65b9732034db5b4679c65ded0b66e3e5c46` | `69fe3a3b457a7da2ad66d5cfd5193869fc029579` | `sdks/flutter` |
| `grovs-io/grovs-iOS` | `fd90467273ac63752be93d84e961941b5bdf149c` | `71731bc60f1bd469aad41e1047f84fdf03e66dd7` | `sdks/ios` |
| `grovs-io/grovs-Android` | `1116eddf93507aab001e7d60080f38767af58b94` | `cbedc0d13206433c28ffc6fcd95c73d255e37bff` | `sdks/android` |
| `grovs-io/grovs-js` | `20fc5ab75e48697037daa3bc5b8b193dd679c35f` | `703257a4f418df3b60c78f88d399130f2076e5a2` | `sdks/javascript` |
| `grovs-io/grovs-react-native` | `864d3bee900a34b24fce334d81abdf32e41b27ea` | `3189cda795bf1eb4a840e761b73fe0c000f2bf08` | `sdks/react-native` |

The old names in this table are provenance, not supported aliases. Historical D1
migration filenames are also left unchanged because Cloudflare tracks migration
application by filename. Their credential seeds were redacted and disabled; new
installations converge through `0010_opengrow_identity.sql` and secure OAuth
rotation.

Verification:

```bash
git log --merges --grep='Import .* history' --format=fuller
git cat-file -t 9d0be511b6da74854253a2b1dbe8a96125324064
git cat-file -t 3189cda795bf1eb4a840e761b73fe0c000f2bf08
git tag -l 'legacy/*'
gitleaks git .
```
