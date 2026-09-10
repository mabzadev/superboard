-- Remove the retired Web payment provider while preserving native Store access.

CREATE TABLE removed_web_products AS
SELECT id FROM billing_products WHERE store = 'stripe';

CREATE TABLE removed_web_transactions AS
SELECT id FROM billing_transactions WHERE store = 'stripe';

CREATE TABLE removed_web_subscriptions AS
SELECT id FROM billing_subscriptions WHERE store = 'stripe';

CREATE TABLE removed_web_connections AS
SELECT id FROM billing_store_connections WHERE provider = 'stripe';

CREATE TABLE removed_web_refund_cases AS
SELECT id FROM billing_refund_cases WHERE provider = 'stripe';

CREATE TABLE removed_web_entitlements AS
SELECT DISTINCT project_id, customer_id, entitlement_id
FROM billing_customer_entitlements
WHERE product_id IN (SELECT id FROM removed_web_products);

DROP TRIGGER IF EXISTS billing_refund_audit_no_delete;
DROP TRIGGER IF EXISTS billing_store_credential_audit_no_delete;
DROP TRIGGER IF EXISTS billing_certification_observations_no_delete;
DROP TRIGGER IF EXISTS billing_certification_device_results_no_delete;
DROP TRIGGER IF EXISTS billing_product_canonicalization_audit_no_delete;

DELETE FROM billing_refund_audit_events
WHERE case_id IN (SELECT id FROM removed_web_refund_cases);
DELETE FROM billing_refund_evidence
WHERE case_id IN (SELECT id FROM removed_web_refund_cases);
DELETE FROM billing_refund_provider_actions
WHERE case_id IN (SELECT id FROM removed_web_refund_cases);
DELETE FROM billing_refund_deadlines
WHERE case_id IN (SELECT id FROM removed_web_refund_cases);
DELETE FROM billing_refund_cases
WHERE id IN (SELECT id FROM removed_web_refund_cases);

DELETE FROM billing_certification_observations
WHERE check_key LIKE 'stripe.%'
   OR run_id IN (SELECT id FROM billing_certification_runs WHERE platform = 'web');
DELETE FROM billing_certification_device_results
WHERE check_key LIKE 'stripe.%'
   OR run_id IN (SELECT id FROM billing_certification_runs WHERE platform = 'web');
DELETE FROM billing_certification_device_challenges
WHERE run_id IN (SELECT id FROM billing_certification_runs WHERE platform = 'web');
DELETE FROM billing_certification_runs WHERE platform = 'web';
DELETE FROM billing_release_gate_checks WHERE check_key LIKE 'stripe.%';

DELETE FROM billing_dead_letters
WHERE job_type LIKE 'billing.stripe.%'
   OR job_payload LIKE '%billing.stripe.%';

DELETE FROM billing_webhook_deliveries
WHERE transaction_id IN (SELECT id FROM removed_web_transactions);
DELETE FROM billing_balance_ledger
WHERE product_id IN (SELECT id FROM removed_web_products)
   OR transaction_id IN (SELECT id FROM removed_web_transactions);
DELETE FROM billing_events
WHERE provider = 'stripe'
   OR transaction_id IN (SELECT id FROM removed_web_transactions)
   OR subscription_id IN (SELECT id FROM removed_web_subscriptions);
DELETE FROM billing_webhook_events WHERE store = 'stripe';
DELETE FROM billing_customer_entitlements
WHERE product_id IN (SELECT id FROM removed_web_products);
DELETE FROM billing_subscriptions WHERE store = 'stripe';
DELETE FROM billing_transactions WHERE store = 'stripe';
DELETE FROM billing_product_canonicalization_audit
WHERE old_product_id IN (SELECT id FROM removed_web_products)
   OR canonical_product_id IN (SELECT id FROM removed_web_products);
DELETE FROM billing_products WHERE store = 'stripe';

