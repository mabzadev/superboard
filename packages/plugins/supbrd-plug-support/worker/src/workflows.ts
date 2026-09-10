import type { Env } from './types';
import { recordSlaResolution } from './service-levels';

type WorkflowField = 'status' | 'priority' | 'inbox_id' | 'assigned_user_id'
  | 'assigned_team_id' | 'sender_kind' | 'visibility' | 'labels' | 'subject'
  | 'external_user_id';
type WorkflowAtomicCondition = {
  field: WorkflowField;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'present' | 'not_present' | 'greater_than' | 'greater_or_equal' | 'less_than' | 'less_or_equal' | 'includes_any' | 'includes_all' | 'starts_with' | 'ends_with' | 'matches';
  value?: string | number | boolean | string[];
};
type WorkflowCondition = WorkflowAtomicCondition | {
  mode: 'all' | 'any';
  conditions: WorkflowCondition[];
};

type WorkflowAction = {
  type: 'set_status' | 'set_priority' | 'set_snooze' | 'assign_agent' | 'assign_team' | 'assign_inbox' | 'add_label' | 'remove_label' | 'notify_agent' | 'send_message' | 'trigger_webhook' | 'trigger_integration';
  value?: string;
  agent_id?: string;
  title?: string;
  body?: string;
  visibility?: 'public' | 'private';
  duration_minutes?: number;
};

const actionTypes = new Set<WorkflowAction['type']>([
  'set_status', 'set_priority', 'assign_agent', 'assign_team',
  'set_snooze', 'assign_inbox', 'add_label', 'remove_label', 'notify_agent',
  'send_message', 'trigger_webhook', 'trigger_integration',
]);
const conditionFields = new Set<WorkflowField>([
  'status', 'priority', 'inbox_id', 'assigned_user_id', 'assigned_team_id',
  'sender_kind', 'visibility', 'labels', 'subject', 'external_user_id',
]);
const conditionOperators = new Set([
  'equals', 'not_equals', 'contains', 'not_contains', 'present', 'not_present',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'includes_any', 'includes_all', 'starts_with', 'ends_with', 'matches',
]);

export function validateWorkflowConfiguration(
  entityType: string,
  configuration: Record<string, unknown>,
) {
  if (!['automation_rule', 'macro'].includes(entityType)) return;
  const actions = configuration.actions;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 20) {
    throw failure('workflow_actions_invalid', 'Workflow actions must contain between 1 and 20 actions');
  }
  for (const raw of actions) validateAction(raw);
  if (entityType === 'automation_rule') {
    const conditions = configuration.conditions;
    if (!Array.isArray(conditions) || conditions.length > 20) {
      throw failure('workflow_conditions_invalid', 'Automation conditions must be an array with at most 20 conditions');
    }
    let nodes = 0;
    for (const raw of conditions) nodes += validateCondition(raw);
    if (nodes > 50) throw failure('workflow_conditions_invalid', 'Automation conditions are limited to 50 nodes');
  }
}

export async function runConversationAutomations(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  conversationId: string,
  eventName: string,
  eventId: string,
  event: Record<string, unknown> = {},
) {
  const rows = await env.DB.prepare(`
    SELECT id, json_object(
      'event_name', event_name,
      'condition_mode', condition_mode,
      'conditions', json(conditions_json),
      'actions', json(actions_json)
    ) configuration_json, position, created_at
    FROM support_automation_rules
    WHERE project_id = ? AND active = 1 AND event_name = ?
    ORDER BY position, created_at
  `).bind(projectId, eventName).all<{ id: string; configuration_json: string }>();
  for (const row of rows.results) {
    let configuration: Record<string, unknown>;
    try {
      configuration = JSON.parse(row.configuration_json) as Record<string, unknown>;
      validateWorkflowConfiguration('automation_rule', configuration);
    } catch (error) {
      console.error(JSON.stringify({ event: 'support_automation_invalid', rule_id: row.id, error: String(error) }));
      continue;
    }
    const claimed = await env.DB.prepare(`
      INSERT INTO support_rule_executions
        (id, project_id, rule_id, event_id, conversation_id, event_name)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(rule_id, event_id) DO NOTHING RETURNING id
    `).bind(crypto.randomUUID(), projectId, row.id, eventId, conversationId, eventName).first();
    if (!claimed) continue;
    const conversation = await conversationById(env.DB, projectId, conversationId);
    const conditions = configuration.conditions as WorkflowCondition[];
    const conditionMode = configuration.condition_mode === 'any' ? 'any' : 'all';
    const matched = conditionMode === 'any'
      ? conditions.some((condition) => matches(condition, conversation, event))
      : conditions.every((condition) => matches(condition, conversation, event));
    if (!matched) {
      await recordResult(env.DB, row.id, eventId, { matched: false });
      continue;
    }
    const result = await executeActions(env, projectId, conversation, configuration.actions as WorkflowAction[], `automation:${row.id}`);
    await recordResult(env.DB, row.id, eventId, { matched: true, ...result });
  }
}

