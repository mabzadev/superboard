CREATE TABLE IF NOT EXISTS billing_mirror_comparisons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  app_user_id TEXT NOT NULL,
  matches INTEGER NOT NULL,
  grovs_active_entitlements TEXT NOT NULL,
  revenuecat_active_entitlements TEXT NOT NULL,
  differences TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES billing_customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_mirror_project_created
  ON billing_mirror_comparisons(project_id, created_at DESC);
