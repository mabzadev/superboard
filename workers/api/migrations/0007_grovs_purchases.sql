-- Grovs Purchases: verified, multi-tenant purchase and entitlement source of truth.

ALTER TABLE ios_configurations ADD COLUMN app_apple_id INTEGER;

CREATE TABLE IF NOT EXISTS billing_project_settings (
  project_id TEXT PRIMARY KEY,
  restore_behavior TEXT NOT NULL DEFAULT 'transfer',
  purchases_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_oidc_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  audience TEXT NOT NULL,
  jwks_uri TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, issuer, audience)
);

CREATE TABLE IF NOT EXISTS billing_customers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  primary_app_user_id TEXT NOT NULL,
  anonymous INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  attributes TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, primary_app_user_id)
);

CREATE TABLE IF NOT EXISTS billing_customer_aliases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  app_user_id TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'identified',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE CASCADE,
  UNIQUE(project_id, app_user_id)
);

CREATE TABLE IF NOT EXISTS billing_products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  store TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  store_product_id TEXT NOT NULL,
  product_type TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  UNIQUE(project_id, store, environment, store_product_id)
);

CREATE TABLE IF NOT EXISTS billing_entitlements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_product_entitlements (
  product_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(product_id, entitlement_id),
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE CASCADE,
  FOREIGN KEY (entitlement_id) REFERENCES billing_entitlements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_offerings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  placement TEXT NOT NULL DEFAULT 'default',
  is_current INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_packages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  offering_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  package_type TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offering_id) REFERENCES billing_offerings(id) ON DELETE CASCADE,
  UNIQUE(offering_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_package_products (
  package_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(package_id, product_id),
  FOREIGN KEY (package_id) REFERENCES billing_packages(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  customer_id TEXT,
  product_id TEXT,
  store TEXT NOT NULL,
  environment TEXT NOT NULL,
  store_transaction_id TEXT NOT NULL,
  original_transaction_id TEXT,
  order_id TEXT,
  purchase_token TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  price_micros INTEGER,
  currency TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  purchased_at TEXT,
  expires_at TEXT,
  verified_at TEXT,
  raw_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE SET NULL,
  UNIQUE(project_id, store, environment, store_transaction_id, event_type)
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  customer_id TEXT,
  product_id TEXT,
  store TEXT NOT NULL,
  environment TEXT NOT NULL,
  original_transaction_id TEXT NOT NULL,
  latest_transaction_id TEXT,
  status TEXT NOT NULL,
  period_type TEXT NOT NULL DEFAULT 'normal',
  starts_at TEXT,
  expires_at TEXT,
  grace_expires_at TEXT,
  auto_renews INTEGER NOT NULL DEFAULT 0,
  will_renew INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE SET NULL,
  UNIQUE(project_id, store, environment, original_transaction_id)
);

CREATE TABLE IF NOT EXISTS billing_customer_entitlements (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  entitlement_id TEXT NOT NULL,
  product_id TEXT,
  source TEXT NOT NULL DEFAULT 'purchase',
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  will_renew INTEGER NOT NULL DEFAULT 0,
  verification TEXT NOT NULL DEFAULT 'verified',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE CASCADE,
  FOREIGN KEY (entitlement_id) REFERENCES billing_entitlements(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE SET NULL,
  UNIQUE(customer_id, entitlement_id, source)
);

CREATE TABLE IF NOT EXISTS billing_balance_ledger (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  product_id TEXT,
  transaction_id TEXT,
  currency_identifier TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE SET NULL,
  FOREIGN KEY (transaction_id) REFERENCES billing_transactions(id) ON DELETE SET NULL,
  UNIQUE(project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  store TEXT NOT NULL,
  environment TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  error_message TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  UNIQUE(project_id, store, environment, external_event_id)
);

CREATE TABLE IF NOT EXISTS billing_webhook_endpoints (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  signing_secret_encrypted TEXT NOT NULL,
  environments TEXT NOT NULL DEFAULT '["production"]',
  event_types TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_webhook_deliveries (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  endpoint_id TEXT NOT NULL,
  transaction_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  response_status INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT,
  FOREIGN KEY (endpoint_id) REFERENCES billing_webhook_endpoints(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES billing_transactions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_project ON billing_customers(project_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_billing_alias_customer ON billing_customer_aliases(customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_products_project ON billing_products(project_id, active);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_customer ON billing_transactions(customer_id, purchased_at);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_original ON billing_transactions(project_id, original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer ON billing_subscriptions(customer_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_billing_entitlements_customer ON billing_customer_entitlements(customer_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_status ON billing_webhook_events(status, received_at);
CREATE INDEX IF NOT EXISTS idx_billing_deliveries_retry ON billing_webhook_deliveries(status, next_attempt_at);
