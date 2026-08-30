CREATE TABLE IF NOT EXISTS superboard_plugin_command_operations (
  operation_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  command_id TEXT,
  adapter_operation TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  request_path_checksum TEXT NOT NULL CHECK (request_path_checksum LIKE 'sha256:%'),
  request_payload_json TEXT NOT NULL CHECK (json_valid(request_payload_json)),
  request_checksum TEXT NOT NULL CHECK (request_checksum LIKE 'sha256:%'),
  state TEXT NOT NULL CHECK (state IN ('accepted', 'completed', 'failed')),
  response_status INTEGER,
  response_headers_json TEXT CHECK (
    response_headers_json IS NULL OR json_valid(response_headers_json)
  ),
  response_payload_json TEXT CHECK (
    response_payload_json IS NULL OR json_valid(response_payload_json)
  ),
  response_checksum TEXT CHECK (
    response_checksum IS NULL OR response_checksum LIKE 'sha256:%'
  ),
  accepted_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (
    (state = 'accepted' AND response_status IS NULL AND completed_at IS NULL)
    OR
    (state IN ('completed', 'failed') AND response_status IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_superboard_plugin_command_scope
ON superboard_plugin_command_operations(
  instance_id, project_ref, plugin_id, accepted_at
);

CREATE TABLE IF NOT EXISTS superboard_plugin_command_outbox (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('accepted', 'completed', 'failed')),
  payload_checksum TEXT NOT NULL CHECK (payload_checksum LIKE 'sha256:%'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES superboard_plugin_command_operations(operation_id)
);

CREATE INDEX IF NOT EXISTS idx_superboard_plugin_command_outbox_operation
ON superboard_plugin_command_outbox(operation_id, event_id);

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_accept_outbox
AFTER INSERT ON superboard_plugin_command_operations
BEGIN
  INSERT INTO superboard_plugin_command_outbox (
    operation_id, plugin_id, event_kind, payload_checksum, created_at
  ) VALUES (
    NEW.operation_id, NEW.plugin_id, 'accepted', NEW.request_checksum, NEW.accepted_at
  );
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_complete_outbox
AFTER UPDATE OF state ON superboard_plugin_command_operations
WHEN OLD.state = 'accepted' AND NEW.state IN ('completed', 'failed')
BEGIN
  INSERT INTO superboard_plugin_command_outbox (
    operation_id, plugin_id, event_kind, payload_checksum, created_at
  ) VALUES (
    NEW.operation_id, NEW.plugin_id, NEW.state, NEW.response_checksum, NEW.completed_at
  );
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_no_delete
BEFORE DELETE ON superboard_plugin_command_operations
BEGIN
  SELECT RAISE(ABORT, 'plugin command authority is append-only');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_outbox_no_update
BEFORE UPDATE ON superboard_plugin_command_outbox
BEGIN
  SELECT RAISE(ABORT, 'plugin command outbox is immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_outbox_no_delete
BEFORE DELETE ON superboard_plugin_command_outbox
BEGIN
  SELECT RAISE(ABORT, 'plugin command outbox is immutable');
END;
