# Cloudflare console deployment

An active SuperBoard console enables the signed release operations used by plugin activation. Provision `SUPERBOARD_RELEASE_PRIVATE_JWK` on the Site Worker before deploying it. The development secret generator creates an independent ES256 signing key for this purpose; retain the private key in the deployment secret store across upgrades.

Deployment configuration derives this behavior from the target's active public routing. Private builds and preflight builds keep release operations disabled. To publish an explicitly read-only console, pass `--read-only-console` to `cloudflare-deploy-all.mjs`, `cloudflare-consolidate.mjs`, or `cloudflare-site-build.mjs`. An explicitly read-only console cannot activate plugins.

After deployment, sign in to EmDash and activate a plugin from the Plugins page. If verification has expired, complete the passkey prompt to resume the activation. Check that the plugin is active after reloading the page. A successful HTTP health check alone does not verify plugin activation.

Run the development runtime test to check activation with production-style authentication checks. This test also runs as part of the Site test suite.

```sh
pnpm --dir apps/site run test:runtime:development
```
