CREATE TABLE IF NOT EXISTS billing_legacy_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'revenuecat'),
  external_project_id TEXT NOT NULL,
  configuration_encrypted TEXT,
  billing_configuration_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured', 'connected', 'error', 'disabled')),
  last_tested_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, provider)
);

CREATE TABLE IF NOT EXISTS billing_legacy_inventory_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox', 'production')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  customers_scanned INTEGER NOT NULL DEFAULT 0,
  active_subscriptions INTEGER NOT NULL DEFAULT 0,
  matched_subscriptions INTEGER NOT NULL DEFAULT 0,
  unresolved_subscriptions INTEGER NOT NULL DEFAULT 0,
  unsupported_subscriptions INTEGER NOT NULL DEFAULT 0,
  next_cursor TEXT,
  claim_token TEXT,
  claim_expires_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  requested_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES billing_legacy_sources(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_legacy_inventory_one_active_run
  ON billing_legacy_inventory_runs(project_id, environment)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS billing_legacy_inventory_runs_project_created
  ON billing_legacy_inventory_runs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_legacy_customer_inventory (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  app_user_id TEXT,
  customer_id TEXT,
  resolution_status TEXT NOT NULL CHECK (resolution_status IN ('matched', 'unmatched')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES billing_legacy_inventory_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  UNIQUE(run_id, external_customer_id)
);

CREATE TABLE IF NOT EXISTS billing_legacy_subscription_inventory (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  external_subscription_id TEXT NOT NULL,
  app_user_id TEXT,
  customer_id TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe', 'unsupported')),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  store_product_id TEXT,
  store_subscription_identifier TEXT,
  source_status TEXT,
  source_expires_at TEXT,
  resolution_status TEXT NOT NULL CHECK (resolution_status IN (
    'matched', 'unmatched_customer', 'missing_product', 'missing_verified_subscription', 'unsupported_provider'
  )),
  matched_subscription_id TEXT,
  resolution_detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES billing_legacy_inventory_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (matched_subscription_id) REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  UNIQUE(run_id, external_subscription_id)
);

CREATE INDEX IF NOT EXISTS billing_legacy_subscription_resolution
  ON billing_legacy_subscription_inventory(run_id, resolution_status, provider);
