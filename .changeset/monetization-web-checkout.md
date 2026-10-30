---
"@superboard/web": minor
---

Adds authenticated Stripe Checkout and customer portal methods to `SuperBoardClient`, alongside purchase offerings and ES256-verified customer access. Configure the Stripe connection and product mappings on a SuperBoard server with the Stripe web purchases migration before calling these methods.

Adds optional `appVersion` and `language` client options for the billing customer profile. Language defaults to the browser locale. Reuse the `createCheckoutSession` idempotency key when retrying the same checkout attempt.
