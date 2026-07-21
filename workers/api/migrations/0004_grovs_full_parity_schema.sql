-- Migration 0004: Grovs upstream schema parity
-- Adds D1-compatible equivalents for the Rails Grovs schema while keeping
-- existing OpenGrow compatibility columns used by the Worker code.

-- Existing tables: add upstream columns without renaming current ones.
ALTER TABLE users ADD COLUMN encrypted_password TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN reset_password_token TEXT;
ALTER TABLE users ADD COLUMN reset_password_sent_at TEXT;
ALTER TABLE users ADD COLUMN remember_created_at TEXT;
ALTER TABLE users ADD COLUMN sign_in_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN current_sign_in_at TEXT;
ALTER TABLE users ADD COLUMN last_sign_in_at TEXT;
ALTER TABLE users ADD COLUMN current_sign_in_ip TEXT;
ALTER TABLE users ADD COLUMN last_sign_in_ip TEXT;
ALTER TABLE users ADD COLUMN confirmation_token TEXT;
ALTER TABLE users ADD COLUMN confirmed_at TEXT;
ALTER TABLE users ADD COLUMN confirmation_sent_at TEXT;
ALTER TABLE users ADD COLUMN unconfirmed_email TEXT;
ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN unlock_token TEXT;
ALTER TABLE users ADD COLUMN locked_at TEXT;
ALTER TABLE users ADD COLUMN provider TEXT;
ALTER TABLE users ADD COLUMN uid TEXT;
ALTER TABLE users ADD COLUMN otp_required_for_login INTEGER;
ALTER TABLE users ADD COLUMN otp_secret TEXT;
ALTER TABLE users ADD COLUMN consumed_timestep INTEGER;
ALTER TABLE users ADD COLUMN otp_backup_codes TEXT;
ALTER TABLE users ADD COLUMN invitation_token TEXT;
ALTER TABLE users ADD COLUMN invitation_created_at TEXT;
ALTER TABLE users ADD COLUMN invitation_sent_at TEXT;
ALTER TABLE users ADD COLUMN invitation_accepted_at TEXT;
ALTER TABLE users ADD COLUMN invitation_limit INTEGER;
ALTER TABLE users ADD COLUMN invited_by_type TEXT;
ALTER TABLE users ADD COLUMN invited_by_id TEXT;
ALTER TABLE users ADD COLUMN invitations_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN super_admin INTEGER DEFAULT 0;

ALTER TABLE instances ADD COLUMN plan TEXT DEFAULT 'free';
ALTER TABLE instances ADD COLUMN max_projects INTEGER DEFAULT 3;
ALTER TABLE instances ADD COLUMN max_members INTEGER DEFAULT 1;
ALTER TABLE instances ADD COLUMN max_apps INTEGER DEFAULT 5;
ALTER TABLE instances ADD COLUMN max_events_per_month INTEGER DEFAULT 5000;
ALTER TABLE instances ADD COLUMN max_revenue_per_month REAL DEFAULT 1000.0;
ALTER TABLE instances ADD COLUMN max_tracked_users INTEGER DEFAULT 1000;
ALTER TABLE instances ADD COLUMN billing_email TEXT;
ALTER TABLE instances ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE instances ADD COLUMN subscription_status TEXT DEFAULT 'active';
ALTER TABLE instances ADD COLUMN trial_ends_at TEXT;
ALTER TABLE instances ADD COLUMN current_period_ends_at TEXT;

ALTER TABLE projects ADD COLUMN test INTEGER DEFAULT 0;
ALTER TABLE redirects ADD COLUMN application_id TEXT;
ALTER TABLE daily_project_metrics ADD COLUMN cancellations INTEGER DEFAULT 0;
ALTER TABLE daily_project_metrics ADD COLUMN first_time_purchases INTEGER DEFAULT 0;
ALTER TABLE daily_project_metrics ADD COLUMN units_sold INTEGER DEFAULT 0;
ALTER TABLE links ADD COLUMN ads_platform TEXT;
ALTER TABLE links ADD COLUMN name TEXT;
ALTER TABLE links ADD COLUMN visitor_id TEXT;
ALTER TABLE notification_messages ADD COLUMN visitor_id TEXT;
ALTER TABLE oauth_access_tokens ADD COLUMN previous_refresh_token TEXT NOT NULL DEFAULT '';

-- Active Storage
CREATE TABLE IF NOT EXISTS active_storage_blobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  metadata TEXT,
  service_name TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS active_storage_attachments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (blob_id) REFERENCES active_storage_blobs(id)
);

CREATE TABLE IF NOT EXISTS active_storage_variant_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  blob_id TEXT NOT NULL,
  variation_digest TEXT NOT NULL,
  FOREIGN KEY (blob_id) REFERENCES active_storage_blobs(id)
);

