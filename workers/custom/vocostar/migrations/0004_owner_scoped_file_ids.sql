ALTER TABLE opengrow_custom_jobs ADD COLUMN source_file_id TEXT;

CREATE INDEX IF NOT EXISTS idx_opengrow_custom_jobs_source_file
  ON opengrow_custom_jobs(user_id, source_file_id)
  WHERE source_file_id IS NOT NULL;
