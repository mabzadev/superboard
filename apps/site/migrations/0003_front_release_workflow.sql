PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_front_drafts (
  front_draft_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_front_draft_snapshots (
  draft_snapshot_id TEXT PRIMARY KEY,
  front_draft_id TEXT NOT NULL REFERENCES superboard_front_drafts(front_draft_id),
  instance_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  created_at TEXT NOT NULL,
  UNIQUE(front_draft_id, draft_revision)
);

CREATE TABLE IF NOT EXISTS superboard_front_compilations (
  compilation_id TEXT PRIMARY KEY,
  draft_snapshot_id TEXT NOT NULL REFERENCES superboard_front_draft_snapshots(draft_snapshot_id),
  candidate_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('compiled', 'failed', 'rejected', 'superseded')),
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_front_previews (
  preview_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES superboard_front_release_candidates(candidate_id),
  release_id TEXT NOT NULL,
  content_checksum TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience = 'front_preview'),
  mutation_mode TEXT NOT NULL CHECK (mutation_mode = 'dry_run'),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_operator_reauthentication_receipts (
  receipt_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('front_release.approve', 'front_release.activate', 'front_release.rollback')),
  candidate_id TEXT NOT NULL,
  reauthenticated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  receipt_checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS superboard_front_approval_reauthentication (
  candidate_id TEXT PRIMARY KEY
    REFERENCES superboard_front_release_candidates(candidate_id),
  receipt_id TEXT NOT NULL UNIQUE
    REFERENCES superboard_operator_reauthentication_receipts(receipt_id),
  linked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_superboard_front_snapshots_draft
  ON superboard_front_draft_snapshots(front_draft_id);
CREATE INDEX IF NOT EXISTS idx_superboard_front_compilations_snapshot
  ON superboard_front_compilations(draft_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_superboard_front_previews_candidate
  ON superboard_front_previews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_superboard_operator_reauth_candidate
  ON superboard_operator_reauthentication_receipts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_superboard_front_approval_reauth_receipt
  ON superboard_front_approval_reauthentication(receipt_id);

CREATE TRIGGER IF NOT EXISTS superboard_operator_reauth_immutable_update
BEFORE UPDATE ON superboard_operator_reauthentication_receipts
BEGIN
  SELECT RAISE(ABORT, 'operator reauthentication receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_operator_reauth_immutable_delete
BEFORE DELETE ON superboard_operator_reauthentication_receipts
BEGIN
  SELECT RAISE(ABORT, 'operator reauthentication receipts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_approval_reauth_immutable_update
BEFORE UPDATE ON superboard_front_approval_reauthentication
BEGIN
  SELECT RAISE(ABORT, 'approval reauthentication links are immutable');
END;

CREATE TRIGGER IF NOT EXISTS superboard_approval_reauth_immutable_delete
BEFORE DELETE ON superboard_front_approval_reauthentication
BEGIN
  SELECT RAISE(ABORT, 'approval reauthentication links are immutable');
END;
