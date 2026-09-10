-- Encrypt APNs/FCM credentials at rest and make pending push acquisition efficient.
-- Plaintext values are converged by the bounded Worker maintenance job after
-- this schema migration is applied; new writes use encrypted columns only.

ALTER TABLE ios_push_configurations ADD COLUMN encrypted_p8_key TEXT;
ALTER TABLE android_push_configurations ADD COLUMN encrypted_fcm_server_key TEXT;

ALTER TABLE rpush_apps ADD COLUMN encrypted_apn_key TEXT;
ALTER TABLE rpush_apps ADD COLUMN encrypted_json_key TEXT;
ALTER TABLE rpush_apps ADD COLUMN encrypted_access_token TEXT;
ALTER TABLE rpush_apps ADD COLUMN encrypted_legacy_credentials TEXT;

-- Cached FCM OAuth tokens can be safely renewed. Never leave pre-migration
-- bearer tokens in plaintext while the runtime convergence is pending.
UPDATE rpush_apps
SET access_token = NULL,
    access_token_expiration = NULL,
    updated_at = datetime('now')
WHERE access_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS index_rpush_notifications_on_delivery_claim
  ON rpush_notifications(delivered, failed, processing, deliver_after, updated_at, created_at);
