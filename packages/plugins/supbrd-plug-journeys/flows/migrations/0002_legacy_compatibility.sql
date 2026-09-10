PRAGMA foreign_keys = ON;

CREATE TABLE flow_legacy_versions (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  definition_json TEXT NOT NULL,
  changelog TEXT,
  flow_version_id TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  UNIQUE (project_id, source_module, workflow_id, version),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (flow_version_id) REFERENCES flow_workflow_versions(id)
);
CREATE INDEX idx_flow_legacy_versions_workflow
  ON flow_legacy_versions(project_id, source_module, workflow_id, version DESC);

CREATE TABLE flow_legacy_placements (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  key TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  active_legacy_version_id TEXT,
  experience_id TEXT,
  targeting_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_module, key, priority),
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (active_legacy_version_id) REFERENCES flow_legacy_versions(id)
);
CREATE INDEX idx_flow_legacy_placements_resolve
  ON flow_legacy_placements(project_id, source_module, key, active, priority DESC);

CREATE TABLE flow_legacy_experiments (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  source_module TEXT NOT NULL CHECK (source_module IN ('paywalls', 'onboardings')),
  workflow_id TEXT NOT NULL,
  placement_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'running', 'paused', 'completed', 'archived')),
  traffic_percent INTEGER NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 0 AND 100),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES flow_workflows(id) ON DELETE CASCADE,
  FOREIGN KEY (placement_id) REFERENCES flow_legacy_placements(id) ON DELETE SET NULL
);

CREATE TABLE flow_legacy_variants (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  legacy_version_id TEXT NOT NULL,
  key TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (experiment_id, key),
  FOREIGN KEY (experiment_id) REFERENCES flow_legacy_experiments(id) ON DELETE CASCADE,
  FOREIGN KEY (legacy_version_id) REFERENCES flow_legacy_versions(id)
);

CREATE TABLE flow_legacy_targeting_rules (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  organization_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (placement_id) REFERENCES flow_legacy_placements(id) ON DELETE CASCADE
);
CREATE INDEX idx_flow_legacy_targeting_rules_placement
  ON flow_legacy_targeting_rules(project_id, placement_id, active, priority DESC);
