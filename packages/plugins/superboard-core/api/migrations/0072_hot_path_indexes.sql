-- Hot-path indexes for public short-link redirects, scheduled maintenance and
-- dashboard metric filters. Plain (non-unique) indexes: quick link paths are
-- generated with an existence check but legacy imports never enforced
-- uniqueness, so a UNIQUE index could fail on existing data.

-- GET /:code and GET /* look quick links up by path on every short-link hit.
CREATE INDEX IF NOT EXISTS idx_quick_links_path ON quick_links(path);

-- Redirect device reuse: WHERE ip = ? AND user_agent = ? AND updated_at >= ?
-- ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS idx_devices_ip_user_agent_updated_at
  ON devices(ip, user_agent, updated_at);

-- Maintenance: DELETE FROM actions WHERE handled = 1 AND updated_at < ?.
CREATE INDEX IF NOT EXISTS idx_actions_handled_updated_at ON actions(handled, updated_at);

-- GET /projects/:id/events/metric_values: covering index for the three
-- SELECT DISTINCT queries (platform, app_version, build) per project.
CREATE INDEX IF NOT EXISTS idx_events_project_platform_version_build
  ON events(project_id, platform, app_version, build);

-- Daily maintenance prunes raw observations older than the retention window
-- across all instances: WHERE observed_at < ? ORDER BY observed_at.
CREATE INDEX IF NOT EXISTS idx_observability_observations_observed_at
  ON observability_observations(observed_at);
