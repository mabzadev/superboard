-- Remove the retired Store Reviews domain while preserving Store credentials,
-- provider connections, Billing events, purchases, refunds, and entitlements.

DROP TRIGGER IF EXISTS store_review_audit_no_update;
DROP TRIGGER IF EXISTS store_review_audit_no_delete;

DROP TABLE IF EXISTS inbox_automation_alerts;
DROP TABLE IF EXISTS store_review_audit_events;
DROP TABLE IF EXISTS store_review_response_drafts;
DROP TABLE IF EXISTS store_review_revisions;
DROP TABLE IF EXISTS store_review_sync_state;
DROP TABLE IF EXISTS store_reviews;
