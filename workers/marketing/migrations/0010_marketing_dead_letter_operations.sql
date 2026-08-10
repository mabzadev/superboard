ALTER TABLE marketing_dead_letters ADD COLUMN project_id INTEGER;
ALTER TABLE marketing_dead_letters ADD COLUMN resolution TEXT
  CHECK (resolution IN ('replayed', 'discarded'));
ALTER TABLE marketing_dead_letters ADD COLUMN resolved_at TEXT;

UPDATE marketing_dead_letters
SET project_id = CAST(json_extract(payload_json, '$.projectId') AS INTEGER)
WHERE json_valid(payload_json)
  AND json_type(payload_json, '$.projectId') = 'integer';

CREATE INDEX IF NOT EXISTS idx_marketing_dead_letters_project_status
  ON marketing_dead_letters(project_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_dead_letters_resolution
  ON marketing_dead_letters(resolution, resolved_at DESC);