-- Push and platform configuration
CREATE TABLE IF NOT EXISTS android_push_configurations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT,
  fcm_server_key TEXT,
  fcm_sender_id TEXT,
  application_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS android_server_api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT NOT NULL,
  name TEXT,
  encrypted_key TEXT NOT NULL,
  key_id TEXT,
  project_id TEXT,
  client_email TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ios_push_configurations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT,
  p8_key TEXT,
  key_id TEXT,
  team_id TEXT,
  bundle_id TEXT,
  environment TEXT DEFAULT 'production',
  application_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ios_server_api_keys (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT NOT NULL,
  name TEXT,
  encrypted_key TEXT NOT NULL,
  key_id TEXT,
  issuer_id TEXT,
  bundle_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS desktop_configurations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  application_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  bundle_identifier TEXT,
  package_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS web_configurations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  application_id TEXT NOT NULL,
  site_url TEXT,
  service_worker_path TEXT DEFAULT '/service-worker.js',
  vapid_public_key TEXT,
  vapid_private_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS web_configuration_linked_domains (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  web_configuration_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (web_configuration_id) REFERENCES web_configurations(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

-- Visitors, targeting, notifications and analytics
CREATE TABLE IF NOT EXISTS visitors (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  external_id TEXT,
  anonymous_id TEXT,
  email TEXT,
  phone TEXT,
  name TEXT,
  first_name TEXT,
  last_name TEXT,
  language TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  timezone TEXT,
  os TEXT,
  os_version TEXT,
  device_type TEXT,
  device_model TEXT,
  browser TEXT,
  browser_version TEXT,
  app_version TEXT,
  sdk_version TEXT,
  properties TEXT DEFAULT '{}',
  tags TEXT DEFAULT '[]',
  first_seen_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS visitor_last_visits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  visitor_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  application_id TEXT,
  visited_at TEXT NOT NULL,
  path TEXT,
  url TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS visitor_daily_statistics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  visitor_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  sessions INTEGER DEFAULT 0,
  events INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  purchases INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_targets (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  notification_id TEXT NOT NULL,
  visitor_id TEXT,
  device_id TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  failed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS project_daily_active_users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  active_users INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  returning_users INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Commerce, subscriptions and Stripe/App Store events
CREATE TABLE IF NOT EXISTS in_app_products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  product_id TEXT NOT NULL,
  name TEXT,
  description TEXT,
  product_type TEXT,
  price REAL,
  currency TEXT,
  active INTEGER DEFAULT 1,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS in_app_product_daily_statistics (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  in_app_product_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  purchases INTEGER DEFAULT 0,
  refunds INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0.0,
  units_sold INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (in_app_product_id) REFERENCES in_app_products(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_product_purchases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id TEXT,
  visitor_id TEXT,
  in_app_product_id TEXT,
  project_id TEXT NOT NULL,
  application_id TEXT,
  transaction_id TEXT,
  original_transaction_id TEXT,
  store TEXT,
  product_id TEXT,
  quantity INTEGER DEFAULT 1,
  price REAL,
  currency TEXT,
  purchased_at TEXT,
  expires_at TEXT,
  refunded_at TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  FOREIGN KEY (in_app_product_id) REFERENCES in_app_products(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT NOT NULL,
  application_id TEXT,
  device_id TEXT,
  visitor_id TEXT,
  in_app_product_id TEXT,
  transaction_id TEXT,
  event_type TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  occurred_at TEXT NOT NULL,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  FOREIGN KEY (in_app_product_id) REFERENCES in_app_products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS subscription_states (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_id TEXT,
  visitor_id TEXT,
  project_id TEXT NOT NULL,
  application_id TEXT,
  product_id TEXT,
  transaction_id TEXT,
  original_transaction_id TEXT,
  store TEXT,
  status TEXT NOT NULL,
  starts_at TEXT,
  expires_at TEXT,
  auto_renews INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL,
  FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS enterprise_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'active',
  seats INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stripe_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT NOT NULL,
  status TEXT,
  price_id TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  canceled_at TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stripe_payment_intents (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT,
  stripe_payment_intent_id TEXT NOT NULL,
  amount INTEGER,
  currency TEXT,
  status TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stripe_webhook_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS iap_webhook_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  store TEXT NOT NULL,
  event_id TEXT,
  event_type TEXT,
  payload TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS failed_purchase_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT,
  application_id TEXT,
  job_class TEXT NOT NULL,
  arguments TEXT,
  error_class TEXT,
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

-- MCP OAuth/server tables
CREATE TABLE IF NOT EXISTS mcp_clients (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT,
  redirect_uris TEXT DEFAULT '[]',
  scopes TEXT DEFAULT '[]',
  confidential INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mcp_authorization_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  mcp_client_id TEXT NOT NULL,
  user_id TEXT,
  code TEXT NOT NULL,
  redirect_uri TEXT,
  scopes TEXT DEFAULT '[]',
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_client_id) REFERENCES mcp_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  mcp_client_id TEXT NOT NULL,
  user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scopes TEXT DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (mcp_client_id) REFERENCES mcp_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- RPush compatibility tables
CREATE TABLE IF NOT EXISTS rpush_apps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  environment TEXT,
  certificate TEXT,
  password TEXT,
  connections INTEGER DEFAULT 1,
  type TEXT,
  auth_key TEXT,
  client_id TEXT,
  client_secret TEXT,
  access_token TEXT,
  access_token_expiration TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rpush_notifications (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  badge INTEGER,
  device_token TEXT,
  sound TEXT,
  alert TEXT,
  data TEXT,
  expiry INTEGER,
  delivered INTEGER DEFAULT 0,
  delivered_at TEXT,
  failed INTEGER DEFAULT 0,
  failed_at TEXT,
  error_code INTEGER,
  error_description TEXT,
  deliver_after TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  alert_is_json INTEGER DEFAULT 0,
  type TEXT,
  collapse_key TEXT,
  delay_while_idle INTEGER DEFAULT 0,
  registration_ids TEXT,
  app_id TEXT,
  retries INTEGER DEFAULT 0,
  uri TEXT,
  fail_after TEXT,
  processing INTEGER DEFAULT 0,
  priority INTEGER,
  url_args TEXT,
  category TEXT,
  content_available INTEGER DEFAULT 0,
  notification INTEGER DEFAULT 0,
  mutable_content INTEGER DEFAULT 0,
  external_device_id TEXT,
  thread_id TEXT,
  dry_run INTEGER DEFAULT 0,
  FOREIGN KEY (app_id) REFERENCES rpush_apps(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rpush_feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  device_token TEXT NOT NULL,
  failed_at TEXT NOT NULL,
  app_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (app_id) REFERENCES rpush_apps(id) ON DELETE SET NULL
);

-- Supporting product/admin tables
CREATE TABLE IF NOT EXISTS downloadable_files (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  project_id TEXT,
  application_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  file_key TEXT,
  content_type TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS store_images (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  application_id TEXT NOT NULL,
  image_type TEXT,
  url TEXT,
  width INTEGER,
  height INTEGER,
  position INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quick_links (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT,
  project_id TEXT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS setup_progress_steps (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT NOT NULL,
  step TEXT NOT NULL,
  completed INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diagnostics_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  instance_id TEXT,
  project_id TEXT,
  application_id TEXT,
  level TEXT NOT NULL,
  source TEXT,
  message TEXT NOT NULL,
  context TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS index_active_storage_blobs_on_key ON active_storage_blobs(key);
CREATE UNIQUE INDEX IF NOT EXISTS index_active_storage_attachments_uniqueness ON active_storage_attachments(record_type, record_id, name, blob_id);
CREATE INDEX IF NOT EXISTS index_active_storage_attachments_on_blob_id ON active_storage_attachments(blob_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_active_storage_variant_records_uniqueness ON active_storage_variant_records(blob_id, variation_digest);

CREATE INDEX IF NOT EXISTS index_users_on_confirmation_token ON users(confirmation_token);
CREATE INDEX IF NOT EXISTS index_users_on_invitation_token ON users(invitation_token);
CREATE INDEX IF NOT EXISTS index_users_on_invited_by ON users(invited_by_type, invited_by_id);
CREATE INDEX IF NOT EXISTS index_users_on_reset_password_token ON users(reset_password_token);
CREATE INDEX IF NOT EXISTS index_users_on_unlock_token ON users(unlock_token);
CREATE INDEX IF NOT EXISTS index_users_on_uid_and_provider ON users(uid, provider);

CREATE INDEX IF NOT EXISTS index_android_push_configurations_on_application_id ON android_push_configurations(application_id);
CREATE INDEX IF NOT EXISTS index_android_server_api_keys_on_instance_id ON android_server_api_keys(instance_id);
CREATE INDEX IF NOT EXISTS index_ios_push_configurations_on_application_id ON ios_push_configurations(application_id);
CREATE INDEX IF NOT EXISTS index_ios_server_api_keys_on_instance_id ON ios_server_api_keys(instance_id);
CREATE INDEX IF NOT EXISTS index_desktop_configurations_on_application_id ON desktop_configurations(application_id);
CREATE INDEX IF NOT EXISTS index_web_configurations_on_application_id ON web_configurations(application_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_web_configuration_linked_domains_unique ON web_configuration_linked_domains(web_configuration_id, domain_id);

CREATE INDEX IF NOT EXISTS index_visitors_on_project_id ON visitors(project_id);
CREATE INDEX IF NOT EXISTS index_visitors_on_application_id ON visitors(application_id);
CREATE INDEX IF NOT EXISTS index_visitors_on_external_id ON visitors(external_id);
CREATE INDEX IF NOT EXISTS index_visitors_on_anonymous_id ON visitors(anonymous_id);
CREATE INDEX IF NOT EXISTS index_visitor_last_visits_on_visitor_id ON visitor_last_visits(visitor_id);
CREATE INDEX IF NOT EXISTS index_visitor_last_visits_on_project_id ON visitor_last_visits(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_visitor_daily_statistics_unique ON visitor_daily_statistics(visitor_id, date);
CREATE INDEX IF NOT EXISTS index_notification_targets_on_notification_id ON notification_targets(notification_id);
CREATE INDEX IF NOT EXISTS index_notification_targets_on_visitor_id ON notification_targets(visitor_id);
CREATE INDEX IF NOT EXISTS index_notification_targets_on_device_id ON notification_targets(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_project_daily_active_users_unique ON project_daily_active_users(project_id, date);

CREATE INDEX IF NOT EXISTS index_in_app_products_on_project_id ON in_app_products(project_id);
CREATE INDEX IF NOT EXISTS index_in_app_products_on_application_id ON in_app_products(application_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_in_app_products_unique_product ON in_app_products(project_id, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_in_app_product_daily_statistics_unique ON in_app_product_daily_statistics(in_app_product_id, date);
CREATE INDEX IF NOT EXISTS index_device_product_purchases_on_project_id ON device_product_purchases(project_id);
CREATE INDEX IF NOT EXISTS index_device_product_purchases_on_transaction_id ON device_product_purchases(transaction_id);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_project_id ON purchase_events(project_id);
CREATE INDEX IF NOT EXISTS index_purchase_events_on_transaction_id ON purchase_events(transaction_id);
CREATE INDEX IF NOT EXISTS index_subscription_states_on_project_id ON subscription_states(project_id);
CREATE INDEX IF NOT EXISTS index_subscription_states_on_original_transaction_id ON subscription_states(original_transaction_id);
CREATE INDEX IF NOT EXISTS index_enterprise_subscriptions_on_instance_id ON enterprise_subscriptions(instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_stripe_subscriptions_on_subscription_id ON stripe_subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS index_stripe_subscriptions_on_instance_id ON stripe_subscriptions(instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_stripe_payment_intents_on_payment_intent_id ON stripe_payment_intents(stripe_payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_stripe_webhook_messages_on_stripe_event_id ON stripe_webhook_messages(stripe_event_id);
CREATE INDEX IF NOT EXISTS index_iap_webhook_messages_on_store_and_event_id ON iap_webhook_messages(store, event_id);
CREATE INDEX IF NOT EXISTS index_failed_purchase_jobs_on_next_retry_at ON failed_purchase_jobs(next_retry_at);

CREATE UNIQUE INDEX IF NOT EXISTS index_mcp_clients_on_client_id ON mcp_clients(client_id);
CREATE INDEX IF NOT EXISTS index_mcp_clients_on_instance_id ON mcp_clients(instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_mcp_authorization_codes_on_code ON mcp_authorization_codes(code);
CREATE UNIQUE INDEX IF NOT EXISTS index_mcp_tokens_on_access_token ON mcp_tokens(access_token);
CREATE INDEX IF NOT EXISTS index_mcp_tokens_on_refresh_token ON mcp_tokens(refresh_token);

CREATE INDEX IF NOT EXISTS index_rpush_apps_on_name ON rpush_apps(name);
CREATE INDEX IF NOT EXISTS index_rpush_notifications_on_app_id ON rpush_notifications(app_id);
CREATE INDEX IF NOT EXISTS index_rpush_notifications_multi ON rpush_notifications(delivered, failed, processing, deliver_after, created_at);
CREATE INDEX IF NOT EXISTS index_rpush_feedback_on_app_id ON rpush_feedback(app_id);

CREATE INDEX IF NOT EXISTS index_downloadable_files_on_project_id ON downloadable_files(project_id);
CREATE INDEX IF NOT EXISTS index_store_images_on_application_id ON store_images(application_id);
CREATE INDEX IF NOT EXISTS index_quick_links_on_instance_id ON quick_links(instance_id);
CREATE INDEX IF NOT EXISTS index_quick_links_on_project_id ON quick_links(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS index_setup_progress_steps_unique ON setup_progress_steps(instance_id, step);
CREATE INDEX IF NOT EXISTS index_diagnostics_logs_on_instance_id ON diagnostics_logs(instance_id);
CREATE INDEX IF NOT EXISTS index_diagnostics_logs_on_project_id ON diagnostics_logs(project_id);
CREATE INDEX IF NOT EXISTS index_diagnostics_logs_on_created_at ON diagnostics_logs(created_at);
