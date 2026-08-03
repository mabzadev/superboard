-- OpenGrow Purchases 2.0: canonical events, remote paywalls, growth tools,
-- provider capabilities, virtual currencies and export jobs.

CREATE TABLE IF NOT EXISTS billing_store_connections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  capabilities TEXT NOT NULL DEFAULT '{}',
  configuration_encrypted TEXT,
  public_configuration TEXT NOT NULL DEFAULT '{}',
  last_tested_at TEXT,
  last_synced_at TEXT,
  last_event_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, provider, environment)
);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  application_id TEXT,
  customer_id TEXT,
  transaction_id TEXT,
  subscription_id TEXT,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processed',
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  FOREIGN KEY (transaction_id) REFERENCES billing_transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (subscription_id) REFERENCES billing_subscriptions(id) ON DELETE SET NULL,
  UNIQUE(project_id, provider, environment, external_event_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_project_occurred
  ON billing_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_customer_occurred
  ON billing_events(customer_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_product_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  provider_price_id TEXT,
  base_plan_id TEXT,
  offer_id TEXT,
  currency TEXT,
  price_micros INTEGER,
  billing_period TEXT,
  trial_period TEXT,
  introductory_price_micros INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE CASCADE,
  UNIQUE(product_id, provider_price_id, base_plan_id, offer_id, currency)
);

CREATE TABLE IF NOT EXISTS billing_placements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  default_offering_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (default_offering_id) REFERENCES billing_offerings(id) ON DELETE SET NULL,
  UNIQUE(project_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_paywalls (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  display_name TEXT NOT NULL,
  offering_id TEXT,
  active_version_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES billing_offerings(id) ON DELETE SET NULL,
  UNIQUE(project_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_paywall_versions (
  id TEXT PRIMARY KEY,
  paywall_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  configuration TEXT NOT NULL,
  localizations TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  FOREIGN KEY (paywall_id) REFERENCES billing_paywalls(id) ON DELETE CASCADE,
  UNIQUE(paywall_id, version)
);

CREATE TABLE IF NOT EXISTS billing_targeting_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft',
  conditions TEXT NOT NULL DEFAULT '[]',
  offering_id TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (placement_id) REFERENCES billing_placements(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES billing_offerings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_targeting_live
  ON billing_targeting_rules(project_id, placement_id, state, priority);

CREATE TABLE IF NOT EXISTS billing_experiments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  audience_conditions TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (placement_id) REFERENCES billing_placements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_experiment_variants (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  offering_id TEXT NOT NULL,
  weight INTEGER NOT NULL,
  is_control INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id) REFERENCES billing_experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (offering_id) REFERENCES billing_offerings(id) ON DELETE CASCADE,
  UNIQUE(experiment_id, identifier)
);

CREATE TABLE IF NOT EXISTS billing_experiment_assignments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (experiment_id) REFERENCES billing_experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES billing_experiment_variants(id) ON DELETE CASCADE,
  UNIQUE(experiment_id, customer_id)
);

CREATE TABLE IF NOT EXISTS billing_paywall_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  paywall_id TEXT,
  paywall_version_id TEXT,
  placement_identifier TEXT,
  experiment_id TEXT,
  variant_id TEXT,
  event_type TEXT NOT NULL,
  package_identifier TEXT,
  platform TEXT,
  country TEXT,
  app_version TEXT,
  sdk_version TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_paywall_events_project_occurred
  ON billing_paywall_events(project_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_virtual_currencies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, code)
);

CREATE TABLE IF NOT EXISTS billing_virtual_currency_products (
  currency_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  grant_amount INTEGER NOT NULL,
  trial_grant_amount INTEGER,
  grant_cadence TEXT NOT NULL DEFAULT 'purchase',
  expires_after_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(currency_id, product_id),
  FOREIGN KEY (currency_id) REFERENCES billing_virtual_currencies(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES billing_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS billing_export_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  dataset TEXT NOT NULL,
  format TEXT NOT NULL,
  cadence TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  incremental INTEGER NOT NULL DEFAULT 1,
  columns TEXT NOT NULL DEFAULT '[]',
  r2_key TEXT,
  row_count INTEGER,
  error_message TEXT,
  requested_by TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO billing_placements (id, project_id, identifier, display_name, default_offering_id)
SELECT lower(hex(randomblob(16))), project_id, 'default', 'Default', id
FROM billing_offerings
WHERE is_current = 1;
