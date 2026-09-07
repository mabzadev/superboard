CREATE TABLE IF NOT EXISTS superboard_plugin_task_leases (
 lease_id TEXT PRIMARY KEY,
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL,
 plugin_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('scheduled','queue','alarm','tail','retention','workflow','runtime')),
 token_checksum TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','finished')),
 release_id TEXT,
 started_at TEXT NOT NULL,
 deadline_at TEXT NOT NULL,
 finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_superboard_plugin_task_leases_running
 ON superboard_plugin_task_leases(instance_id, target, plugin_id, state, deadline_at);
CREATE INDEX IF NOT EXISTS idx_superboard_plugin_task_leases_task
 ON superboard_plugin_task_leases(instance_id, plugin_id, task_id);
