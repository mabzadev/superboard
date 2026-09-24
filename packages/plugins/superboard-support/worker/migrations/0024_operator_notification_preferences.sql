CREATE TABLE IF NOT EXISTS support_operator_notification_preferences (
 project_id INTEGER NOT NULL,
 operator_id TEXT NOT NULL,
 email_enabled INTEGER NOT NULL DEFAULT 1 CHECK(email_enabled IN (0,1)),
 push_enabled INTEGER NOT NULL DEFAULT 1 CHECK(push_enabled IN (0,1)),
 browser_enabled INTEGER NOT NULL DEFAULT 1 CHECK(browser_enabled IN (0,1)),
 in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK(in_app_enabled IN (0,1)),
 audio_enabled INTEGER NOT NULL DEFAULT 1 CHECK(audio_enabled IN (0,1)),
 muted_event_types_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(muted_event_types_json)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(project_id,operator_id)
);
