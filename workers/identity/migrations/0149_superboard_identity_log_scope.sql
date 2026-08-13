ALTER TABLE email_log ADD COLUMN "projectId" INTEGER;
ALTER TABLE sms_log ADD COLUMN "projectId" INTEGER;
ALTER TABLE sign_in_log ADD COLUMN "projectId" INTEGER;

CREATE INDEX email_log_project_idx
  ON email_log ("projectId", id DESC)
  WHERE "projectId" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX sms_log_project_idx
  ON sms_log ("projectId", id DESC)
  WHERE "projectId" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX sign_in_log_project_idx
  ON sign_in_log ("projectId", id DESC)
  WHERE "projectId" IS NOT NULL AND "deletedAt" IS NULL;

-- Existing sign-in rows are safe to attribute only when the user belongs to
-- exactly one SuperBoard project. Ambiguous historical rows remain hidden
-- from every project administrator.
UPDATE sign_in_log
SET "projectId" = (
  SELECT MIN(bridge.project_id)
  FROM identity_subject_bridge bridge
  WHERE bridge.melody_user_id = sign_in_log."userId"
  GROUP BY bridge.melody_user_id
  HAVING COUNT(DISTINCT bridge.project_id) = 1
)
WHERE "projectId" IS NULL;
