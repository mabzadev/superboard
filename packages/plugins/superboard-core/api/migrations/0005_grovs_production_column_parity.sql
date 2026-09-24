-- Migration 0005: close production column gaps against Grovs origin/main.
-- This migration only adds columns that the inventory script reports as missing.
-- Required upstream columns use D1-safe defaults when existing rows may exist.

ALTER TABLE android_push_configurations ADD COLUMN android_configuration_id INTEGER;
ALTER TABLE android_push_configurations ADD COLUMN firebase_project_id TEXT;
ALTER TABLE android_server_api_keys ADD COLUMN android_configuration_id INTEGER;

ALTER TABLE desktop_configurations ADD COLUMN fallback_url TEXT;
ALTER TABLE desktop_configurations ADD COLUMN generated_page INTEGER DEFAULT 1;
ALTER TABLE desktop_configurations ADD COLUMN mac_enabled INTEGER DEFAULT 0;
ALTER TABLE desktop_configurations ADD COLUMN mac_uri TEXT;
ALTER TABLE desktop_configurations ADD COLUMN windows_enabled INTEGER DEFAULT 0;
ALTER TABLE desktop_configurations ADD COLUMN windows_uri TEXT;

ALTER TABLE diagnostics_logs ADD COLUMN duration_ms REAL;
ALTER TABLE diagnostics_logs ADD COLUMN hostname TEXT;
ALTER TABLE diagnostics_logs ADD COLUMN operation TEXT;
ALTER TABLE diagnostics_logs ADD COLUMN payload TEXT;
ALTER TABLE diagnostics_logs ADD COLUMN test_key TEXT;

ALTER TABLE enterprise_subscriptions ADD COLUMN active INTEGER DEFAULT 1;
ALTER TABLE enterprise_subscriptions ADD COLUMN end_date TEXT;
ALTER TABLE enterprise_subscriptions ADD COLUMN start_date TEXT;
ALTER TABLE enterprise_subscriptions ADD COLUMN total_maus INTEGER;

ALTER TABLE failed_purchase_jobs ADD COLUMN backtrace TEXT;
ALTER TABLE failed_purchase_jobs ADD COLUMN failed_at TEXT;
ALTER TABLE failed_purchase_jobs ADD COLUMN purchase_event_id INTEGER;
ALTER TABLE failed_purchase_jobs ADD COLUMN retried_at TEXT;
ALTER TABLE failed_purchase_jobs ADD COLUMN status TEXT DEFAULT 'pending';

ALTER TABLE iap_webhook_messages ADD COLUMN instance_id INTEGER;
ALTER TABLE iap_webhook_messages ADD COLUMN notification_type TEXT;
ALTER TABLE iap_webhook_messages ADD COLUMN project_id INTEGER;
ALTER TABLE iap_webhook_messages ADD COLUMN source TEXT;

ALTER TABLE in_app_product_daily_statistics ADD COLUMN canceled_events INTEGER DEFAULT 0;
ALTER TABLE in_app_product_daily_statistics ADD COLUMN device_revenue INTEGER DEFAULT 0;
ALTER TABLE in_app_product_daily_statistics ADD COLUMN event_date TEXT;
ALTER TABLE in_app_product_daily_statistics ADD COLUMN first_time_purchases INTEGER;
ALTER TABLE in_app_product_daily_statistics ADD COLUMN platform TEXT DEFAULT 'web';
ALTER TABLE in_app_product_daily_statistics ADD COLUMN purchase_events INTEGER DEFAULT 0;
ALTER TABLE in_app_product_daily_statistics ADD COLUMN repeat_purchases INTEGER DEFAULT 0;

ALTER TABLE in_app_products ADD COLUMN platform TEXT DEFAULT 'web';
ALTER TABLE in_app_products ADD COLUMN unique_purchasing_devices INTEGER DEFAULT 0;

ALTER TABLE instances ADD COLUMN last_quota_exceeded_sent_at TEXT;
ALTER TABLE instances ADD COLUMN last_quota_warning_sent_at TEXT;
ALTER TABLE instances ADD COLUMN quota_exceeded INTEGER DEFAULT 0;
ALTER TABLE instances ADD COLUMN revenue_collection_enabled INTEGER DEFAULT 0;

