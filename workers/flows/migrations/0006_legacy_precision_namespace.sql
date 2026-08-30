ALTER TABLE flow_legacy_experiments
  ADD COLUMN traffic_basis_points INTEGER CHECK (
    traffic_basis_points BETWEEN 0 AND 10000
  );

UPDATE flow_legacy_experiments
SET traffic_basis_points = traffic_percent * 100
WHERE traffic_basis_points IS NULL;

ALTER TABLE flow_analytics_events ADD COLUMN source_event_id TEXT;
ALTER TABLE flow_analytics_events ADD COLUMN source_module TEXT CHECK (
  source_module IS NULL OR source_module IN ('paywalls', 'onboardings')
);

UPDATE flow_analytics_events
SET source_event_id = event_id,
    source_module = json_extract(properties_json, '$.legacy.source')
WHERE legacy_event_type IS NOT NULL AND source_event_id IS NULL;

CREATE UNIQUE INDEX flow_analytics_legacy_source_event_idx
  ON flow_analytics_events (
    project_id,
    organization_id,
    source_module,
    source_event_id
  )
  WHERE source_module IS NOT NULL AND source_event_id IS NOT NULL;

ALTER TABLE flow_legacy_event_claims RENAME TO flow_legacy_event_claims_v1;

CREATE TABLE flow_legacy_event_claims (
  event_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (
    source_module IN ('paywalls', 'onboardings')
  ),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, organization_id, source_module, event_id)
);

INSERT INTO flow_legacy_event_claims (
  event_id,
  project_id,
  organization_id,
  source_module,
  claimed_at
)
SELECT event_id, project_id, organization_id, source_module, claimed_at
FROM flow_legacy_event_claims_v1;

DROP TABLE flow_legacy_event_claims_v1;

CREATE INDEX idx_flow_legacy_event_claims_tenant
  ON flow_legacy_event_claims (
    project_id,
    organization_id,
    source_module,
    claimed_at DESC
  );
