PRAGMA foreign_keys = ON;

-- Reporting facts are written in the same D1 transaction as their source
-- mutation. This keeps exports and rollups useful even when a Queue consumer
-- is delayed and avoids deriving historical facts from mutable current rows.
CREATE TRIGGER IF NOT EXISTS support_report_conversation_created
AFTER INSERT ON conversations
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, membership_id,
    team_id, occurred_at, dimensions_json, metrics_json
  ) VALUES (
    lower(hex(randomblob(16))), NEW.project_id, 'conversation.created', NEW.id,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_inboxes WHERE id = NEW.inbox_id AND project_id = NEW.project_id
    ) THEN NEW.inbox_id END,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_memberships WHERE id = NEW.assigned_user_id AND project_id = NEW.project_id
    ) THEN NEW.assigned_user_id END,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_teams WHERE id = NEW.assigned_team_id AND project_id = NEW.project_id
    ) THEN NEW.assigned_team_id END,
    NEW.created_at,
    json_object('status', NEW.status, 'priority', NEW.priority),
    json_object('count', 1)
  );
END;

CREATE TRIGGER IF NOT EXISTS support_report_conversation_status
AFTER UPDATE OF status ON conversations
WHEN OLD.status IS NOT NEW.status
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, membership_id,
    team_id, occurred_at, dimensions_json, metrics_json
  ) VALUES (
    lower(hex(randomblob(16))), NEW.project_id, 'conversation.status_updated', NEW.id,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_inboxes WHERE id = NEW.inbox_id AND project_id = NEW.project_id
    ) THEN NEW.inbox_id END,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_memberships WHERE id = NEW.assigned_user_id AND project_id = NEW.project_id
    ) THEN NEW.assigned_user_id END,
    CASE WHEN EXISTS (
      SELECT 1 FROM support_teams WHERE id = NEW.assigned_team_id AND project_id = NEW.project_id
    ) THEN NEW.assigned_team_id END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    json_object('from', OLD.status, 'to', NEW.status, 'priority', NEW.priority),
    json_object(
      'count', 1,
      'resolution_seconds', CASE WHEN NEW.status = 'closed'
        THEN MAX(0, CAST((julianday(COALESCE(NEW.resolved_at, 'now')) - julianday(NEW.created_at)) * 86400 AS INTEGER))
        ELSE NULL END
    )
  );
END;

CREATE TRIGGER IF NOT EXISTS support_report_message_created
AFTER INSERT ON messages
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, membership_id,
    team_id, provider, occurred_at, dimensions_json, metrics_json
  )
  SELECT
    lower(hex(randomblob(16))), conversation.project_id, 'message.created', conversation.id,
    CASE WHEN inbox.id IS NOT NULL THEN conversation.inbox_id END,
    CASE WHEN membership.id IS NOT NULL THEN conversation.assigned_user_id END,
    CASE WHEN team.id IS NOT NULL THEN conversation.assigned_team_id END,
    endpoint.provider, NEW.created_at,
    json_object('sender_kind', NEW.sender_kind, 'visibility', COALESCE(NEW.visibility, 'public'),
      'content_type', COALESCE(NEW.content_type, 'text')),
    json_object('count', 1)
  FROM conversations conversation
  LEFT JOIN support_inboxes inbox
    ON inbox.id = conversation.inbox_id AND inbox.project_id = conversation.project_id
  LEFT JOIN support_memberships membership
    ON membership.id = conversation.assigned_user_id AND membership.project_id = conversation.project_id
  LEFT JOIN support_teams team
    ON team.id = conversation.assigned_team_id AND team.project_id = conversation.project_id
  LEFT JOIN support_provider_endpoints endpoint
    ON endpoint.inbox_id = conversation.inbox_id AND endpoint.project_id = conversation.project_id
  WHERE conversation.id = NEW.conversation_id
  ORDER BY endpoint.created_at, endpoint.id
  LIMIT 1;
END;