export async function executeMacro(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  conversationId: string,
  macroId: string,
  actorId: string,
) {
  const macro = await env.DB.prepare(`
    SELECT id, json_object('actions', json(actions_json)) configuration_json
    FROM support_macros
    WHERE project_id = ? AND id = ? AND active = 1
  `).bind(projectId, macroId).first<{ id: string; configuration_json: string }>();
  if (!macro) throw failure('macro_not_found', 'Enabled macro not found', 404);
  const configuration = JSON.parse(macro.configuration_json) as Record<string, unknown>;
  validateWorkflowConfiguration('macro', configuration);
  const conversation = await conversationById(env.DB, projectId, conversationId);
  return executeActions(env, projectId, conversation, configuration.actions as WorkflowAction[], actorId);
}

async function executeActions(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  conversation: Record<string, unknown>,
  actions: WorkflowAction[],
  actorId: string,
) {
  const db = env.DB;
  let status = String(conversation.status || 'open');
  let priority = String(conversation.priority || 'normal');
  let assignedUser = conversation.assigned_user_id == null ? null : String(conversation.assigned_user_id);
  let assignedTeam = conversation.assigned_team_id == null ? null : String(conversation.assigned_team_id);
  let inboxId = conversation.inbox_id == null ? null : String(conversation.inbox_id);
  let snoozedUntil = conversation.snoozed_until == null ? null : String(conversation.snoozed_until);
  const labels = new Set(parseStringArray(conversation.labels_json));
  const notifications: WorkflowAction[] = [];
  const messages: WorkflowAction[] = [];
  const integrations: WorkflowAction[] = [];
  for (const action of actions) {
    if (action.type === 'set_status') status = action.value!;
    else if (action.type === 'set_priority') priority = action.value!;
    else if (action.type === 'assign_agent') assignedUser = action.value || null;
    else if (action.type === 'assign_team') assignedTeam = action.value || null;
    else if (action.type === 'assign_inbox') inboxId = action.value || null;
    else if (action.type === 'set_snooze') snoozedUntil = action.duration_minutes
      ? new Date(Date.now() + action.duration_minutes * 60_000).toISOString()
      : action.value || null;
    else if (action.type === 'add_label') labels.add(action.value!);
    else if (action.type === 'remove_label') labels.delete(action.value!);
    else if (action.type === 'notify_agent') notifications.push(action);
    else if (action.type === 'send_message') messages.push(action);
    else if (action.type === 'trigger_webhook' || action.type === 'trigger_integration') integrations.push(action);
  }
  await validateActionTargets(db, projectId, { assignedUser, assignedTeam, inboxId, labels: [...labels] });
  if (integrations.length > 0) {
    await validateWorkflowIntegrations(db, projectId, integrations);
  }
  await db.prepare(`
    UPDATE conversations SET status = ?, priority = ?, assigned_user_id = ?, assigned_team_id = ?, inbox_id = ?, snoozed_until = ?,
      labels_json = ?, resolved_at = CASE WHEN ? = 'closed' THEN COALESCE(resolved_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `).bind(status, priority, assignedUser, assignedTeam, inboxId, snoozedUntil, JSON.stringify([...labels]), status, conversation.id, projectId).run();
  await db.prepare(`DELETE FROM support_conversation_labels WHERE project_id = ? AND conversation_id = ?`)
    .bind(projectId, conversation.id).run();
  if (labels.size) {
    await db.batch([...labels].map((labelId) => db.prepare(`INSERT INTO support_conversation_labels
      (project_id, conversation_id, label_id, assigned_by) VALUES (?, ?, ?, ?)`)
      .bind(projectId, conversation.id, labelId, actorId)));
  }
  if (status === 'closed') {
    await recordSlaResolution(db, projectId, String(conversation.id));
  }
  for (const notification of notifications) {
    await db.prepare(`
      INSERT INTO support_agent_notifications
        (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
      VALUES (?, ?, ?, 'workflow', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), projectId, notification.agent_id,
      notification.title, notification.body, conversation.id, JSON.stringify({ actor_id: actorId })).run();
  }
  for (const message of messages) {
    const next = await db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 sequence FROM messages WHERE conversation_id = ?')
      .bind(conversation.id).first<{ sequence: number }>();
    const messageId = crypto.randomUUID();
    const inserted = await db.prepare(`
      INSERT INTO messages
        (id, conversation_id, sender_kind, sender_id, body, client_message_id, sequence,
         visibility, content_type, metadata_json)
      VALUES (?, ?, 'system', ?, ?, ?, ?, ?, 'text', ?)
      RETURNING id, body, visibility, content_type, sequence, created_at
    `).bind(
      messageId, conversation.id, actorId, message.body,
      `workflow:${actorId}:${next?.sequence || 1}`, next?.sequence || 1,
      message.visibility || 'public', JSON.stringify({ workflow: true }),
    ).first<Record<string, unknown>>();
    if (inserted && (message.visibility || 'public') === 'public') {
      await enqueueWorkflowDelivery(env, projectId, String(conversation.id), messageId, String(message.body || ''));
    }
  }
  for (const integration of integrations) {
    const actionId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO support_scheduled_jobs
        (id, project_id, job_type, resource_id, queue_name, due_at, payload_json)
      VALUES (?, ?, ?, ?, 'events', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)
      ON CONFLICT(project_id, job_type, resource_id) DO NOTHING
    `).bind(
      actionId, projectId,
      integration.type === 'trigger_webhook' ? 'workflow.webhook' : 'workflow.integration',
      actionId,
      JSON.stringify({ conversation_id: conversation.id, target: integration.value }),
    ).run();
  }
  await db.prepare(`
    INSERT INTO support_audit_events
      (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
    VALUES (?, ?, ?, 'workflow.executed', 'system', ?, ?)
  `).bind(crypto.randomUUID(), conversation.id, projectId, actorId, JSON.stringify({ actions })).run();
  return { status, priority, assigned_user_id: assignedUser, assigned_team_id: assignedTeam,
    inbox_id: inboxId, snoozed_until: snoozedUntil, labels: [...labels], messages: messages.length,
    integrations: integrations.length };
}

