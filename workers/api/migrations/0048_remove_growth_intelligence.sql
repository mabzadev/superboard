-- Retire the removed Growth Intelligence projections after the new Billing and
-- API Workers are active. Historical migrations remain immutable so both
-- existing and newly provisioned databases converge on this final schema.

DROP INDEX IF EXISTS billing_paywall_growth_projection_idx;
DROP INDEX IF EXISTS idx_store_review_revisions_growth_projection;

DROP TABLE IF EXISTS growth_lifecycle_outbox;
DROP TABLE IF EXISTS growth_delivery_receipts;

ALTER TABLE billing_feature_flags DROP COLUMN growth;

ALTER TABLE billing_paywall_events DROP COLUMN growth_projected_at;
ALTER TABLE billing_paywall_events DROP COLUMN growth_projection_attempts;
ALTER TABLE billing_paywall_events DROP COLUMN growth_projection_next_attempt_at;
ALTER TABLE billing_paywall_events DROP COLUMN growth_projection_error;

ALTER TABLE store_review_revisions DROP COLUMN growth_projected_at;
ALTER TABLE store_review_revisions DROP COLUMN growth_projection_attempts;
ALTER TABLE store_review_revisions DROP COLUMN growth_projection_next_attempt_at;
ALTER TABLE store_review_revisions DROP COLUMN growth_projection_error;