ALTER TABLE ios_push_configurations ADD COLUMN certificate_password TEXT;
ALTER TABLE ios_push_configurations ADD COLUMN ios_configuration_id INTEGER;
ALTER TABLE ios_server_api_keys ADD COLUMN filename TEXT;
ALTER TABLE ios_server_api_keys ADD COLUMN ios_configuration_id INTEGER;
ALTER TABLE ios_server_api_keys ADD COLUMN private_key TEXT;

ALTER TABLE mcp_authorization_codes ADD COLUMN client_id TEXT DEFAULT '';
ALTER TABLE mcp_authorization_codes ADD COLUMN code_challenge TEXT;
ALTER TABLE mcp_authorization_codes ADD COLUMN code_challenge_method TEXT;
ALTER TABLE mcp_authorization_codes ADD COLUMN scope TEXT;
ALTER TABLE mcp_authorization_codes ADD COLUMN state TEXT;

ALTER TABLE mcp_clients ADD COLUMN application_type TEXT DEFAULT 'native';
ALTER TABLE mcp_clients ADD COLUMN client_name TEXT;
ALTER TABLE mcp_clients ADD COLUMN client_uri TEXT;
ALTER TABLE mcp_clients ADD COLUMN grant_types TEXT DEFAULT 'authorization_code';
ALTER TABLE mcp_clients ADD COLUMN logo_uri TEXT;
ALTER TABLE mcp_clients ADD COLUMN response_types TEXT DEFAULT 'code';
ALTER TABLE mcp_clients ADD COLUMN token_endpoint_auth_method TEXT DEFAULT 'none';

ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT;
ALTER TABLE mcp_tokens ADD COLUMN last_used_at TEXT;
ALTER TABLE mcp_tokens ADD COLUMN name TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_token_digest TEXT;
ALTER TABLE mcp_tokens ADD COLUMN scope TEXT;
ALTER TABLE mcp_tokens ADD COLUMN token_digest TEXT;

ALTER TABLE notification_targets ADD COLUMN existing_users INTEGER DEFAULT 0;
ALTER TABLE notification_targets ADD COLUMN new_users INTEGER DEFAULT 0;
ALTER TABLE notification_targets ADD COLUMN platforms TEXT DEFAULT '[]';

ALTER TABLE project_daily_active_users ADD COLUMN event_date TEXT;
ALTER TABLE project_daily_active_users ADD COLUMN platform TEXT DEFAULT 'web';

ALTER TABLE purchase_events ADD COLUMN date TEXT;
ALTER TABLE purchase_events ADD COLUMN expires_date TEXT;
ALTER TABLE purchase_events ADD COLUMN identifier TEXT;
ALTER TABLE purchase_events ADD COLUMN link_id INTEGER;
ALTER TABLE purchase_events ADD COLUMN order_id TEXT;
ALTER TABLE purchase_events ADD COLUMN original_transaction_id TEXT;
ALTER TABLE purchase_events ADD COLUMN price_cents INTEGER;
ALTER TABLE purchase_events ADD COLUMN processed INTEGER DEFAULT 0;
ALTER TABLE purchase_events ADD COLUMN product_id TEXT;
ALTER TABLE purchase_events ADD COLUMN purchase_type TEXT;
ALTER TABLE purchase_events ADD COLUMN quantity INTEGER DEFAULT 1;
ALTER TABLE purchase_events ADD COLUMN store INTEGER DEFAULT 0;
ALTER TABLE purchase_events ADD COLUMN store_source TEXT;
ALTER TABLE purchase_events ADD COLUMN usd_price_cents INTEGER;
ALTER TABLE purchase_events ADD COLUMN webhook_validated INTEGER DEFAULT 0;

ALTER TABLE quick_links ADD COLUMN android_phone TEXT;
ALTER TABLE quick_links ADD COLUMN android_tablet TEXT;
ALTER TABLE quick_links ADD COLUMN desktop TEXT;
ALTER TABLE quick_links ADD COLUMN desktop_linux TEXT;
ALTER TABLE quick_links ADD COLUMN desktop_mac TEXT;
ALTER TABLE quick_links ADD COLUMN desktop_windows TEXT;
ALTER TABLE quick_links ADD COLUMN domain_id INTEGER;
ALTER TABLE quick_links ADD COLUMN image_url TEXT;
ALTER TABLE quick_links ADD COLUMN ios_phone TEXT;
ALTER TABLE quick_links ADD COLUMN ios_tablet TEXT;
ALTER TABLE quick_links ADD COLUMN path TEXT;
ALTER TABLE quick_links ADD COLUMN subtitle TEXT;
ALTER TABLE quick_links ADD COLUMN title TEXT;

