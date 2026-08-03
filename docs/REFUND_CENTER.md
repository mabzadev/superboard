# Refund Center

Refund Center receives provider refund and dispute events, prepares evidence, and executes only actions explicitly approved by an administrator. It does not grant entitlements. Billing event projections remain the only source of entitlement changes.

## Action lifecycle

`draft -> approved -> queued -> sent`

A provider error moves an action to `failed`. Retryable errors are scheduled with exponential backoff for at most eight attempts. An administrator may correct a failed action, which returns it to `draft` and requires a new approval.

Every execution obtains a unique 10-minute database lease. Concurrent queue messages cannot call the provider for the same action. Stripe requests also use the action idempotency key. Provider responses stored in D1 contain only the bounded result needed for audit and diagnostics.

If queue submission fails after approval, the action remains `approved`. Scheduled reconciliation queues it later. Queue consumers acknowledge non-retryable validation failures and retry only transient failures.

## Human approval and evidence

- Apple consumption information requires an approved `apple_consumption_consent` evidence record and `customerConsented: true`. This consent is separate from App Tracking Transparency consent.
- Stripe dispute submission requires inline evidence or at least one approved evidence record.
- Evidence and provider actions stay editable only while they are drafts. A failed action may be corrected and submitted for approval again.
- Refund audit events are immutable in D1.

## Supported provider actions

The API is the source of truth for action definitions and default payloads. The dashboard reads `action_definitions` from the refund-case endpoint instead of duplicating provider rules.

- Apple: send consumption information.
- Google Play: refund an order with optional revocation; revoke a subscription with full, prorated, or item-based refund context.
- Stripe: submit dispute evidence; create a refund.

Provider contracts follow the official [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi/send-consumption-information), [Google Play Developer API](https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund), and [Stripe dispute evidence](https://docs.stripe.com/disputes/api) and [refund](https://docs.stripe.com/refunds) documentation.

## Google Voided Purchases reconciliation

Billing polls the official Voided Purchases API every 15 minutes with a one-hour overlap and a maximum 30-day initial window. It requests subscriptions and quantity-based partial refunds, follows provider page tokens, and checkpoints only after every page succeeds. A matched result is applied through the same canonical verified-purchase pipeline as RTDN. An unmatched result never changes an entitlement, remains a failed financial event that closes the release gate, and is retried after the local transaction arrives.

## Isolation

Only the Billing domain writes refund action state. Messaging, reputation, growth, and dashboard failures cannot execute provider actions. Provider credentials are decrypted only inside the financial execution path and are never returned to the dashboard or stored in audit payloads.
