CREATE TABLE IF NOT EXISTS observability_observations (
  instance_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  service TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  exceptions INTEGER NOT NULL,
  cpu_ms REAL NOT NULL,
  wall_ms REAL NOT NULL,
  observed_at TEXT NOT NULL,
  incident_id TEXT,
  PRIMARY KEY (instance_id, observation_id)
);
CREATE INDEX IF NOT EXISTS idx_observability_observations_time ON observability_observations(instance_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_observability_observations_service ON observability_observations(instance_id, service, observed_at);
CREATE TABLE IF NOT EXISTS observability_incidents (
  instance_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  service TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrences INTEGER NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT,
  PRIMARY KEY (instance_id, incident_id)
);
CREATE INDEX IF NOT EXISTS idx_observability_incidents_status ON observability_incidents(instance_id, status, last_observed_at);
CREATE TABLE IF NOT EXISTS observability_incident_transitions (
  instance_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  action TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  resolution TEXT,
  changed_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_observability_transitions_incident ON observability_incident_transitions(instance_id, incident_id, changed_at);
