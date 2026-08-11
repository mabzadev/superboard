ALTER TABLE audit_events ADD COLUMN actor_role TEXT;
ALTER TABLE audit_events ADD COLUMN project_ref TEXT;
ALTER TABLE audit_events ADD COLUMN environment TEXT;
CREATE INDEX products_idempotency_retention ON idempotency_keys(created_at);
