PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS superboard_front_permission_grants (
  instance_id TEXT NOT NULL,
  role INTEGER NOT NULL,
  permission TEXT NOT NULL,
  granted_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance_id, role, permission)
);

INSERT INTO superboard_front_permission_grants (instance_id, role, permission)
VALUES ('*', 50, '*')
ON CONFLICT(instance_id, role, permission) DO NOTHING;
