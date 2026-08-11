# Contributing to SuperBoard

SuperBoard is a public multi-application Cloudflare platform. `dev` is the
integration branch and `main` is the promoted production branch. Open a feature
branch and a pull request into `dev`; do not deploy an unreviewed revision.
Both long-lived branches require the aggregate `CI gate`, one approving
CODEOWNERS review, stale-review dismissal and linear history. A manual
Cloudflare workflow run is a redeploy mechanism only: it must find a successful
`CI gate` for the exact selected SHA.

## Local validation

Install the pinned Node dependencies and run the complete baseline:

```bash
npm ci
npm run test:all
npm run platform:readiness
```

The readiness report is intentionally red until external GitHub and Cloudflare
resources exist. Local contract failures must still be resolved before review.

## Architecture rules

- Put reusable identity, files, notifications, billing, support, marketing,
  onboarding and back-office behavior in the common platform.
- Put application domains, Worker names, resource names, public OAuth
  audiences and enabled features in `deploy/targets/<target>.json`.
- Add application-only jobs or provider bridges through one declared
  `customWorker`; validate it with `npm run custom:check -- --target <target>`.
- Promote a custom capability into a common Worker when a second application
  needs it. Do not copy its protocol or implementation.
- Never add a Cloudflare account, hostname, project key or secret as a reusable
  source-code default.
- Add D1 changes as ordered migrations owned by exactly one service. Production
  convergence requires a protected backup and the explicit confirmation gate.

Register a new application with `npm run target:register`; review the generated
manifest and Cloudflare dry-run before requesting any external mutation.

## Security and generated files

Never commit `.env`, `.dev.vars`, generated Wrangler files, build artifacts,
backups or exported customer data. Use exact file paths when staging changes and
run `npm run secrets:scan` before review. See [SECURITY.md](SECURITY.md) for
private vulnerability reporting.
