# Billing Worker controlled cutover

## Current state

The financial domain is deployed in the private `opengrow-billing` Worker. It has no public route and no `workers.dev` hostname. The API reaches it only through a Cloudflare service binding.

Purchase traffic intentionally remains in `local` mode until the Apple, Google Play, Stripe, FlutterFlow, and legacy-subscription certification gates are complete. The private Worker is ready, but it is not yet the production execution path.

Readiness is exposed through `GET /health/billing`. The response must report:

- `ready_for_traffic: true`;
- `credential_copies_ready: true`;
- `credential_decryption_ready: true`;
- no missing Billing secrets.

The endpoint must never return private keys, certificates, Store credentials, or decrypted values.

## Authority boundaries

- `api-auth-gateway` remains the only application authentication authority.
- OpenGrow verifies the short-lived ES256 JWT issued by that gateway and does not create a second application identity.
- In `service` mode, `opengrow-billing` executes financial writes, receipt verification, Stripe Checkout, Billing Portal, redemption, reconciliation, and provider actions.
- Stripe credentials have separate API and Billing ciphertexts. Each execution domain can decrypt only its own copy.
- The dashboard, Messaging, Reputation, and Growth cannot assign an entitlement directly.
- The legacy purchase provider remains enabled until the complete device matrix and subscription inventory pass.

## Runtime flow

```text
FlutterFlow / SDK
  -> OpenGrow API (gateway-issued JWT)
  -> private service binding
  -> Billing Worker
  -> Apple / Google Play
  -> immutable billing event + projections

Stripe Web
  -> API signature verification and durable queue
  -> Billing Worker
  -> Stripe Checkout / Portal / provider event processing
  -> immutable billing event + projections
```

Webhooks acknowledge only after signature verification and durable persistence. Business processing, retries, DLQ handling, and replay are asynchronous and idempotent.

## Required Billing secrets

- `APPLE_ROOT_CERTIFICATES_B64`
- `OPENGROW_ENTITLEMENT_WEBHOOK_SECRET`
- `PURCHASES_SIGNING_KEYSET`
- `STORE_CREDENTIALS_ENCRYPTION_KEYS`

Secret values must be configured through Cloudflare secrets. They must never be committed, placed in Wrangler variables, returned by an API, or written to logs.

## Cutover gate

Do not set `BILLING_EXECUTION_MODE=service` until all automated prerequisites and all device/provider checks in Purchases Diagnostics are green. This includes:

1. Approved and purchasable weekly and yearly products.
2. Apple Sandbox/TestFlight device evidence.
3. Google Play License Testing/Internal device evidence.
4. Stripe Test Mode Checkout, renewal, failure, Portal, refund, and dispute evidence.
5. Duplicate and out-of-order event evidence.
6. Store, OpenGrow, Stripe, and application projection convergence.
7. Complete legacy subscription inventory and import.
8. FlutterFlow iOS and Android recovery tests.
9. Empty DLQ, active alerts, and a verified recent D1 backup.

## Cutover procedure

1. Back up D1 and record the deployed API and Billing version IDs.
2. Run `npm run billing:check`, `npm run worker:check`, and the complete device matrix.
3. Verify `/health/billing` and the required secret names.
4. Deploy Billing first, then deploy the API with `BILLING_EXECUTION_MODE=service`.
5. Run one Sandbox purchase per native Store, one restoration, and one Stripe Test event.
6. Monitor validation success, latency, pending events, retries, DLQ, and entitlement divergence.
7. Remove the legacy purchase dependency only in a separate release after the observation window passes.

## Rollback

Redeploy the API with `BILLING_EXECUTION_MODE=local`. Do not edit immutable events and do not delete queued messages; they are required for replay. Restore the Billing Worker and D1 backup independently only when necessary. A routing rollback never changes the application authentication authority.
