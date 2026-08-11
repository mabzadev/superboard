-- Remove the last application-branded runtime setting from the common Billing
-- delivery ledger. The generic secret must be uploaded before this migration is
-- deployed; production deployment gates verify its presence.
UPDATE billing_webhook_endpoints
SET signing_secret_encrypted = 'env:OPENGROW_ENTITLEMENT_WEBHOOK_SECRET'
WHERE signing_secret_encrypted = 'env:OPENGROW_VOCOSTAR_WEBHOOK_SECRET';
