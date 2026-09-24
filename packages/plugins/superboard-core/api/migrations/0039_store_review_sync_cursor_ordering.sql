ALTER TABLE store_review_sync_state ADD COLUMN watermark TEXT;
ALTER TABLE store_review_sync_state ADD COLUMN full_synced_at TEXT;

UPDATE store_review_sync_state
SET watermark = CASE
      WHEN json_valid(cursor) THEN json_extract(cursor, '$.watermark')
      ELSE NULL
    END,
    full_synced_at = CASE
      WHEN json_valid(cursor) THEN json_extract(cursor, '$.full_synced_at')
      ELSE NULL
    END;

CREATE INDEX IF NOT EXISTS idx_store_review_sync_freshness
  ON store_review_sync_state(project_id, provider, last_synced_at, watermark, full_synced_at);
