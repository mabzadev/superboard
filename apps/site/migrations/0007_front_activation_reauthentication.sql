PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_front_activation_reauthentication (
  activation_id TEXT PRIMARY KEY
    REFERENCES superboard_front_activations(activation_id),
  receipt_id TEXT NOT NULL UNIQUE
    REFERENCES superboard_operator_reauthentication_receipts(receipt_id),
  linked_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS superboard_activation_reauth_immutable_update
BEFORE UPDATE ON superboard_front_activation_reauthentication
BEGIN
  SELECT RAISE(ABORT, 'activation reauthentication links are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_activation_reauth_immutable_delete
BEFORE DELETE ON superboard_front_activation_reauthentication
BEGIN
  SELECT RAISE(ABORT, 'activation reauthentication links are immutable');
END;