-- Restore an affected entitlement from the strongest surviving verified native
-- source. If none exists, the entitlement remains absent and reconciliation
-- can only restore it after provider verification.
WITH latest_non_consumables AS (
  SELECT k.project_id, k.customer_id, k.entitlement_id,
    transaction_row.product_id, transaction_row.status,
    transaction_row.purchased_at AS starts_at, transaction_row.expires_at,
    0 AS will_renew,
    COALESCE(transaction_row.event_occurred_at, transaction_row.verified_at, transaction_row.created_at) AS observed_at,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_row.project_id, transaction_row.store,
        transaction_row.environment, transaction_row.original_transaction_id
      ORDER BY datetime(COALESCE(transaction_row.event_occurred_at, transaction_row.verified_at, transaction_row.created_at)) DESC,
        transaction_row.id DESC
    ) AS event_rank
  FROM removed_web_entitlements k
  JOIN billing_transactions transaction_row
    ON transaction_row.project_id = k.project_id
   AND transaction_row.customer_id = k.customer_id
   AND transaction_row.store IN ('apple', 'google')
   AND transaction_row.verified_at IS NOT NULL
  JOIN billing_products product
    ON product.id = transaction_row.product_id
   AND product.product_type = 'non_consumable'
  JOIN billing_product_entitlements mapping
    ON mapping.product_id = transaction_row.product_id
   AND mapping.entitlement_id = k.entitlement_id
), candidates AS (
  SELECT k.project_id, k.customer_id, k.entitlement_id,
    subscription.product_id, subscription.status, subscription.starts_at,
    subscription.expires_at, subscription.will_renew,
    COALESCE(subscription.latest_event_at, subscription.updated_at) AS observed_at
  FROM removed_web_entitlements k
  JOIN billing_subscriptions subscription
    ON subscription.project_id = k.project_id
   AND subscription.customer_id = k.customer_id
   AND subscription.store IN ('apple', 'google')
  JOIN billing_product_entitlements mapping
    ON mapping.product_id = subscription.product_id
   AND mapping.entitlement_id = k.entitlement_id
  WHERE subscription.status IN ('trialing', 'active', 'grace_period', 'billing_issue', 'cancelled')
    AND (subscription.expires_at IS NULL OR datetime(subscription.expires_at) > datetime('now'))
  UNION ALL
  SELECT project_id, customer_id, entitlement_id, product_id, status,
    starts_at, expires_at, will_renew, observed_at
  FROM latest_non_consumables
  WHERE event_rank = 1
    AND status IN ('trialing', 'active', 'grace_period', 'billing_issue', 'cancelled')
    AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
), ranked_candidates AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY project_id, customer_id, entitlement_id
    ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC,
      datetime(expires_at) DESC, datetime(observed_at) DESC
  ) AS candidate_rank
  FROM candidates
)
INSERT INTO billing_customer_entitlements (
  project_id, customer_id, entitlement_id, product_id, source, status,
  starts_at, expires_at, will_renew, verification
)
SELECT project_id, customer_id, entitlement_id, product_id, 'purchase', status,
  COALESCE(starts_at, datetime('now')), expires_at, will_renew, 'verified'
FROM ranked_candidates
WHERE candidate_rank = 1;

DELETE FROM billing_store_credential_audit
WHERE connection_id IN (SELECT id FROM removed_web_connections)
   OR provider = 'stripe';
DELETE FROM billing_store_notification_configurations WHERE provider = 'stripe';
DELETE FROM billing_admin_audit_logs
WHERE resource_id IN (SELECT id FROM removed_web_connections)
   OR lower(metadata) LIKE '%"provider":"stripe"%';

DROP TABLE IF EXISTS billing_redemptions;
DROP TABLE IF EXISTS billing_checkout_sessions;
DELETE FROM billing_store_connections WHERE provider = 'stripe';

