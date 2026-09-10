CREATE TABLE IF NOT EXISTS billing_catalog_entitlements (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL, description TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT, updated_at TEXT, UNIQUE(project_id, key));

CREATE TABLE IF NOT EXISTS billing_catalog_purchases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, financial_customer_id TEXT NOT NULL, product_id TEXT NOT NULL, status TEXT NOT NULL, purchased_at TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), store TEXT, environment TEXT, external_transaction_id TEXT, original_transaction_id TEXT, purchased_price_micros INTEGER NOT NULL DEFAULT 0, currency TEXT, expires_at TEXT, updated_at TEXT);

CREATE INDEX IF NOT EXISTS billing_catalog_purchases_customer ON billing_catalog_purchases(project_id, financial_customer_id, purchased_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_audit_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload_json)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actor_id TEXT, entity_type TEXT, entity_id TEXT, request_id TEXT, occurred_at TEXT, actor_role TEXT, project_ref TEXT, environment TEXT);

CREATE TABLE IF NOT EXISTS billing_catalog_financial_customers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(attributes_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, external_customer_id)
);

CREATE INDEX IF NOT EXISTS billing_catalog_financial_customers_project ON billing_catalog_financial_customers(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_products (
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

CREATE INDEX IF NOT EXISTS billing_catalog_products_project_status ON billing_catalog_products(project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_entitlement_products (
  entitlement_id TEXT NOT NULL REFERENCES billing_catalog_entitlements(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES billing_catalog_products(id) ON DELETE CASCADE,
  PRIMARY KEY(entitlement_id, product_id)
);

CREATE INDEX IF NOT EXISTS billing_catalog_entitlement_products_product ON billing_catalog_entitlement_products(product_id, entitlement_id);

CREATE UNIQUE INDEX IF NOT EXISTS billing_catalog_purchases_external_transaction ON billing_catalog_purchases(project_id, store, environment, external_transaction_id) WHERE external_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_catalog_purchases_status ON billing_catalog_purchases(project_id, status, purchased_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_purchase_entitlements (
  purchase_id TEXT NOT NULL REFERENCES billing_catalog_purchases(id) ON DELETE CASCADE,
  entitlement_id TEXT NOT NULL REFERENCES billing_catalog_entitlements(id) ON DELETE CASCADE,
  PRIMARY KEY(purchase_id, entitlement_id)
);

CREATE TABLE IF NOT EXISTS billing_catalog_subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  financial_customer_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES billing_catalog_products(id),
  latest_purchase_id TEXT REFERENCES billing_catalog_purchases(id),
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

CREATE INDEX IF NOT EXISTS billing_catalog_subscriptions_customer ON billing_catalog_subscriptions(project_id, financial_customer_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_refunds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES billing_catalog_purchases(id),
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

CREATE INDEX IF NOT EXISTS billing_catalog_refunds_purchase ON billing_catalog_refunds(project_id, purchase_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS billing_catalog_idempotency_keys (
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

CREATE INDEX IF NOT EXISTS billing_catalog_products_audit_project ON billing_catalog_audit_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_catalog_products_idempotency_retention ON billing_catalog_idempotency_keys(created_at);

CREATE TABLE IF NOT EXISTS billing_catalog_imports (
 project_id TEXT NOT NULL,
 source TEXT NOT NULL,
 source_table TEXT NOT NULL,
 source_cursor TEXT NOT NULL,
 completed_at TEXT,
 PRIMARY KEY(project_id, source, source_table)
);

CREATE TABLE IF NOT EXISTS billing_catalog_imported_rows (
 project_id TEXT NOT NULL,
 source_table TEXT NOT NULL,
 source_key TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 PRIMARY KEY(project_id,source_table,source_key)
);
