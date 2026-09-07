CREATE TABLE IF NOT EXISTS mcp_operator_sessions (
  instance_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (instance_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_operator_sessions_owner ON mcp_operator_sessions(instance_id, operator_id, created_at);
CREATE TABLE IF NOT EXISTS mcp_operator_invocations (
  instance_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  request_checksum TEXT NOT NULL,
  result_checksum TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (instance_id, operation_id),
  UNIQUE (instance_id, receipt_id),
  FOREIGN KEY (instance_id, session_id) REFERENCES mcp_operator_sessions(instance_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_mcp_operator_invocations_session ON mcp_operator_invocations(instance_id, operator_id, session_id, started_at);
