CREATE UNIQUE INDEX customers_project_identity ON customers(project_id,id);

CREATE TABLE referrals_v2 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  invited_customer_id TEXT,
  code TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','converted','rejected')),
  converted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id,code),
  FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,invited_customer_id) REFERENCES customers(project_id,id) ON DELETE CASCADE
);

INSERT INTO referrals_v2 (id,project_id,customer_id,invited_customer_id,code,source,status,converted_at,created_at)
SELECT id,project_id,customer_id,invited_customer_id,code,source,status,converted_at,created_at FROM referrals;
DROP TABLE referrals;
ALTER TABLE referrals_v2 RENAME TO referrals;
CREATE INDEX referrals_project_created ON referrals(project_id,created_at DESC);

CREATE TABLE customer_events (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  customer_id TEXT,
  referrer_customer_id TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'view','open','install','reinstall','reactivation','app_open',
    'user_referred','time_spent','purchase','refund'
  )),
  platform TEXT,
  occurred_at TEXT NOT NULL,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  engagement_time INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  PRIMARY KEY(project_id,id),
  FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,referrer_customer_id) REFERENCES customers(project_id,id) ON DELETE CASCADE
);

CREATE INDEX customer_events_customer_stats
  ON customer_events(project_id,customer_id,occurred_at,event_type,platform);
CREATE INDEX customer_events_project_stats
  ON customer_events(project_id,occurred_at,event_type,platform);
CREATE INDEX customer_events_referrer_stats
  ON customer_events(project_id,referrer_customer_id,occurred_at,event_type,platform);
