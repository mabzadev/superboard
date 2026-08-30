PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_plugin_store_records (
  plugin_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_checksum TEXT NOT NULL,
  last_operation_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, store_id, instance_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_store_records_instance
  ON superboard_plugin_store_records(instance_id, plugin_id, entity_type, updated_at);

CREATE TABLE IF NOT EXISTS superboard_plugin_store_outbox (
  operation_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_plugin_store_outbox_delivery
  ON superboard_plugin_store_outbox(delivered_at, created_at);

CREATE TRIGGER IF NOT EXISTS superboard_plugin_store_outbox_immutable_delete
BEFORE DELETE ON superboard_plugin_store_outbox
BEGIN
  SELECT RAISE(ABORT, 'plugin Store outbox receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_store_outbox_immutable_update
BEFORE UPDATE ON superboard_plugin_store_outbox
WHEN NEW.operation_id <> OLD.operation_id
  OR NEW.plugin_id <> OLD.plugin_id
  OR NEW.store_id <> OLD.store_id
  OR NEW.instance_id <> OLD.instance_id
  OR NEW.entity_type <> OLD.entity_type
  OR NEW.entity_id <> OLD.entity_id
  OR NEW.revision <> OLD.revision
  OR NEW.payload_checksum <> OLD.payload_checksum
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'plugin Store outbox receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_store_insert_outbox
AFTER INSERT ON superboard_plugin_store_records
BEGIN
  INSERT INTO superboard_plugin_store_outbox (
    operation_id, plugin_id, store_id, instance_id, entity_type, entity_id,
    revision, payload_checksum, created_at
  ) VALUES (
    NEW.last_operation_id, NEW.plugin_id, NEW.store_id, NEW.instance_id,
    NEW.entity_type, NEW.entity_id, NEW.revision, NEW.payload_checksum, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_store_update_outbox
AFTER UPDATE ON superboard_plugin_store_records
WHEN NEW.last_operation_id <> OLD.last_operation_id
BEGIN
  INSERT INTO superboard_plugin_store_outbox (
    operation_id, plugin_id, store_id, instance_id, entity_type, entity_id,
    revision, payload_checksum, created_at
  ) VALUES (
    NEW.last_operation_id, NEW.plugin_id, NEW.store_id, NEW.instance_id,
    NEW.entity_type, NEW.entity_id, NEW.revision, NEW.payload_checksum, NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS superboard_plugin_store_records_no_delete
BEFORE DELETE ON superboard_plugin_store_records
BEGIN
  SELECT RAISE(ABORT, 'plugin Store records require a tombstone, not deletion');
END;

CREATE TABLE IF NOT EXISTS superboard_plugin_shadow_read_metrics (
  metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('match', 'mismatch')),
  source_count INTEGER NOT NULL,
  target_count INTEGER NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_shadow_metrics_plugin_time
  ON superboard_plugin_shadow_read_metrics(plugin_id, observed_at);

CREATE TABLE IF NOT EXISTS superboard_worker_execution_leases (
  attempt_id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  callback_token_hash TEXT NOT NULL,
  callback_public_jwk TEXT NOT NULL CHECK (json_valid(callback_public_jwk)),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  superseded_at TEXT,
  consumed_at TEXT,
  callback_payload_checksum TEXT,
  callback_signature TEXT,
  UNIQUE(plugin_id, operation_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_execution_leases_expiry
  ON superboard_worker_execution_leases(plugin_id, expires_at, superseded_at, consumed_at);
