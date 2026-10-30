DROP TRIGGER IF EXISTS billing_store_connections_supported_provider_insert;
CREATE TRIGGER billing_store_connections_supported_provider_insert
BEFORE INSERT ON billing_store_connections
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

DROP TRIGGER IF EXISTS billing_store_connections_supported_provider_update;
CREATE TRIGGER billing_store_connections_supported_provider_update
BEFORE UPDATE OF provider ON billing_store_connections
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

DROP TRIGGER IF EXISTS billing_products_supported_store_insert;
CREATE TRIGGER billing_products_supported_store_insert
BEFORE INSERT ON billing_products
WHEN NEW.store NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

DROP TRIGGER IF EXISTS billing_products_supported_store_update;
CREATE TRIGGER billing_products_supported_store_update
BEFORE UPDATE OF store ON billing_products
WHEN NEW.store NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

DROP TRIGGER IF EXISTS billing_transactions_supported_store_insert;
CREATE TRIGGER billing_transactions_supported_store_insert
BEFORE INSERT ON billing_transactions
WHEN NEW.store NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

DROP TRIGGER IF EXISTS billing_subscriptions_supported_store_insert;
CREATE TRIGGER billing_subscriptions_supported_store_insert
BEFORE INSERT ON billing_subscriptions
WHEN NEW.store NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

DROP TRIGGER IF EXISTS billing_webhook_events_supported_store_insert;
CREATE TRIGGER billing_webhook_events_supported_store_insert
BEFORE INSERT ON billing_webhook_events
WHEN NEW.store NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing store');
END;

DROP TRIGGER IF EXISTS billing_events_supported_provider_insert;
CREATE TRIGGER billing_events_supported_provider_insert
BEFORE INSERT ON billing_events
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe', 'promotional')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

DROP TRIGGER IF EXISTS billing_refund_cases_supported_provider_insert;
CREATE TRIGGER billing_refund_cases_supported_provider_insert
BEFORE INSERT ON billing_refund_cases
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported refund provider');
END;

DROP TRIGGER IF EXISTS billing_store_notifications_supported_provider_insert;
CREATE TRIGGER billing_store_notifications_supported_provider_insert
BEFORE INSERT ON billing_store_notification_configurations
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe')
BEGIN
  SELECT RAISE(ABORT, 'unsupported notification provider');
END;


CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  connection_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  package_id TEXT,
  product_id TEXT,
  provider_session_id TEXT,
  provider_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  checkout_url TEXT,
  success_url TEXT,
  cancel_url TEXT,
  idempotency_key TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (connection_id) REFERENCES billing_store_connections(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES billing_packages(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE SET NULL,
  UNIQUE(project_id, idempotency_key),
  UNIQUE(connection_id, provider_session_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_customer ON billing_checkout_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_product ON billing_checkout_sessions(product_id);
CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_package ON billing_checkout_sessions(package_id);
