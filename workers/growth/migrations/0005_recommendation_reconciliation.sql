ALTER TABLE growth_recommendations ADD COLUMN auto_resolved_at TEXT;

CREATE INDEX growth_recommendations_resolution_idx
  ON growth_recommendations (project_id, kind, status, auto_resolved_at);
