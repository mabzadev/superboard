ALTER TABLE domains ADD COLUMN dns_verified_at TEXT;
UPDATE domains SET status='pending',verified_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='verified' AND dns_verified_at IS NULL;
