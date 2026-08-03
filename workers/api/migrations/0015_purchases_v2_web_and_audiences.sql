-- Follow-up migration kept separate because Purchases v2 core may already be
-- installed on development deployments.

CREATE TABLE IF NOT EXISTS billing_audiences (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, display_name)
);

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

CREATE TABLE IF NOT EXISTS billing_redemptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  checkout_session_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  redeemed_by_customer_id TEXT,
  expires_at TEXT NOT NULL,
  redeemed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (checkout_session_id) REFERENCES billing_checkout_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (redeemed_by_customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL,
  UNIQUE(project_id, code_hash)
);