ALTER TABLE rpush_apps ADD COLUMN apn_key TEXT;
ALTER TABLE rpush_apps ADD COLUMN apn_key_id TEXT;
ALTER TABLE rpush_apps ADD COLUMN bundle_id TEXT;
ALTER TABLE rpush_apps ADD COLUMN feedback_enabled INTEGER DEFAULT 1;
ALTER TABLE rpush_apps ADD COLUMN firebase_project_id TEXT;
ALTER TABLE rpush_apps ADD COLUMN json_key TEXT;
ALTER TABLE rpush_apps ADD COLUMN team_id TEXT;
ALTER TABLE rpush_notifications ADD COLUMN sound_is_json INTEGER DEFAULT 0;

ALTER TABLE setup_progress_steps ADD COLUMN category TEXT;
ALTER TABLE setup_progress_steps ADD COLUMN step_identifier TEXT;

ALTER TABLE store_images ADD COLUMN identifier TEXT;
ALTER TABLE store_images ADD COLUMN platform TEXT;

ALTER TABLE stripe_payment_intents ADD COLUMN intent_id TEXT;
ALTER TABLE stripe_payment_intents ADD COLUMN product_type TEXT;
ALTER TABLE stripe_payment_intents ADD COLUMN user_id INTEGER;

ALTER TABLE stripe_subscriptions ADD COLUMN active INTEGER;
ALTER TABLE stripe_subscriptions ADD COLUMN cancels_at TEXT;
ALTER TABLE stripe_subscriptions ADD COLUMN cancels_at_needs_backfill INTEGER DEFAULT 0;
ALTER TABLE stripe_subscriptions ADD COLUMN customer_id TEXT;
ALTER TABLE stripe_subscriptions ADD COLUMN product_type TEXT;
ALTER TABLE stripe_subscriptions ADD COLUMN stripe_payment_intent_id INTEGER;
ALTER TABLE stripe_subscriptions ADD COLUMN subscription_id TEXT;
ALTER TABLE stripe_subscriptions ADD COLUMN subscription_item_id TEXT;

ALTER TABLE stripe_webhook_messages ADD COLUMN data TEXT;
ALTER TABLE stripe_webhook_messages ADD COLUMN message_type TEXT;
ALTER TABLE stripe_webhook_messages ADD COLUMN processed INTEGER DEFAULT 1;

ALTER TABLE subscription_states ADD COLUMN latest_transaction_id TEXT;
ALTER TABLE subscription_states ADD COLUMN link_id INTEGER;
ALTER TABLE subscription_states ADD COLUMN purchase_type TEXT;

ALTER TABLE visitor_daily_statistics ADD COLUMN app_opens INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN event_date TEXT;
ALTER TABLE visitor_daily_statistics ADD COLUMN installs INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN invited_by_id INTEGER;
ALTER TABLE visitor_daily_statistics ADD COLUMN opens INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN platform TEXT DEFAULT 'web';
ALTER TABLE visitor_daily_statistics ADD COLUMN reactivations INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN reinstalls INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN time_spent INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN user_referred INTEGER DEFAULT 0;
ALTER TABLE visitor_daily_statistics ADD COLUMN views INTEGER DEFAULT 0;

ALTER TABLE visitor_last_visits ADD COLUMN link_id INTEGER;

ALTER TABLE visitors ADD COLUMN device_id INTEGER;
ALTER TABLE visitors ADD COLUMN inviter_id INTEGER;
ALTER TABLE visitors ADD COLUMN sdk_attributes TEXT;
ALTER TABLE visitors ADD COLUMN sdk_identifier TEXT;
ALTER TABLE visitors ADD COLUMN uuid TEXT DEFAULT (lower(hex(randomblob(16))));
ALTER TABLE visitors ADD COLUMN web_visitor INTEGER DEFAULT 0;

ALTER TABLE web_configuration_linked_domains ADD COLUMN domain TEXT;

