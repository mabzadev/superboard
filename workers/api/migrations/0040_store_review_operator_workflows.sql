ALTER TABLE store_reviews ADD COLUMN translation_source TEXT
  CHECK (translation_source IS NULL OR translation_source IN ('provider', 'operator'));
ALTER TABLE store_reviews ADD COLUMN translation_source_sha256 TEXT;

UPDATE store_reviews
SET translation_source = 'provider'
WHERE translated_body IS NOT NULL AND translation_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_reviews_operator_list
  ON store_reviews(project_id, COALESCE(provider_created_at, created_at) DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_store_review_revisions_history
  ON store_review_revisions(review_id, captured_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_store_review_drafts_history
  ON store_review_response_drafts(review_id, created_at DESC, id DESC);
