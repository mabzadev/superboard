ALTER TABLE superboard_operator_reauthentication_receipts
  ADD COLUMN authorization_method TEXT NOT NULL DEFAULT 'strong_reauthentication'
  CHECK (authorization_method IN ('strong_reauthentication', 'operator_session'));
ALTER TABLE superboard_operator_reauthentication_receipts ADD COLUMN operation_id TEXT;
CREATE INDEX idx_superboard_operator_reauthentication_receipts_operation_id
  ON superboard_operator_reauthentication_receipts(operation_id);
