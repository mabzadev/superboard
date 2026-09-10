-- Preserve immutable audit history while permitting the two narrowly scoped
-- privacy transformations required by account erasure:
--   1. FK detachment when a conversation is deleted.
--   2. One-way pseudonymisation of an application user's actor identifier.
DROP TRIGGER IF EXISTS support_audit_no_update;

CREATE TRIGGER support_audit_immutable_fields
BEFORE UPDATE OF id, project_id, event_type, actor_kind, created_at
ON support_audit_events
BEGIN
  SELECT RAISE(ABORT, 'support audit immutable fields cannot be updated');
END;

CREATE TRIGGER support_audit_conversation_detach_only
BEFORE UPDATE OF conversation_id ON support_audit_events
WHEN NOT (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'support audit conversation can only be detached');
END;

CREATE TRIGGER support_audit_privacy_redaction_only
BEFORE UPDATE OF actor_id, payload_json ON support_audit_events
WHEN NOT (
  OLD.actor_kind = 'user'
  AND NEW.actor_id LIKE 'erased:%'
  AND NEW.payload_json = '{}'
)
BEGIN
  SELECT RAISE(ABORT, 'support audit actor can only be privacy-redacted');
END;
