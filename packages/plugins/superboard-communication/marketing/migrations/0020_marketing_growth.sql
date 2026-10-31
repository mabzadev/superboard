PRAGMA foreign_keys = ON;

-- Project-level growth preferences: brand kit, revenue attribution window and
-- the fallback time zone used when a contact has none.
CREATE TABLE IF NOT EXISTS marketing_project_settings (
  project_id INTEGER PRIMARY KEY,
  brand_kit_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(brand_kit_json)),
  attribution_window_days INTEGER NOT NULL DEFAULT 7
    CHECK (attribution_window_days BETWEEN 1 AND 90),
  default_time_zone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per recipient and link. event_id is the id of the first click in
-- email_events, so unique clicks stay derivable from email_events alone.
CREATE TABLE IF NOT EXISTS email_link_clicks (
  project_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  target_url TEXT NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 1 CHECK (clicks > 0),
  first_clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_email_link_clicks_campaign
  ON email_link_clicks(project_id, campaign_id, target_url);

-- A/B testing: test deliveries carry the variant they were sent with.
ALTER TABLE email_deliveries ADD COLUMN variant_id TEXT;
ALTER TABLE email_deliveries ADD COLUMN variant_phase TEXT
  CHECK (variant_phase IS NULL OR variant_phase IN ('test', 'winner'));
CREATE INDEX IF NOT EXISTS idx_email_deliveries_variant
  ON email_deliveries(project_id, campaign_id, variant_id);

CREATE TABLE IF NOT EXISTS marketing_campaign_ab_tests (
  project_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  variants_json TEXT NOT NULL CHECK (json_valid(variants_json)),
  test_percent INTEGER NOT NULL CHECK (test_percent BETWEEN 5 AND 50),
  winner_metric TEXT NOT NULL CHECK (winner_metric IN ('open_rate', 'click_rate')),
  test_duration_minutes INTEGER NOT NULL CHECK (test_duration_minutes BETWEEN 30 AND 10080),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'testing', 'winner_selected', 'completed')),
  winner_variant_id TEXT,
  test_started_at TEXT,
  test_ends_at TEXT,
  winner_selected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_ab_tests_due
  ON marketing_campaign_ab_tests(status, test_ends_at);

-- Recipient time-zone sending: deliver at local_send_at in each contact's zone.
CREATE TABLE IF NOT EXISTS marketing_campaign_send_windows (
  project_id INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  local_send_at TEXT NOT NULL,
  fallback_time_zone TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_campaign_send_windows_open
  ON marketing_campaign_send_windows(completed_at, project_id);

-- Last-click revenue attribution. source_id is a campaign or a journey id.
CREATE TABLE IF NOT EXISTS marketing_revenue_attributions (
  project_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('campaign', 'journey')),
  source_id TEXT NOT NULL,
  delivery_id TEXT,
  revenue_cents INTEGER NOT NULL CHECK (revenue_cents > 0),
  currency TEXT,
  clicked_at TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_revenue_attributions_source
  ON marketing_revenue_attributions(project_id, source_type, source_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_marketing_revenue_attributions_subscriber
  ON marketing_revenue_attributions(project_id, subscriber_id);
