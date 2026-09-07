CREATE TABLE IF NOT EXISTS application_user_suspensions (
  project_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  suspended_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id, user_id) REFERENCES application_users(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS application_user_operations (
  project_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, operation_id)
);
CREATE INDEX IF NOT EXISTS idx_application_user_operations_user ON application_user_operations(project_id, user_id, created_at);
