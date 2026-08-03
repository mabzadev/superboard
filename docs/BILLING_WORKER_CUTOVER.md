# Billing Worker controlled cutover

## Current state

The financial domain is deployed in the private `opengrow-billing` Worker. It has no public route and no `workers.dev` hostname. The API reaches it only through a Cloudflare service binding.

Purchase traffic starts in `local` mode while the private Worker and its dependencies are deployed and verified. The controlled technical cutover to `service` mode happens before the final device certification so that certification exercises the real production architecture. Public release remains blocked until the complete Apple, Google Play, Stripe, FlutterFlow, and legacy-subscription gate passes.

Readiness is exposed through `GET /health/billing`. The response must report:

- `ready_for_traffic: true`;
- `credential_copies_ready: true`;
- `credential_decryption_ready: true`;
- `signing_authority_ready: true`;
- no missing Billing secrets.

The endpoint must never return private keys, certificates, Store credentials, or decrypted values.

## Authority boundaries

- `api-auth-gateway` remains the only application authentication authority.
- OpenGrow verifies the short-lived ES256 JWT issued by that gateway and does not create a second application identity.
- In `service` mode, `opengrow-billing` resolves the authenticated customer context, signs CustomerInfo, and executes financial writes, receipt verification, restoration, Stripe Checkout, Billing Portal, redemption, reconciliation, and provider actions.
- Stripe credentials have separate API and Billing ciphertexts. Each execution domain can decrypt only its own copy.
- The dashboard, Messaging, Reputation, and Growth cannot assign an entitlement directly.
- The legacy purchase provider remains enabled until the complete device matrix and subscription inventory pass.

## Runtime flow

```text
FlutterFlow / SDK
  -> OpenGrow API (gateway-issued JWT)
  -> private service binding
  -> Billing Worker (customer resolution + signed CustomerInfo)
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

## Technical cutover gate

Set the target environment's typed `billingExecutionMode` property to `service` only after these automated prerequisites are green:

1. A recent verified D1 backup exists.
2. `npm run billing:check` and `npm run worker:check` pass.
3. `/health/billing` reports every readiness field as ready, including `signing_authority_ready`.
4. Required service bindings, queues, DLQs, and secrets exist.
5. The private Billing endpoints and public JWKS delegation pass smoke tests.
6. Monitoring and a tested `local` routing rollback are available.

After this technical cutover, run the complete certification matrix through `service` mode. Do not publish until the Purchases Diagnostics release gate includes:

1. Approved and purchasable weekly and yearly products.
2. Apple Sandbox/TestFlight device evidence.
3. Google Play License Testing/Internal device evidence.
4. Stripe Test Mode Checkout, renewal, failure, Portal, refund, and dispute evidence.
5. Duplicate and out-of-order event evidence.
6. Store, OpenGrow, Stripe, and application projection convergence.
7. Complete legacy subscription inventory and import.
8. FlutterFlow iOS and Android recovery tests.
9. Empty DLQ and active alerts throughout the observation window.

Manual free-text approval is not certification evidence. Each passed check must reference an immutable observation from a completed certification run. A run records the platform, environment, build, application and SDK versions, device model, OS version, operator, and server timestamps. Each observation stores a bounded evidence snapshot and its SHA-256 digest.

Billing transaction and event references are accepted only when the backend can resolve them in the run's project, provider, environment, and time window. Legacy inventory references must identify a completed production inventory with no unresolved active subscription. Device-only scenarios may use an external test-run reference, but it is still sealed inside the immutable observation. Completing, failing, or cancelling a run prevents additional observations.

## Cutover procedure

1. Back up D1 and record the deployed API and Billing version IDs.
2. Run `npm run billing:check` and `npm run worker:check`.
3. Verify `/health/billing` and the required secret names.
4. Deploy Billing first, set `billingExecutionMode` to `service` in the typed target manifest, then deploy the API.
5. Verify the public JWKS and signed CustomerInfo delegation before opening device certification.
6. Run the complete device matrix, including one Sandbox purchase per native Store, restoration, recovery, and Stripe Test events.
7. Monitor validation success, latency, pending events, retries, DLQ, and entitlement divergence.
8. Remove the legacy purchase dependency only in a separate release after the public release gate and observation window pass.

## Rollback

Set the target environment's `billingExecutionMode` back to `local` and redeploy the API. Do not edit immutable events and do not delete queued messages; they are required for replay. Restore the Billing Worker and D1 backup independently only when necessary. A routing rollback never changes the application authentication authority.
