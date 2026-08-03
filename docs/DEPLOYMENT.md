# OpenGrow deployment

This document is the deployment source of truth for the unified OpenGrow dashboard and its isolated Cloudflare Workers.

## Services

- Dashboard: unified operator interface.
- API: public OAuth, project configuration, SDK ingress, webhook signature verification, and service orchestration.
- Billing: private financial execution through service binding.
- Messaging: conversations, attachments, Durable Objects, and WebSockets.
- Growth: Store intelligence, keywords, competitors, and automation delivery.

Billing, Messaging, and Growth use separate execution boundaries. Messaging or Growth failures cannot grant, revoke, retry, or roll back an entitlement.

## Configuration generation

Generate deployment configuration from the registered target. Do not hand-edit files under `deploy/generated`.

```bash
npm run cloudflare:config:api
npm run cloudflare:config:dashboard
npm run billing:types
npm run growth:types
```

All production secrets belong in Cloudflare secrets. Do not commit credentials, private keys, webhook secrets, access tokens, or exported D1 backups.

## Verification

```bash
npm run typecheck
npm run test
npm run billing:check
npm run messaging:check
npm run growth:check
npm run worker:check
npm run dashboard:cf-build
```

For Purchases, these commands prove code and runtime compatibility only. They do not replace Apple, Google Play, Stripe, or real-device certification evidence.

## Database changes

Before production migrations:

1. Generate the API configuration.
2. Run `node scripts/cloudflare-d1-backup.mjs --target <target> --database d1`.
3. Confirm that the backup completed.
4. Apply migrations with `npm run worker:migrate:prod`.
5. Deploy private Workers before the API when an API version depends on new private endpoints.

Backups are local recovery artifacts. The target operator must configure encrypted offsite retention separately.

## Deployment order

1. D1 backup and additive migrations.
2. Billing Worker.
3. Messaging and Growth Workers when changed.
4. API Worker.
5. Dashboard.
6. Production health checks and authenticated dashboard verification.

## Purchases release control

Keep the target environment's `billingExecutionMode` set to `local` while deploying and verifying the private Billing Worker. Follow [Billing Worker controlled cutover](./BILLING_WORKER_CUTOVER.md) to switch the typed manifest to `service` before device certification. Public release remains blocked until Purchases Diagnostics is fully green. Remove the legacy purchase dependency only in a separate release after the observation window passes.

## Rollback

Worker, dashboard, and D1 rollback are independent. Prefer a Worker version rollback first. Restore D1 only when the data itself is incorrect and the exact backup target has been verified. Never delete immutable Billing events or queued jobs during rollback.