CREATE INDEX IF NOT EXISTS index_android_push_configurations_on_android_configuration_id ON android_push_configurations(android_configuration_id);
CREATE INDEX IF NOT EXISTS index_android_server_api_keys_on_android_configuration_id ON android_server_api_keys(android_configuration_id);
CREATE INDEX IF NOT EXISTS index_diagnostics_logs_on_test_key ON diagnostics_logs(test_key);
CREATE INDEX IF NOT EXISTS index_failed_purchase_jobs_on_status ON failed_purchase_jobs(status);
CREATE INDEX IF NOT EXISTS index_failed_purchase_jobs_on_purchase_event_id ON failed_purchase_jobs(purchase_event_id);
CREATE INDEX IF NOT EXISTS index_iap_webhook_messages_on_instance_id ON iap_webhook_messages(instance_id);
CREATE INDEX IF NOT EXISTS index_iap_webhook_messages_on_project_id ON iap_webhook_messages(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iapds_unique_product_event_date_platform ON in_app_product_daily_statistics(in_app_product_id, event_date, platform);
CREATE INDEX IF NOT EXISTS idx_iapds_project_event_date ON in_app_product_daily_statistics(project_id, event_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_in_app_products_on_project_platform_product ON in_app_products(project_id, platform, product_id);
CREATE INDEX IF NOT EXISTS index_ios_push_configurations_on_ios_configuration_id ON ios_push_configurations(ios_configuration_id);
CREATE INDEX IF NOT EXISTS index_ios_server_api_keys_on_ios_configuration_id ON ios_server_api_keys(ios_configuration_id);
CREATE INDEX IF NOT EXISTS index_mcp_authorization_codes_on_expires_at ON mcp_authorization_codes(expires_at);
CREATE INDEX IF NOT EXISTS index_mcp_authorization_codes_on_user_id ON mcp_authorization_codes(user_id);
CREATE INDEX IF NOT EXISTS index_mcp_tokens_on_client_id ON mcp_tokens(client_id);
CREATE INDEX IF NOT EXISTS index_mcp_tokens_on_expires_at ON mcp_tokens(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS index_mcp_tokens_on_refresh_token_digest ON mcp_tokens(refresh_token_digest) WHERE refresh_token_digest IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS index_mcp_tokens_on_token_digest ON mcp_tokens(token_digest);
CREATE INDEX IF NOT EXISTS index_mcp_tokens_on_user_id ON mcp_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_dau_on_project_date_platform ON project_daily_active_users(project_id, event_date, platform);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_date ON purchase_events(date);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_identifier ON purchase_events(identifier);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_link_id ON purchase_events(link_id);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_event_type ON purchase_events(event_type);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_project_date_event ON purchase_events(project_id, date, event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_events_unique_txn ON purchase_events(project_id, transaction_id, event_type);
CREATE INDEX IF NOT EXISTS index_quick_links_on_domain_id ON quick_links(domain_id);
CREATE INDEX IF NOT EXISTS index_rpush_feedback_on_device_token ON rpush_feedback(device_token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_setup_progress_unique ON setup_progress_steps(instance_id, category, step_identifier);
CREATE INDEX IF NOT EXISTS idx_setup_progress_instance_category ON setup_progress_steps(instance_id, category);
CREATE UNIQUE INDEX IF NOT EXISTS index_store_images_on_identifier_and_platform ON store_images(identifier, platform);
CREATE INDEX IF NOT EXISTS index_stripe_payment_intents_on_user_id ON stripe_payment_intents(user_id);
CREATE INDEX IF NOT EXISTS index_stripe_subscriptions_on_stripe_payment_intent_id ON stripe_subscriptions(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS index_subscription_states_on_link_id ON subscription_states(link_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_states_project_orig_txn ON subscription_states(project_id, original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_vds_date_project_platform ON visitor_daily_statistics(event_date, project_id, platform);
CREATE INDEX IF NOT EXISTS idx_vds_project_date_visitor ON visitor_daily_statistics(project_id, event_date, visitor_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vds_proj_visitor_date_platform ON visitor_daily_statistics(project_id, visitor_id, event_date, platform);
CREATE INDEX IF NOT EXISTS index_visitor_last_visits_on_link_id ON visitor_last_visits(link_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_vlv_on_project_and_visitor ON visitor_last_visits(project_id, visitor_id);
CREATE INDEX IF NOT EXISTS index_visitors_on_device_id ON visitors(device_id);
CREATE INDEX IF NOT EXISTS index_visitors_on_inviter_id ON visitors(inviter_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_visitors_on_uuid ON visitors(uuid);
CREATE INDEX IF NOT EXISTS index_visitors_on_web_visitor ON visitors(web_visitor);
