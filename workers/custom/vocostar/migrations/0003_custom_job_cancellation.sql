CREATE TABLE IF NOT EXISTS opengrow_custom_job_credit_refunds (
  job_id TEXT PRIMARY KEY REFERENCES opengrow_custom_jobs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_opengrow_custom_job_credit_refunds_pending
  ON opengrow_custom_job_credit_refunds(applied_at, created_at);
