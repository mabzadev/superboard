CREATE TRIGGER IF NOT EXISTS superboard_plugin_command_request_not_retained
AFTER INSERT ON superboard_plugin_command_operations
WHEN NEW.request_payload_json <> '{"retained":false}'
BEGIN
  UPDATE superboard_plugin_command_operations
  SET request_payload_json = '{"retained":false}'
  WHERE operation_id = NEW.operation_id;
END;

UPDATE superboard_plugin_command_operations
SET request_payload_json = '{"retained":false}'
WHERE request_payload_json <> '{"retained":false}';
