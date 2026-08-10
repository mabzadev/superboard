# Billing Worker controlled cutover

## Current state

The financial domain is deployed in the private `opengrow-billing` Worker. It has no public route and no `workers.dev` hostname. The API reaches it only through a Cloudflare service binding.

Purchase traffic starts in `local` mode while the private Worker and its dependencies are deployed and verified. The controlled technical cutover to `service` mode happens before the final device certification so that certification exercises the real production architecture. Public release remains blocked until the complete Apple, Google Play, FlutterFlow, and legacy-subscription gate passes.

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
- In `service` mode, `opengrow-billing` resolves the authenticated customer context, signs CustomerInfo, and executes financial writes, receipt verification, restoration, reconciliation, and provider actions.
- In `service` mode, `opengrow-billing` is also the only active consumer of the Billing queue. The API remains a producer but never executes or consumes financial jobs.
- The dashboard and Messaging cannot assign an entitlement directly.
- The legacy purchase provider remains enabled until the complete device matrix and subscription inventory pass.

## Runtime flow

```text
FlutterFlow / SDK
  -> OpenGrow API (gateway-issued JWT)
  -> private service binding
  -> Billing Worker (customer resolution + signed CustomerInfo)
  -> Apple / Google Play
  -> immutable billing event + projections
```

Webhooks acknowledge only after signature verification and durable persistence. Business processing, retries, DLQ handling, and replay are asynchronous and idempotent.

Outbound application projections are persisted in D1 before Queue dispatch. A two-minute delivery lease prevents concurrent consumers from sending the same delivery, and the immutable delivery identifier remains the consumer idempotency key if a Worker stops after the external response but before recording it. Response previews are read with a strict byte limit. Retryable application responses, including an explicitly retryable missing-user response, retain bounded backoff; terminal responses enter the audited Billing quarantine path.

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

`npm run cloudflare:config:billing` generates the API and Billing manifests together and fails unless exactly one execution domain owns the main Billing queue. In `service` mode, the generated Billing consumer must include the Billing DLQ, eight retries, and scheduled reconciliation. In `local` compatibility mode, the API owns main-queue execution and scheduled reconciliation. The Billing Worker remains the only DLQ consumer in both modes so failed financial jobs are durably quarantined without being executed.

The DLQ consumer persists a bounded payload and SHA-256 digest before acknowledging the Cloudflare message. The dashboard never receives the retained payload. Owner and administrator actions can replay a structurally valid, digest-verified job or discard it; both actions are atomic and audited. Any quarantined project job degrades Billing health and blocks the Purchases release gate until it is handled.

After this technical cutover, run the complete certification matrix through `service` mode. Do not publish until the Purchases Diagnostics release gate includes:

1. Approved and purchasable weekly and yearly products.
2. Production and sandbox App Store Server Notification URLs verified as direct V2 Billing ingress endpoints.
3. Google Pub/Sub authenticated push observed with the expected OIDC identity and audience; a URL token is insufficient.
4. Apple Sandbox/TestFlight device evidence.
5. Google Play License Testing/Internal device evidence routed to the test project from provider-verified purchase markers.
6. Duplicate and out-of-order event evidence.
7. Store, OpenGrow, and application projection convergence.
8. Complete legacy subscription inventory and import.
9. FlutterFlow iOS and Android recovery tests.
10. Empty DLQ and active alerts throughout the observation window.

Manual free-text approval is not certification evidence. Each passed check must reference an immutable observation from a completed certification run. A run records the platform, environment, build, application and SDK versions, device model, OS version, operator, and server timestamps. Each observation stores a bounded evidence snapshot and its SHA-256 digest.

Every Apple and Google Play scenario requires an authenticated SDK result from the matching real-device run. Provider-backed scenarios, including purchase, trial, renewal, plan change, expiration, and refund, require two independent references in the same immutable observation: the provider-verified transaction or Billing event and the authenticated device result. Device-state scenarios use the authenticated device result as their primary reference. Paywall telemetry cannot certify pending, cancellation, or restoration behavior.

Start the run in Purchases Diagnostics, copy the expiring run-scoped challenge into the temporary FlutterFlow certification action, and submit the required structured assertions from the matching build. The challenge is stored only as a hash, is claimed by the first verified customer, may be reused only by that customer for the remaining scenarios in the same run, and must never be embedded in a release build.

Billing transaction and event references are accepted only when the backend can resolve them in the run's project, provider, environment, and time window. Legacy inventory references must identify a completed production inventory with no unresolved active subscription. Authenticated SDK results must match the run, scenario, outcome, project, platform, build, customer claim, and evidence digest. Historical native observations without that device result fail closed. Arbitrary external test references are rejected. Completing, failing, or cancelling a run prevents additional observations.

## Cutover procedure

1. Back up D1 and record the deployed API and Billing version IDs.
2. Run `npm run billing:check` and `npm run worker:check`.
3. Verify `/health/billing` and the required secret names.
4. Run `npm run cloudflare:billing-preflight`. This read-only command verifies all required D1 migrations, financial failure and stale-work counters, the live main-queue and DLQ consumers, private Worker readiness, routing mode, public ES256 JWKS documents, and Billing secret names. A blocked result must never be overridden manually.
5. Set `billingExecutionMode` to `service` and run `npm run cloudflare:config:billing`.
6. Generate the Billing preflight manifest with `node scripts/cloudflare-config.mjs --target <target> --service billing --environment production --preflight`, then deploy it. This installs the compatible Billing code and queue-name variables without changing queue consumers or cron ownership.
7. Run `npm run cloudflare:billing-consumer` to inspect the live main-queue owner. Review its exact confirmation value before any mutation.
8. Move the live main-queue consumer with `npm run cloudflare:billing-consumer -- --execute --confirm <exact-value>`. The command pauses delivery, removes the old consumer, adds and verifies the dedicated consumer, resumes delivery, and attempts rollback if the move fails. Messages remain durable while delivery is paused.
9. Regenerate the full Billing manifest with `npm run cloudflare:config:billing`. Deploy Billing to attach the main queue, DLQ consumer, and cron, then deploy the API without the financial consumer. Never attach both Workers to the same queue.
10. Run `npm run cloudflare:billing-preflight` again and require a fully ready result before opening device certification.
11. Verify signed CustomerInfo delegation, scheduled reconciliation, and empty Billing quarantine.
12. Run the complete device matrix, including one Sandbox purchase per native Store, restoration, and recovery.
13. Monitor validation success, latency, pending events, retries, quarantine, and entitlement divergence.
14. Remove the legacy purchase dependency only in a separate release after the public release gate and observation window pass.

## Rollback

Set the target environment's `billingExecutionMode` back to `local`, regenerate both manifests, and use the same confirmed consumer command to return queue ownership to the API before deploying the local-mode API. Do not edit immutable events and do not delete queued messages; they are required for replay. Restore the Billing Worker and D1 backup independently only when necessary. A routing rollback never changes the application authentication authority.