function validateAction(value: unknown): asserts value is WorkflowAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('workflow_action_invalid', 'Every workflow action must be an object');
  const action = value as Record<string, unknown>;
  const type = String(action.type || '') as WorkflowAction['type'];
  if (!actionTypes.has(type)) throw failure('workflow_action_invalid', 'Workflow action type is not supported');
  if (type === 'set_status' && !['open', 'pending', 'closed'].includes(String(action.value))) throw failure('workflow_action_invalid', 'Workflow status is invalid');
  if (type === 'set_priority' && !['low', 'normal', 'high', 'urgent'].includes(String(action.value))) throw failure('workflow_action_invalid', 'Workflow priority is invalid');
  if (['assign_agent', 'assign_team'].includes(type) && action.value != null && String(action.value).length > 255) throw failure('workflow_action_invalid', 'Workflow assignment is invalid');
  if (type === 'assign_inbox' && (!String(action.value || '').trim() || String(action.value).length > 255)) throw failure('workflow_action_invalid', 'Workflow inbox is invalid');
  if (type === 'set_snooze') {
    const duration = Number(action.duration_minutes || 0);
    const date = action.value ? new Date(String(action.value)) : null;
    if ((!Number.isInteger(duration) || duration < 0 || duration > 525600)
      || (!duration && (!date || Number.isNaN(date.getTime())))) {
      throw failure('workflow_action_invalid', 'Workflow snooze is invalid');
    }
  }
  if (['add_label', 'remove_label'].includes(type) && (!String(action.value || '').trim() || String(action.value).length > 64)) throw failure('workflow_action_invalid', 'Workflow label is invalid');
  if (type === 'notify_agent') {
    if (!String(action.agent_id || '').trim() || String(action.agent_id).length > 255
      || !String(action.title || '').trim() || String(action.title).length > 255
      || !String(action.body || '').trim() || String(action.body).length > 2000) {
      throw failure('workflow_action_invalid', 'Workflow notification is invalid');
    }
  }
  if (type === 'send_message' && (!String(action.body || '').trim() || String(action.body).length > 8000
    || !['public', 'private', undefined].includes(action.visibility as 'public' | 'private' | undefined))) {
    throw failure('workflow_action_invalid', 'Workflow message is invalid');
  }
  if (['trigger_webhook', 'trigger_integration'].includes(type)
    && (!String(action.value || '').trim() || String(action.value).length > 255)) {
    throw failure('workflow_action_invalid', 'Workflow integration target is invalid');
  }
}

