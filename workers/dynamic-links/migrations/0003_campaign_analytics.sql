PRAGMA foreign_keys = OFF;

CREATE TABLE link_events_v2 (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  link_id TEXT,
  campaign_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'click','redirect','view','open','install','reinstall','reactivation',
    'app_open','user_referred','time_spent','conversion'
  )),
  platform TEXT,
  country_code TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK(revenue_cents >= 0),
  engagement_time INTEGER NOT NULL DEFAULT 0 CHECK(engagement_time >= 0),
  customer_id TEXT,
  session_id TEXT,
  PRIMARY KEY(project_id,id)
);

INSERT INTO link_events_v2 (
  id,project_id,link_id,campaign_id,event_type,platform,country_code,
  occurred_at,metadata_json,revenue_cents,engagement_time,customer_id,session_id
)
SELECT
  id,project_id,link_id,campaign_id,event_type,platform,country_code,
  occurred_at,metadata_json,0,0,NULL,NULL
FROM link_events;

DROP TABLE link_events;
ALTER TABLE link_events_v2 RENAME TO link_events;

CREATE INDEX link_events_stats
  ON link_events(project_id,occurred_at,event_type,platform,campaign_id);
CREATE INDEX link_events_campaign
  ON link_events(project_id,campaign_id,occurred_at);

PRAGMA foreign_keys = ON;
