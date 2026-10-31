PRAGMA foreign_keys = ON;

-- Audience changes that automations can react to. Rows are written by the
-- triggers below only while an active journey references the event, then
-- turned into journey signals by the scheduled worker and deleted.
CREATE TABLE IF NOT EXISTS marketing_native_event_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  subscriber_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS marketing_native_contact_created
AFTER INSERT ON subscribers
WHEN EXISTS (
  SELECT 1 FROM marketing_journeys journey
  WHERE journey.project_id = NEW.project_id AND journey.status = 'active'
    AND (journey.trigger_event_name = '*'
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'contact_created') > 0
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'marketing.contact.created') > 0)
)
BEGIN
  INSERT INTO marketing_native_event_outbox (project_id, subscriber_id, event_name, properties_json)
  VALUES (NEW.project_id, NEW.id, 'marketing.contact.created', '{}');
END;

CREATE TRIGGER IF NOT EXISTS marketing_native_list_joined
AFTER INSERT ON subscriber_list_memberships
WHEN EXISTS (
  SELECT 1 FROM marketing_journeys journey
  WHERE journey.project_id = NEW.project_id AND journey.status = 'active'
    AND (journey.trigger_event_name = '*'
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'contact_joined_list') > 0
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'marketing.list.joined') > 0)
)
BEGIN
  INSERT INTO marketing_native_event_outbox (project_id, subscriber_id, event_name, properties_json)
  VALUES (NEW.project_id, NEW.subscriber_id, 'marketing.list.joined',
    json_object('list_id', NEW.list_id, 'source', NEW.source,
      'list_name', (SELECT name FROM subscriber_lists WHERE id = NEW.list_id)));
END;

CREATE TRIGGER IF NOT EXISTS marketing_native_tag_added
AFTER INSERT ON subscriber_tag_assignments
WHEN EXISTS (
  SELECT 1 FROM marketing_journeys journey
  WHERE journey.project_id = NEW.project_id AND journey.status = 'active'
    AND (journey.trigger_event_name = '*'
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'tag_added') > 0
      OR instr(journey.trigger_event_name || ' ' || journey.definition_json, 'marketing.tag.added') > 0)
)
BEGIN
  INSERT INTO marketing_native_event_outbox (project_id, subscriber_id, event_name, properties_json)
  VALUES (NEW.project_id, NEW.subscriber_id, 'marketing.tag.added',
    json_object('tag_id', NEW.tag_id,
      'tag_name', (SELECT name FROM subscriber_tags WHERE id = NEW.tag_id)));
END;

-- "Wait until event" steps: one row per enrollment and step.
CREATE TABLE IF NOT EXISTS marketing_journey_waits (
  project_id INTEGER NOT NULL,
  enrollment_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'timed_out')),
  expires_at TEXT NOT NULL,
  matched_event_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, enrollment_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_journey_waits_subscriber
  ON marketing_journey_waits(project_id, subscriber_id, status);

-- Journey goals: an enrollment that reaches the goal event exits as converted.
CREATE TABLE IF NOT EXISTS marketing_journey_goals (
  project_id INTEGER NOT NULL,
  enrollment_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  reached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, enrollment_id)
);
CREATE INDEX IF NOT EXISTS idx_marketing_journey_goals_journey
  ON marketing_journey_goals(project_id, journey_id);

-- Date-based triggers run at most once per journey and local day.
CREATE TABLE IF NOT EXISTS marketing_date_trigger_runs (
  project_id INTEGER NOT NULL,
  journey_id TEXT NOT NULL,
  run_date TEXT NOT NULL,
  enrolled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (project_id, journey_id, run_date)
);
