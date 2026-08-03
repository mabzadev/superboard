ALTER TABLE store_reviews ADD COLUMN original_body TEXT;
ALTER TABLE store_reviews ADD COLUMN translated_body TEXT;
ALTER TABLE store_reviews ADD COLUMN translation_language TEXT;

ALTER TABLE store_review_response_drafts ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_review_response_drafts ADD COLUMN next_attempt_at TEXT;
ALTER TABLE store_review_response_drafts ADD COLUMN claim_token TEXT;
ALTER TABLE store_review_response_drafts ADD COLUMN claim_expires_at TEXT;
ALTER TABLE store_review_response_drafts ADD COLUMN publish_requested_at TEXT;

UPDATE store_reviews
SET original_body = COALESCE(original_body, body),
    sentiment = COALESCE(sentiment, CASE WHEN rating >= 4 THEN 'positive' WHEN rating <= 2 THEN 'negative' ELSE 'mixed' END),
    category = COALESCE(category, 'general')
WHERE original_body IS NULL OR sentiment IS NULL OR category IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_review_drafts_delivery
  ON store_review_response_drafts(status, publish_requested_at, next_attempt_at, claim_expires_at, attempts);