function validateCondition(value: unknown, depth = 0): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('workflow_condition_invalid', 'Every automation condition must be an object');
  const condition = value as Record<string, unknown>;
  if (condition.mode === 'all' || condition.mode === 'any') {
    if (depth >= 3 || !Array.isArray(condition.conditions) || condition.conditions.length < 1 || condition.conditions.length > 20) {
      throw failure('workflow_condition_invalid', 'Automation condition group is invalid');
    }
    return 1 + condition.conditions.reduce((total, child) => total + validateCondition(child, depth + 1), 0);
  }
  if (!conditionFields.has(String(condition.field) as WorkflowField)
    || !conditionOperators.has(String(condition.operator))
    || (!['present', 'not_present'].includes(String(condition.operator))
      && (condition.value == null || JSON.stringify(condition.value).length > 2000))) {
    throw failure('workflow_condition_invalid', 'Automation condition is invalid');
  }
  if (condition.operator === 'matches') {
    try { new RegExp(String(condition.value), 'iu'); } catch { throw failure('workflow_condition_invalid', 'Automation text pattern is invalid'); }
  }
  return 1;
}

function matches(condition: WorkflowCondition, conversation: Record<string, unknown>, event: Record<string, unknown>): boolean {
  if ('mode' in condition) {
    return condition.mode === 'any'
      ? condition.conditions.some((child) => matches(child, conversation, event))
      : condition.conditions.every((child) => matches(child, conversation, event));
  }
  const actual = condition.field === 'sender_kind' || condition.field === 'visibility'
    ? event[condition.field]
    : condition.field === 'labels' ? parseStringArray(conversation.labels_json) : conversation[condition.field];
  const expected = condition.value;
  if (condition.operator === 'present') return actual != null && String(actual).length > 0;
  if (condition.operator === 'not_present') return actual == null || String(actual).length === 0;
  if (condition.operator === 'contains' || condition.operator === 'not_contains') {
    const contains = Array.isArray(actual)
      ? actual.map(String).includes(String(expected))
      : String(actual ?? '').toLocaleLowerCase().includes(String(expected ?? '').toLocaleLowerCase());
    return condition.operator === 'contains' ? contains : !contains;
  }
  if (condition.operator === 'includes_any' || condition.operator === 'includes_all') {
    const actualValues = Array.isArray(actual) ? actual.map(String) : [String(actual ?? '')];
    const expectedValues = Array.isArray(expected) ? expected.map(String) : [String(expected ?? '')];
    return condition.operator === 'includes_any'
      ? expectedValues.some((item) => actualValues.includes(item))
      : expectedValues.every((item) => actualValues.includes(item));
  }
  if (condition.operator === 'starts_with') return String(actual ?? '').startsWith(String(expected ?? ''));
  if (condition.operator === 'ends_with') return String(actual ?? '').endsWith(String(expected ?? ''));
  if (condition.operator === 'matches') return new RegExp(String(expected), 'iu').test(String(actual ?? ''));
  if (['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal'].includes(condition.operator)) {
    const left = Number(actual); const right = Number(expected);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (condition.operator === 'greater_than') return left > right;
    if (condition.operator === 'greater_or_equal') return left >= right;
    if (condition.operator === 'less_than') return left < right;
    return left <= right;
  }
  const equal = String(actual ?? '') === String(expected ?? '');
  return condition.operator === 'equals' ? equal : !equal;
}

async function conversationById(db: D1Database, projectId: number, id: string) {
  const conversation = await db.prepare(`SELECT conversation.*,
    COALESCE((SELECT json_group_array(linked.label_id)
      FROM support_conversation_labels linked
      WHERE linked.project_id = conversation.project_id
        AND linked.conversation_id = conversation.id), '[]') AS labels_json
    FROM conversations conversation WHERE conversation.project_id = ? AND conversation.id = ?`)
    .bind(projectId, id).first<Record<string, unknown>>();
  if (!conversation) throw failure('conversation_not_found', 'Conversation not found', 404);
  return conversation;
}