UPDATE billing_legacy_subscription_inventory
SET provider = 'unsupported', resolution_status = 'unsupported_provider',
  matched_subscription_id = NULL,
  resolution_detail = 'The legacy subscription provider is no longer supported',
  updated_at = datetime('now')
WHERE provider = 'stripe';

DROP TABLE IF EXISTS stripe_webhook_messages;
DROP TABLE IF EXISTS stripe_payment_intents;
DROP TABLE IF EXISTS stripe_subscriptions;

ALTER TABLE billing_feature_flags DROP COLUMN web_billing;
ALTER TABLE instances DROP COLUMN stripe_customer_id;

CREATE TRIGGER billing_refund_audit_no_delete
BEFORE DELETE ON billing_refund_audit_events
BEGIN
  SELECT RAISE(ABORT, 'refund audit events are immutable');
END;

CREATE TRIGGER billing_store_credential_audit_no_delete
BEFORE DELETE ON billing_store_credential_audit
BEGIN
  SELECT RAISE(ABORT, 'billing store credential audit is immutable');
END;

CREATE TRIGGER billing_certification_observations_no_delete
BEFORE DELETE ON billing_certification_observations
BEGIN
  SELECT RAISE(ABORT, 'billing certification observations are immutable');
END;

CREATE TRIGGER billing_certification_device_results_no_delete
BEFORE DELETE ON billing_certification_device_results
BEGIN
  SELECT RAISE(ABORT, 'billing certification device results are immutable');
END;

CREATE TRIGGER billing_product_canonicalization_audit_no_delete
BEFORE DELETE ON billing_product_canonicalization_audit
BEGIN
  SELECT RAISE(ABORT, 'billing product canonicalization audit is immutable');
END;

CREATE TRIGGER billing_store_connections_supported_provider_insert
BEFORE INSERT ON billing_store_connections
WHEN NEW.provider NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

CREATE TRIGGER billing_store_connections_supported_provider_update
BEFORE UPDATE OF provider ON billing_store_connections
WHEN NEW.provider NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

CREATE TRIGGER billing_products_supported_store_insert
BEFORE INSERT ON billing_products
WHEN NEW.store NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

CREATE TRIGGER billing_products_supported_store_update
BEFORE UPDATE OF store ON billing_products
WHEN NEW.store NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

CREATE TRIGGER billing_transactions_supported_store_insert
BEFORE INSERT ON billing_transactions
WHEN NEW.store NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

CREATE TRIGGER billing_subscriptions_supported_store_insert
BEFORE INSERT ON billing_subscriptions
WHEN NEW.store NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

CREATE TRIGGER billing_webhook_events_supported_store_insert
BEFORE INSERT ON billing_webhook_events
WHEN NEW.store NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

CREATE TRIGGER billing_events_supported_provider_insert
BEFORE INSERT ON billing_events
WHEN NEW.provider NOT IN ('apple', 'google', 'promotional')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

CREATE TRIGGER billing_refund_cases_supported_provider_insert
BEFORE INSERT ON billing_refund_cases
WHEN NEW.provider NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported refund provider');
END;

CREATE TRIGGER billing_store_notifications_supported_provider_insert
BEFORE INSERT ON billing_store_notification_configurations
WHEN NEW.provider NOT IN ('apple', 'google')
BEGIN
  SELECT RAISE(ABORT, 'unsupported notification provider');
END;

CREATE TRIGGER billing_legacy_inventory_supported_provider_insert
BEFORE INSERT ON billing_legacy_subscription_inventory
WHEN NEW.provider NOT IN ('apple', 'google', 'unsupported')
BEGIN
  SELECT RAISE(ABORT, 'unsupported legacy provider');
END;

DROP TABLE removed_web_entitlements;
DROP TABLE removed_web_refund_cases;
DROP TABLE removed_web_connections;
DROP TABLE removed_web_subscriptions;
DROP TABLE removed_web_transactions;
DROP TABLE removed_web_products;
