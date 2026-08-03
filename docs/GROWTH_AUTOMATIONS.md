# Growth automation delivery

Growth automations are isolated from Billing. They can create communications or operational alerts, but they cannot grant, revoke, or edit an entitlement.

The Growth Worker owns the trigger and action compatibility contract. The dashboard reads this contract and only presents valid choices. The Worker validates the same compatibility again when an automation is created or updated, and event evaluation ignores any incompatible legacy row.

## Negative store reviews

Apple and Google review APIs do not expose a trustworthy internal application-user identity. A negative store review must therefore never trigger chat, push, or in-app delivery to an assumed user.

The `review_negative` trigger supports only the `inbox` action:

1. A new one- or two-star review revision is persisted before any automation work is queued.
2. The API emits an idempotent Growth event using the revision identifier.
3. The event contains store metadata, rating, sentiment, and category. It excludes the raw provider payload and the review text.
4. An active matching automation creates an idempotent internal Inbox alert.
5. The Inbox enriches the existing store-review projection with the alert instead of creating a duplicate list item.
6. Publishing a response, or discovering an existing provider response during synchronization, closes the alert.

Failed projections use bounded exponential backoff. Maintenance re-enqueues recent unprojected negative revisions, and deterministic event and run identifiers prevent duplicate alerts during replay.

## Delivery safety

- Every automation run is claimed before delivery.
- Delivery receipts are idempotent by run identifier.
- Retryable failures release the run for a later attempt.
- Terminal failures are recorded without changing financial state.
- Internal Inbox alerts reference the source review and remain outside Billing tables.
