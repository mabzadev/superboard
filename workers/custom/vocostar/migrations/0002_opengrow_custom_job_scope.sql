DROP INDEX IF EXISTS idx_opengrow_custom_jobs_user_created;

CREATE INDEX IF NOT EXISTS idx_opengrow_custom_jobs_project_user_created
  ON opengrow_custom_jobs(project_ref, user_id, created_at DESC, id DESC);
