CREATE TABLE IF NOT EXISTS gateway_operator_routes (
 instance_id TEXT NOT NULL, route_id TEXT NOT NULL, route_json TEXT NOT NULL,
 revision INTEGER NOT NULL, operation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 updated_at TEXT NOT NULL, PRIMARY KEY(instance_id,route_id)
);
CREATE TABLE IF NOT EXISTS gateway_operator_manifests (
 instance_id TEXT NOT NULL, manifest_id TEXT NOT NULL, routes_json TEXT NOT NULL,
 checksum TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(instance_id,manifest_id)
);
CREATE TABLE IF NOT EXISTS gateway_operator_active (
 instance_id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gateway_operator_policies (
 instance_id TEXT PRIMARY KEY, version INTEGER NOT NULL, policy_json TEXT NOT NULL,
 operation_id TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gateway_operator_limits (
 instance_id TEXT NOT NULL, route_id TEXT NOT NULL, window_start INTEGER NOT NULL,
 requests INTEGER NOT NULL, PRIMARY KEY(instance_id,route_id,window_start)
);