CREATE TRIGGER IF NOT EXISTS support_report_delivery_updated
AFTER UPDATE OF delivery_status ON messages
WHEN OLD.delivery_status IS NOT NEW.delivery_status
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, provider,
    occurred_at, dimensions_json, metrics_json
  )
  SELECT lower(hex(randomblob(16))), conversation.project_id, 'delivery.updated', conversation.id,
    CASE WHEN inbox.id IS NOT NULL THEN conversation.inbox_id END,
    endpoint.provider, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    json_object('from', OLD.delivery_status, 'to', NEW.delivery_status),
    json_object('count', 1)
  FROM conversations conversation
  LEFT JOIN support_inboxes inbox
    ON inbox.id = conversation.inbox_id AND inbox.project_id = conversation.project_id
  LEFT JOIN support_provider_endpoints endpoint
    ON endpoint.inbox_id = conversation.inbox_id AND endpoint.project_id = conversation.project_id
  WHERE conversation.id = NEW.conversation_id
  ORDER BY endpoint.created_at, endpoint.id
  LIMIT 1;
END;

CREATE TRIGGER IF NOT EXISTS support_report_assignment
AFTER INSERT ON support_assignment_events
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, membership_id, team_id,
    occurred_at, dimensions_json, metrics_json
  ) VALUES (
    lower(hex(randomblob(16))), NEW.project_id, 'assignment.updated', NEW.conversation_id,
    NEW.membership_id, NEW.team_id, NEW.created_at,
    json_object('reason', NEW.reason), json_object('count', 1)
  );
END;

CREATE TRIGGER IF NOT EXISTS support_report_sla
AFTER INSERT ON support_sla_events
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, occurred_at,
    dimensions_json, metrics_json
  ) VALUES (
    lower(hex(randomblob(16))), NEW.project_id, 'sla.' || NEW.event_type,
    NEW.conversation_id, NEW.created_at,
    json_object('target', NEW.target), json_object('count', 1)
  );
END;

CREATE TRIGGER IF NOT EXISTS support_report_campaign_delivery_created
AFTER INSERT ON support_campaign_deliveries
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, provider,
    occurred_at, dimensions_json, metrics_json
  )
  SELECT lower(hex(randomblob(16))), NEW.project_id, 'proactive.delivery_created', NEW.conversation_id,
    campaign.inbox_id, endpoint.provider, NEW.created_at,
    json_object('status', NEW.status, 'campaign_id', NEW.campaign_id), json_object('count', 1)
  FROM support_campaigns campaign
  LEFT JOIN support_provider_endpoints endpoint
    ON endpoint.id = NEW.endpoint_id AND endpoint.project_id = NEW.project_id
  WHERE campaign.id = NEW.campaign_id AND campaign.project_id = NEW.project_id;
END;

CREATE TRIGGER IF NOT EXISTS support_report_campaign_delivery_status
AFTER UPDATE OF status ON support_campaign_deliveries
WHEN OLD.status IS NOT NEW.status
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, inbox_id, provider,
    occurred_at, dimensions_json, metrics_json
  )
  SELECT lower(hex(randomblob(16))), NEW.project_id, 'proactive.delivery_updated', NEW.conversation_id,
    campaign.inbox_id, endpoint.provider, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    json_object('from', OLD.status, 'to', NEW.status, 'campaign_id', NEW.campaign_id),
    json_object('count', 1)
  FROM support_campaigns campaign
  LEFT JOIN support_provider_endpoints endpoint
    ON endpoint.id = NEW.endpoint_id AND endpoint.project_id = NEW.project_id
  WHERE campaign.id = NEW.campaign_id AND campaign.project_id = NEW.project_id;
END;

CREATE TRIGGER IF NOT EXISTS support_report_csat
AFTER INSERT ON support_csat_responses
BEGIN
  INSERT INTO support_report_events (
    id, project_id, event_type, conversation_id, occurred_at,
    dimensions_json, metrics_json
  ) VALUES (
    lower(hex(randomblob(16))), NEW.project_id, 'csat.response', NEW.conversation_id,
    NEW.created_at, '{}', json_object('count', 1, 'rating', NEW.rating)
  );
END;
