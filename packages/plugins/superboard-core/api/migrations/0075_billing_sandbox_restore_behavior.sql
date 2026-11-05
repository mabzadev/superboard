-- Customer history entries that SuperBoard records without a Store, such as the alias created
-- when an anonymous App User ID is merged into another customer, use the provider 'superboard'.
DROP TRIGGER IF EXISTS billing_events_supported_provider_insert;
CREATE TRIGGER billing_events_supported_provider_insert
BEFORE INSERT ON billing_events
WHEN NEW.provider NOT IN ('apple', 'google', 'stripe', 'promotional', 'superboard')
BEGIN
  SELECT RAISE(ABORT, 'unsupported billing provider');
END;

-- Restore behavior applied to sandbox purchases. NULL applies restore_behavior to them too.
ALTER TABLE billing_project_settings ADD COLUMN sandbox_restore_behavior TEXT
  CHECK (sandbox_restore_behavior IS NULL
    OR sandbox_restore_behavior IN ('transfer', 'transfer_if_no_active_subscriptions', 'block'));
