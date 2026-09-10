# Cloudflare console deployment

SuperBoard's standard local workflow and the Mabza Cloudflare deployment do not require Docker. Container builds belong to the optional runtimes below.

| Files                                                                        | Purpose                                                                     | Used by the Mabza target                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `workers/custom/vocostar/orchestrators/{vocals,medias}/container/Dockerfile` | Python and FFmpeg containers used by Vocostar's audio and video workflows   | No; declared only by the Vocostar target      |
| `apps/mcp/Dockerfile`                                                        | Optional standalone HTTP MCP adapter; validate with `pnpm mcp:docker:check` | No; the target runs the Cloudflare MCP Worker |
| `Dockerfile`, `compose.yaml`, `.dockerignore`                                | Integrated EmDash blog-template container example                           | No                                            |
| `infra/emdash-bot/Dockerfile`                                                | Linux sandbox used by the integrated upstream EmDash bot                    | No                                            |

An active SuperBoard console enables the signed release operations used by plugin activation. Provision `SUPERBOARD_RELEASE_PRIVATE_JWK` on the Site Worker before deploying it. The development secret generator creates an independent ES256 signing key for this purpose; retain the private key in the deployment secret store across upgrades.

Deployment configuration derives this behavior from the target's active public routing. Private builds and preflight builds keep release operations disabled. To prepare an explicitly read-only console, pass `--read-only-console` to `pnpm cloudflare:prepare`. An explicitly read-only console cannot activate plugins.

Plugin activation and deactivation use the signed-in administrator's session and permissions in every environment. The authorization is scoped to the plugin operation and recorded separately from strong reauthentication. Manual release approvals and rollbacks retain their strong reauthentication requirements. Check activation and deactivation after reloading the Plugins page; a successful HTTP health check alone does not verify these actions.

Communication can be installed and activated before configuring an email provider. AWS and SMTP credentials are optional at deployment; configure senders from the plugin after activation. Email installation readiness checks its database, queue, encryption key, and internal authentication. Delivery health remains separate and reports an unconfigured default transport until its configuration is complete. Saved sender profiles use their own credentials independently of that default transport.

Prepare the console before deploying it. Preparation builds the Worker and browser assets and records their SHA-256 checksums. Deployment consumes the prepared manifest, checks those files before uploading, and does not rebuild them. A changed artifact blocks deployment.

The following commands prepare the development target, run its regression checks, and deploy the prepared artifact. Configure the target's Cloudflare account and required secrets first.

```sh
pnpm cloudflare:prepare --target mbza-development --environment development
pnpm cloudflare:deploy:all --target mbza-development --environment development --prepared-deployment deploy/generated/mbza-development-development-deployments.json
```

To deploy only the console, use `pnpm cloudflare:deploy --service site` with the same target, environment, and `--prepared-deployment` arguments. Both active deployments and version uploads require the prepared manifest. Routing and read-only options must be selected during preparation because deployment preserves the validated configuration.

Run the development runtime test to check activation with production-style authentication checks. This test also runs as part of the Site test suite.

```sh
pnpm --dir apps/site run test:runtime:development
```
