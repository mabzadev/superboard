-- Site migrations run before EmDash creates its tables on a new instance. These
-- definitions match EmDash's, which then keeps the existing tables.
CREATE TABLE IF NOT EXISTS options (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _emdash_plugin_setting_versions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  values_json TEXT NOT NULL,
  secrets_set_json TEXT NOT NULL,
  changed_keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

DELETE FROM options
WHERE name IN (
  'plugin:superboard-content:settings:default_locale',
  'plugin:superboard-content:settings:required_locales',
  'plugin:superboard-content:settings:publishing_mode',
  'plugin:supbrd-plug-content:settings:default_locale',
  'plugin:supbrd-plug-content:settings:required_locales',
  'plugin:supbrd-plug-content:settings:publishing_mode',
  'plugin:superboard-files:settings:max_upload_bytes',
  'plugin:superboard-files:settings:allowed_content_types',
  'plugin:superboard-files:settings:signed_url_ttl_seconds',
  'plugin:supbrd-plugmod-files:settings:max_upload_bytes',
  'plugin:supbrd-plugmod-files:settings:allowed_content_types',
  'plugin:supbrd-plugmod-files:settings:signed_url_ttl_seconds',
  'plugin:superboard-products:settings:default_currency',
  'plugin:superboard-products:settings:store_environment',
  'plugin:superboard-products:settings:catalog_sync_enabled',
  'plugin:supbrd-plug-products:settings:default_currency',
  'plugin:supbrd-plug-products:settings:store_environment',
  'plugin:supbrd-plug-products:settings:catalog_sync_enabled',
  'plugin:superboard-billing:settings:apple_issuer_id',
  'plugin:superboard-billing:settings:apple_key_id',
  'plugin:superboard-billing:settings:apple_private_key',
  'plugin:superboard-billing:settings:google_service_account_json',
  'plugin:superboard-billing:settings:stripe_secret_key',
  'plugin:superboard-billing:settings:webhook_signing_secret',
  'plugin:supbrd-plugmod-billing:settings:apple_issuer_id',
  'plugin:supbrd-plugmod-billing:settings:apple_key_id',
  'plugin:supbrd-plugmod-billing:settings:apple_private_key',
  'plugin:supbrd-plugmod-billing:settings:google_service_account_json',
  'plugin:supbrd-plugmod-billing:settings:stripe_secret_key',
  'plugin:supbrd-plugmod-billing:settings:webhook_signing_secret'
);

DELETE FROM _emdash_plugin_setting_versions
WHERE plugin_id IN (
  'supbrd-plug-data',
  'supbrd-plug-commerce',
  'superboard-content',
  'superboard-files',
  'superboard-products',
  'superboard-billing',
  'supbrd-plug-content',
  'supbrd-plugmod-files',
  'supbrd-plug-products',
  'supbrd-plugmod-billing'
);