async function validateActionTargets(
  db: D1Database,
  projectId: number,
  target: {
    assignedUser: string | null;
    assignedTeam: string | null;
    inboxId: string | null;
    labels: string[];
  },
) {
  if (target.assignedUser) {
    const member = await db.prepare(`SELECT id FROM support_memberships
      WHERE project_id = ? AND id = ? AND active = 1 LIMIT 1`)
      .bind(projectId, target.assignedUser).first();
    if (!member) throw failure('support_membership_not_found', 'Active Support membership not found', 404);
  }
  if (target.assignedTeam) {
    const team = await db.prepare(`SELECT id FROM support_teams
      WHERE project_id = ? AND id = ? AND active = 1 LIMIT 1`)
      .bind(projectId, target.assignedTeam).first();
    if (!team) throw failure('support_team_not_found', 'Active Support team not found', 404);
  }
  if (target.inboxId) {
    const inbox = await db.prepare(`SELECT id FROM support_inboxes
      WHERE project_id = ? AND id = ? AND status = 'active' LIMIT 1`)
      .bind(projectId, target.inboxId).first();
    if (!inbox) throw failure('inbox_not_found', 'Active inbox not found', 404);
  }
  if (target.inboxId && target.assignedUser) {
    const allowed = await db.prepare(`SELECT 1 allowed FROM support_inbox_members
      WHERE project_id = ? AND inbox_id = ? AND membership_id = ? LIMIT 1`)
      .bind(projectId, target.inboxId, target.assignedUser).first();
    if (!allowed) throw failure(
      'support_inbox_membership_required',
      'Assigned agent is not a member of the inbox',
      422,
    );
  }
  const labels = [...new Set(target.labels)];
  if (labels.length) {
    const placeholders = labels.map(() => '?').join(', ');
    const existing = await db.prepare(`SELECT id FROM support_labels
      WHERE project_id = ? AND active = 1 AND id IN (${placeholders})`)
      .bind(projectId, ...labels).all<{ id: string }>();
    if (existing.results.length !== labels.length) {
      throw failure('label_not_found', 'One or more active labels were not found', 404);
    }
  }
}

async function enqueueWorkflowDelivery(
  env: Pick<Env, 'DB' | 'SUPPORT_QUEUE'>,
  projectId: number,
  conversationId: string,
  messageId: string,
  body: string,
) {
  const endpoint = await env.DB.prepare(`SELECT endpoint.id, endpoint.provider
    FROM support_provider_endpoints endpoint
    INNER JOIN conversations conversation
      ON conversation.inbox_id = endpoint.inbox_id
      AND conversation.project_id = endpoint.project_id
    WHERE conversation.project_id = ? AND conversation.id = ?
      AND endpoint.status IN ('configured', 'validated', 'live_validated')
    ORDER BY endpoint.created_at, endpoint.id LIMIT 1`)
    .bind(projectId, conversationId).first<{ id: string; provider: string }>();
  if (!endpoint || endpoint.provider === 'widget' || endpoint.provider === 'api') return;
  const deliveryId = crypto.randomUUID();
  const idempotencyKey = `${endpoint.id}:${messageId}`;
  const inserted = await env.DB.prepare(`INSERT INTO support_provider_deliveries
      (id, project_id, endpoint_id, conversation_id, message_id, operation,
       idempotency_key, request_json, status)
    VALUES (?, ?, ?, ?, ?, 'automation.message.send', ?, ?, 'queued')
    ON CONFLICT(endpoint_id, idempotency_key) DO NOTHING RETURNING id`)
    .bind(
      deliveryId,
      projectId,
      endpoint.id,
      conversationId,
      messageId,
      idempotencyKey,
      JSON.stringify({ body, attachments: [] }),
    ).first<{ id: string }>();
  if (!inserted) return;
  await env.DB.prepare(`UPDATE messages SET delivery_status = 'pending'
    WHERE id = ? AND conversation_id = ?`).bind(messageId, conversationId).run();
  await env.SUPPORT_QUEUE.send({
    type: 'support.provider.delivery.send.v1',
    projectId,
    deliveryId,
  }, { contentType: 'json' });
}

async function validateWorkflowIntegrations(
  db: D1Database,
  projectId: number,
  actions: WorkflowAction[],
) {
  for (const action of actions) {
    const id = String(action.value || '');
    const provider = action.type === 'trigger_webhook' ? 'webhook' : null;
    const integration = await db.prepare(`SELECT id, provider FROM support_integrations
      WHERE project_id = ? AND id = ?
        AND status IN ('configured', 'validated', 'live_validated')
        AND (? IS NULL OR provider = ?) LIMIT 1`)
      .bind(projectId, id, provider, provider).first<{ id: string; provider: string }>();
    if (!integration) {
      throw failure(
        'configuration_required',
        action.type === 'trigger_webhook'
          ? 'Workflow webhook is not configured'
          : 'Workflow integration is not configured',
        422,
      );
    }
  }
}
async function recordResult(db: D1Database, ruleId: string, eventId: string, result: unknown) {
  await db.prepare('UPDATE support_rule_executions SET result_json = ? WHERE rule_id = ? AND event_id = ?')
    .bind(JSON.stringify(result), ruleId, eventId).run();
}
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}
function failure(code: string, message: string, status = 422) { return Object.assign(new Error(message), { code, status }); }
