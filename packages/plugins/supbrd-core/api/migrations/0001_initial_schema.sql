-- Migration 001: Grovs Core Schema
-- Équivalent Cloudflare D1 du schema PostgreSQL Grovs

-- =====================================
-- AUTH & MULTI-TENANT
-- =====================================

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key TEXT NOT NULL UNIQUE,
  uri_scheme TEXT NOT NULL UNIQUE,
  get_started_dismissed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instance_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  instance_id INTEGER NOT NULL REFERENCES instances(id),
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, instance_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  identifier TEXT NOT NULL UNIQUE,
  instance_id INTEGER REFERENCES instances(id),
  is_test INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================
-- DEEP LINKS
-- =====================================

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  subdomain TEXT,
  project_id INTEGER REFERENCES projects(id),
  generic_title TEXT,
  generic_subtitle TEXT,
  generic_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
CREATE INDEX IF NOT EXISTS idx_domains_project_id ON domains(project_id);

CREATE TABLE IF NOT EXISTS redirect_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  default_fallback TEXT,
  show_preview_ios INTEGER DEFAULT 0,
  show_preview_android INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redirect_config_id INTEGER REFERENCES redirect_configs(id),
  platform TEXT,
  variation TEXT,
  enabled INTEGER DEFAULT 1,
  appstore INTEGER DEFAULT 0,
  fallback_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT,
  subtitle TEXT,
  image_url TEXT,
  data TEXT, -- JSON
  tags TEXT DEFAULT '[]', -- JSON array
  redirect_config_id INTEGER NOT NULL REFERENCES redirect_configs(id),
  domain_id INTEGER REFERENCES domains(id),
  campaign_id INTEGER,
  active INTEGER DEFAULT 1,
  sdk_generated INTEGER DEFAULT 0,
  generated_from_platform TEXT NOT NULL DEFAULT 'dashboard',
  tracking_source TEXT,
  tracking_medium TEXT,
  tracking_campaign TEXT,
  show_preview_ios INTEGER,
  show_preview_android INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_path ON links(path);
CREATE INDEX IF NOT EXISTS idx_links_redirect_config ON links(redirect_config_id);

CREATE TABLE IF NOT EXISTS custom_redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  platform TEXT NOT NULL,
  url TEXT,
  open_app_if_installed INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(link_id, platform)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================
-- APP CONFIGURATIONS (iOS + Android)
-- =====================================

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL, -- 'ios' | 'android'
  instance_id INTEGER REFERENCES instances(id),
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ios_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER UNIQUE REFERENCES applications(id),
  bundle_id TEXT,
  app_prefix TEXT NOT NULL DEFAULT '',
  tablet_enabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS android_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER UNIQUE REFERENCES applications(id),
  identifier TEXT NOT NULL,
  sha256s TEXT DEFAULT '[]', -- JSON array
  tablet_enabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================
-- SDK & ATTRIBUTION
-- =====================================

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  remote_ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  platform TEXT,
  model TEXT,
  vendor TEXT,
  language TEXT,
  timezone TEXT,
  screen_width INTEGER,
  screen_height INTEGER,
  app_version TEXT,
  build TEXT,
  push_token TEXT,
  webgl_vendor TEXT,
  webgl_renderer TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip);
CREATE INDEX IF NOT EXISTS idx_devices_updated_at ON devices(updated_at);

CREATE TABLE IF NOT EXISTS installed_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(device_id, project_id)
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  link_id INTEGER NOT NULL REFERENCES links(id),
  handled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_actions_device ON actions(device_id);
CREATE INDEX IF NOT EXISTS idx_actions_link ON actions(link_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  link_id INTEGER REFERENCES links(id),
  event TEXT NOT NULL,
  platform TEXT,
  path TEXT,
  data TEXT, -- JSON
  ip TEXT,
  remote_ip TEXT,
  app_version TEXT,
  build TEXT,
  vendor_id TEXT,
  engagement_time INTEGER,
  processed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_project_device ON events(project_id, device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

-- =====================================
-- ANALYTICS AGGREGATIONS
-- =====================================

CREATE TABLE IF NOT EXISTS daily_project_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  event_date TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'all',
  views INTEGER DEFAULT 0,
  link_views INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  reinstalls INTEGER DEFAULT 0,
  opens INTEGER DEFAULT 0,
  app_opens INTEGER DEFAULT 0,
  new_users INTEGER DEFAULT 0,
  returning_users INTEGER DEFAULT 0,
  organic_users INTEGER DEFAULT 0,
  referred_users INTEGER DEFAULT 0,
  first_time_visitors INTEGER DEFAULT 0,
  revenue INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, event_date, platform)
);
CREATE INDEX IF NOT EXISTS idx_dpm_project_date ON daily_project_metrics(project_id, event_date);

CREATE TABLE IF NOT EXISTS link_daily_statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL REFERENCES links(id),
  project_id INTEGER,
  event_date TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'all',
  views INTEGER DEFAULT 0,
  installs INTEGER DEFAULT 0,
  reinstalls INTEGER DEFAULT 0,
  opens INTEGER DEFAULT 0,
  app_opens INTEGER DEFAULT 0,
  user_referred INTEGER DEFAULT 0,
  revenue INTEGER DEFAULT 0,
  time_spent INTEGER DEFAULT 0,
  reactivations INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(link_id, project_id, event_date, platform)
);
CREATE INDEX IF NOT EXISTS idx_lds_link ON link_daily_statistics(link_id);

-- =====================================
-- NOTIFICATIONS (push)
-- =====================================

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  title TEXT,
  subtitle TEXT,
  html TEXT,
  send_push INTEGER DEFAULT 0,
  auto_display INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  device_id INTEGER NOT NULL REFERENCES devices(id),
  read INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
