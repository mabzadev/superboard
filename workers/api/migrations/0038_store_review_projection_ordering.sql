ALTER TABLE store_reviews ADD COLUMN provider_observed_at TEXT;
ALTER TABLE store_reviews ADD COLUMN projection_version TEXT;

UPDATE store_reviews
SET provider_observed_at = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(last_seen_at, updated_at, created_at)),
    projection_version = strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(last_seen_at, updated_at, created_at)) || '|LEGACY|' || id
WHERE projection_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_reviews_projection
  ON store_reviews(project_id, provider, projection_version);
