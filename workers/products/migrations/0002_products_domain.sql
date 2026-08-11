PRAGMA foreign_keys = ON;

CREATE TABLE financial_customers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, external_customer_id)
);
CREATE INDEX financial_customers_project ON financial_customers(project_id, created_at DESC);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  product_type TEXT NOT NULL CHECK(product_type IN ('subscription','non_consumable','consumable')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, identifier)
);
CREATE INDEX products_project_status ON products(project_id, status, updated_at DESC);

CREATE TABLE store_products (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK(store IN ('apple','google','stripe','manual')),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  store_product_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  price_micros INTEGER,
  currency TEXT,
  billing_period TEXT,
  trial_period TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, store, environment, store_product_id)
);
CREATE INDEX store_products_product ON store_products(project_id, product_id, active);

CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, identifier)
);
CREATE INDEX packages_project ON packages(project_id, active, position, updated_at DESC);

ALTER TABLE offerings ADD COLUMN identifier TEXT;
ALTER TABLE offerings ADD COLUMN description TEXT;
ALTER TABLE offerings ADD COLUMN created_at TEXT;
CREATE UNIQUE INDEX offerings_identifier ON offerings(project_id, identifier) WHERE identifier IS NOT NULL;

CREATE TABLE offering_packages (
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(offering_id, package_id)
);
CREATE INDEX offering_packages_order ON offering_packages(offering_id, position);

ALTER TABLE entitlements ADD COLUMN description TEXT;
ALTER TABLE entitlements ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE entitlements ADD COLUMN created_at TEXT;
ALTER TABLE entitlements ADD COLUMN updated_at TEXT;

CREATE TABLE entitlement_products (
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(entitlement_id, product_id)
);
CREATE INDEX entitlement_products_product ON entitlement_products(product_id, entitlement_id);

ALTER TABLE purchases ADD COLUMN store TEXT;
ALTER TABLE purchases ADD COLUMN environment TEXT;
ALTER TABLE purchases ADD COLUMN external_transaction_id TEXT;
ALTER TABLE purchases ADD COLUMN original_transaction_id TEXT;
ALTER TABLE purchases ADD COLUMN purchased_price_micros INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN currency TEXT;
ALTER TABLE purchases ADD COLUMN expires_at TEXT;
ALTER TABLE purchases ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX purchases_external_transaction ON purchases(project_id, store, environment, external_transaction_id) WHERE external_transaction_id IS NOT NULL;
CREATE INDEX purchases_status ON purchases(project_id, status, purchased_at DESC);

CREATE TABLE purchase_entitlements (
  purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  PRIMARY KEY(purchase_id, entitlement_id)
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  financial_customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  latest_purchase_id TEXT REFERENCES purchases(id),
  store TEXT NOT NULL CHECK(store IN ('apple','google','stripe','manual')),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  original_transaction_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('trialing','active','grace_period','paused','expired','cancelled','refunded')),
  current_period_started_at TEXT,
  current_period_ends_at TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 1 CHECK(auto_renew IN (0,1)),
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, store, environment, original_transaction_id)
);
CREATE INDEX subscriptions_customer ON subscriptions(project_id, financial_customer_id, status, updated_at DESC);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  external_refund_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('requested','processing','completed','rejected','cancelled')),
  amount_micros INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, external_refund_id)
);
CREATE INDEX refunds_purchase ON refunds(project_id, purchase_id, requested_at DESC);

CREATE TABLE store_sync_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  store TEXT NOT NULL CHECK(store IN ('apple','google','stripe','manual')),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  deactivated_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json))
);
CREATE INDEX store_sync_runs_project ON store_sync_runs(project_id, started_at DESC);

CREATE TABLE idempotency_keys (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, key)
);

ALTER TABLE audit_events ADD COLUMN actor_id TEXT;
ALTER TABLE audit_events ADD COLUMN entity_type TEXT;
ALTER TABLE audit_events ADD COLUMN entity_id TEXT;
ALTER TABLE audit_events ADD COLUMN request_id TEXT;
ALTER TABLE audit_events ADD COLUMN occurred_at TEXT;
CREATE INDEX products_audit_project ON audit_events(project_id, created_at DESC);
