# SuperBoard CLI

`superboard` manages the database, storage, functions and vectors of a
SuperBoard project from a terminal or a CI job. It authenticates with a server
key and has no runtime dependencies. It needs Node.js 22 or later.

<!-- superboard-sdk-documentation:cli:start -->

> **Lifecycle: active.** New versions may be published only through the
> protected immutable-release workflow.

## Installation

Source version 0.1.0 is not published. Use the monorepo workspace during development; there is no npm release to install yet.

<!-- superboard-sdk-documentation:cli:end -->

## Sign in

Create a server key (`sb_secret_…`) in the SuperBoard Front, then save it with
the SDK origin of your instance:

```bash
superboard login --url https://sdk.example.com --key sb_secret_…
superboard status
```

`login` checks the key, then writes `$XDG_CONFIG_HOME/superboard/config.json`
(`~/.config/superboard/config.json` by default) with mode `0600`. The
`SUPERBOARD_URL` and `SUPERBOARD_SECRET_KEY` environment variables take
precedence over that file, which suits CI jobs. `superboard logout` deletes the
file. A server key grants full access to the project: keep it out of
repositories and application bundles.

## Commands

| Command                                                  | Effect                                                  |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `superboard status`                                      | Project id, available features and resource counts      |
| `superboard db tables`                                   | Tables, columns and access rules                        |
| `superboard db pull [--out schema.json]`                 | Current schema, in the format accepted by `db push`     |
| `superboard db push <schema.json>`                       | Applies the schema and prints the plan                  |
| `superboard gen types [--out database.ts]`               | TypeScript types of the tables                          |
| `superboard functions list`                              | Deployed functions                                      |
| `superboard functions deploy <name> <file>`              | Deploys a new version of an ES module                   |
| `superboard functions invoke <name>`                     | Runs the function once and prints its response and logs |
| `superboard functions runs <name>`                       | Latest executions                                       |
| `superboard functions schedule <name> "<cron>"`          | Runs the function on a UTC cron schedule                |
| `superboard functions unschedule <name>`                 | Removes the schedule                                    |
| `superboard functions delete <name>`                     | Deletes the function, its versions, runs and schedule   |
| `superboard storage buckets`                             | Buckets and their rules                                 |
| `superboard storage ls <bucket> [--prefix p]`            | Objects of a bucket                                     |
| `superboard storage upload <bucket> <path> <file>`       | Uploads a file; above 50 MiB, in resumable parts        |
| `superboard storage download <bucket> <path> [--out f]`  | Downloads an object to a file or standard output        |
| `superboard storage rm <bucket> <path>`                  | Deletes an object                                       |
| `superboard vectors collections`                         | Vector collections                                      |
| `superboard vectors query <collection> <text> [--top-k]` | Similarity search                                       |

Every command accepts `--help` and `--json`. With `--json`, the API response is
printed as JSON on standard output and errors are printed as
`{"error": {"code", "message", "status"}}` on standard error.

Errors show the API code, for example
`Error: The schema deletes tables or columns [destructive_changes, HTTP 409]`.
The exit code is `0` on success, `1` when the API refuses the request or a
function answers with an error status, and `2` for a usage error.

## Schema as code

```bash
superboard db pull --out schema.json
# edit schema.json, then review the plan
superboard db push schema.json --dry-run
superboard db push schema.json
```

`db push` refuses to drop a table or a column unless you pass
`--allow-destructive`. Tables missing from the file are kept; `--prune` drops
them, and also requires `--allow-destructive`.

## Functions

```bash
superboard functions deploy hello functions/hello.js \
  --access authenticated --timeout-ms 10000 \
  --var GREETING=bonjour --secret API_TOKEN="$API_TOKEN"
superboard functions invoke hello --method POST --path /greet --data '{"name":"Ada"}'
superboard functions schedule hello "*/15 * * * *"
```

`--var` replaces all variables of the function. `--secret` sets or replaces one
encrypted secret and leaves the others in place; secrets are never returned.

## Large files

`storage upload` sends files above 50 MiB in 50 MiB parts. When an upload stops,
the error prints the command that resumes it, for example:

```bash
superboard storage upload media videos/intro.mp4 intro.mp4 --resume 4f1c…
```

Resume with the same file; the parts already received are skipped. An
unfinished upload expires after 24 hours.

## Validation

From the repository root, run `pnpm cli:check`. The tests start a local HTTP
server and check the paths, headers, bodies and output of each command.
