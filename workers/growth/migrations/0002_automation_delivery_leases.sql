ALTER TABLE growth_automation_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE growth_automation_runs ADD COLUMN claimed_at TEXT;
ALTER TABLE growth_automation_runs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE growth_automation_runs ADD COLUMN delivered_at TEXT;

CREATE INDEX growth_automation_runs_delivery_idx
  ON growth_automation_runs (status, next_attempt_at, claimed_at);
