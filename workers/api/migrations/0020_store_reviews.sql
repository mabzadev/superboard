CREATE TABLE IF NOT EXISTS store_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  provider_review_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  author_name TEXT,
  language TEXT,
  territory TEXT,
  app_version TEXT,
  provider_created_at TEXT,
  provider_updated_at TEXT,
  response_id TEXT,
  response_body TEXT,
  response_state TEXT,
  response_updated_at TEXT,
  sentiment TEXT,
  category TEXT,
  raw_payload TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, provider, provider_review_id)
);

CREATE TABLE IF NOT EXISTS store_review_revisions (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  provider_updated_at TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_id) REFERENCES store_reviews(id) ON DELETE CASCADE,
  UNIQUE(review_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS store_review_response_drafts (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'publishing', 'published', 'failed', 'rejected')),
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  provider_response TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_id) REFERENCES store_reviews(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS store_review_sync_state (
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('apple', 'google')),
  cursor TEXT,
  last_synced_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(project_id, provider),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS store_review_audit_events (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('provider', 'admin', 'system')),
  actor_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (review_id) REFERENCES store_reviews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_reviews_inbox
  ON store_reviews(project_id, response_body, rating, provider_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_review_drafts_status
  ON store_review_response_drafts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_store_review_audit_review
  ON store_review_audit_events(review_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS store_review_audit_no_update
BEFORE UPDATE ON store_review_audit_events
BEGIN
  SELECT RAISE(ABORT, 'store review audit events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS store_review_audit_no_delete
BEFORE DELETE ON store_review_audit_events
BEGIN
  SELECT RAISE(ABORT, 'store review audit events are immutable');
END;
