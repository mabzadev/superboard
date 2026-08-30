-- Reserve legacy event identifiers before queue delivery. Cloudflare Queues
-- are at-least-once; this table makes the legacy synchronous accepted/
-- duplicates response deterministic while the canonical projection remains
-- idempotent in flow_analytics_events.
CREATE TABLE flow_legacy_event_claims (
  event_id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_flow_legacy_event_claims_tenant
  ON flow_legacy_event_claims(project_id, organization_id, source_module, claimed_at DESC);
