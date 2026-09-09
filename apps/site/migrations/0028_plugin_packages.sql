CREATE TABLE IF NOT EXISTS superboard_plugin_packages (
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL CHECK(target IN ('local','development','production')),
 package_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version TEXT NOT NULL,
 artifact_checksum TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(instance_id,target,package_id)
);
CREATE TABLE IF NOT EXISTS superboard_plugin_feature_preferences (
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL CHECK(target IN ('local','development','production')),
 component_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(instance_id,target,component_id)
);
CREATE TABLE IF NOT EXISTS superboard_plugin_package_migrations (
 instance_id TEXT NOT NULL,
 target TEXT NOT NULL,
 migration_id TEXT NOT NULL,
 completed_at TEXT NOT NULL,
 PRIMARY KEY(instance_id,target,migration_id)
);
