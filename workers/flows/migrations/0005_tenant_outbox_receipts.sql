ALTER TABLE flow_outbox_receipts ADD COLUMN organization_id TEXT;
ALTER TABLE flow_outbox_receipts ADD COLUMN environment_id TEXT;

CREATE INDEX flow_outbox_receipts_tenant_status_idx
  ON flow_outbox_receipts (
    project_id,
    organization_id,
    environment_id,
    status,
    received_at
  );
