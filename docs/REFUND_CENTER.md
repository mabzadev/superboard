# Refund Center

Refund Center receives provider refund and dispute events, prepares evidence, and executes only actions explicitly approved by an administrator. It does not grant entitlements. Billing event projections remain the only source of entitlement changes.

## Action lifecycle

`draft -> approved -> queued -> sent`

A provider error moves an action to `failed`. Retryable errors are scheduled with exponential backoff for at most eight attempts. An administrator may correct a failed action, which returns it to `draft` and requires a new approval.

Every execution obtains a unique 10-minute database lease. Concurrent queue messages cannot call the provider for the same action. Outbound provider calls have a 15-second timeout, and response bodies are limited to 64 KB before parsing. Provider responses stored in D1 contain only the bounded result needed for audit and diagnostics.

If queue submission fails after approval, the action remains `approved`. Scheduled reconciliation queues it later. Terminal queue failures are persisted in the Billing quarantine before acknowledgement; transient failures remain retryable.

## Human approval and evidence

- Apple consumption information requires an approved `apple_consumption_consent` evidence record and `customerConsented: true`. This consent is separate from App Tracking Transparency consent.
- Apple consumption deadlines are derived from the immutable provider event time. Delayed delivery or replay cannot extend the response window.
- Evidence and provider actions stay editable only while they are drafts. A failed action may be corrected and submitted for approval again.
- The approval state and its administrator audit event are committed in one D1 batch. A provider action cannot become approved without the matching immutable audit record.
- Refund audit events are immutable in D1.

## Supported provider actions

The API is the source of truth for action definitions and default payloads. The dashboard reads `action_definitions` from the refund-case endpoint instead of duplicating provider rules.

- Apple: send consumption information.
- Google Play: respond to a pending chargeback review with a refund preference and validated usage evidence; refund an order with optional revocation; revoke a subscription with full, prorated, or item-based refund context.

Provider contracts follow the official [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi/send-consumption-information), Google Play [`orders.reviewrefund`](https://developers.google.com/android-publisher/api-ref/rest/v3/orders/reviewrefund), [`orders.refund`](https://developers.google.com/android-publisher/api-ref/rest/v3/orders/refund), and [subscription revoke](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/revoke) contracts.

## Google pending chargeback reviews

Authenticated `PendingRefundReviewNotification` messages are persisted before queue delivery. Billing links the order to an existing transaction when possible, but still opens an unresolved case when the order has not arrived locally yet. Each case receives a deadline exactly 24 hours after the provider event and a `review_google_refund` draft. The draft defaults to `NEUTRAL`; it is never sent until an administrator reviews the evidence and approves the action.

The action validator enforces the provider enum, a 0–100,000 milliunit consumption percentage, at most 1,000 usage events, RFC 3339 timestamps, the 5,000-character description limit, and an allowlisted coarse-location structure. The pending token is copied from the authenticated notification and cannot be inferred from client data.

## Google Voided Purchases reconciliation

Billing polls the official Voided Purchases API every 15 minutes with a one-hour overlap and a maximum 30-day initial window. It requests subscriptions and quantity-based partial refunds, follows provider page tokens, and checkpoints only after every page succeeds. A matched result is applied through the same canonical verified-purchase pipeline as RTDN. An unmatched result never changes an entitlement, remains a failed financial event that closes the release gate, and is retried after the local transaction arrives.

## Isolation

Only the Billing domain writes refund action state. Messaging and dashboard failures cannot execute provider actions. Provider credentials are decrypted only inside the financial execution path and are never returned to the dashboard or stored in audit payloads.
