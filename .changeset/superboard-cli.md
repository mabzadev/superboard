---
"@superboard/cli": minor
---

Adds the `superboard` command to manage a project's database, storage, functions and vectors with a server key. It requires Node.js 22 or later and has no runtime dependencies.

```sh
superboard login --url https://sdk.example.com --key sb_secret_…
superboard db pull --out schema.json
superboard db push schema.json --dry-run
superboard functions deploy hello functions/hello.js --access authenticated
superboard storage upload media videos/intro.mp4 intro.mp4
```

`login` stores the credentials in `$XDG_CONFIG_HOME/superboard/config.json` with mode `0600`; `SUPERBOARD_URL` and `SUPERBOARD_SECRET_KEY` take precedence. Every command accepts `--help` and `--json`, and errors show the API code. The command exits with `0` on success, `1` when the API refuses the request, and `2` for a usage error.
