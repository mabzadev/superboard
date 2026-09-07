CREATE TABLE IF NOT EXISTS superboard_plugin_workflow_waiters (
 waiter_id TEXT PRIMARY KEY,
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL,
 plugin_id TEXT NOT NULL,
 workflow_binding TEXT NOT NULL,
 workflow_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','notified')),
 created_at TEXT NOT NULL,
 notified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_superboard_plugin_workflow_waiters_pending
 ON superboard_plugin_workflow_waiters(instance_id, target, state);
