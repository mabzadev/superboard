import type { Env } from './types';

type WorkflowCondition = {
  field: 'status' | 'priority' | 'inbox_id' | 'assigned_user_id' | 'assigned_team_id' | 'sender_kind' | 'visibility' | 'labels';
  operator: 'equals' | 'not_equals' | 'contains';
  value: string;
};

type WorkflowAction = {
  type: 'set_status' | 'set_priority' | 'assign_agent' | 'assign_team' | 'add_label' | 'remove_label' | 'notify_agent';
  value?: string;
  agent_id?: string;
  title?: string;
  body?: string;
};

const actionTypes = new Set<WorkflowAction['type']>([
  'set_status', 'set_priority', 'assign_agent', 'assign_team',
  'add_label', 'remove_label', 'notify_agent',
]);
const conditionFields = new Set<WorkflowCondition['field']>([
  'status', 'priority', 'inbox_id', 'assigned_user_id', 'assigned_team_id',
  'sender_kind', 'visibility', 'labels',
]);
const conditionOperators = new Set<WorkflowCondition['operator']>(['equals', 'not_equals', 'contains']);

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
    for (const raw of conditions) validateCondition(raw);
  }
}

export async function runConversationAutomations(
  env: Pick<Env, 'DB'>,
  projectId: number,
  conversationId: string,
  eventName: string,
  eventId: string,
  event: Record<string, unknown> = {},
) {
  const rows = await env.DB.prepare(`
    SELECT id, configuration_json FROM messaging_configuration_entities
    WHERE project_id = ? AND entity_type = 'automation_rule' AND enabled = 1
      AND json_extract(configuration_json, '$.event_name') = ?
    ORDER BY position, created_at
  `).bind(projectId, eventName).all<{ id: string; configuration_json: string }>();
  for (const row of rows.results) {
    let configuration: Record<string, unknown>;
    try {
      configuration = JSON.parse(row.configuration_json) as Record<string, unknown>;
      validateWorkflowConfiguration('automation_rule', configuration);
    } catch (error) {
      console.error(JSON.stringify({ event: 'messaging_automation_invalid', rule_id: row.id, error: String(error) }));
      continue;
    }
    const claimed = await env.DB.prepare(`
      INSERT INTO messaging_rule_executions
        (id, project_id, rule_id, event_id, conversation_id, event_name)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(rule_id, event_id) DO NOTHING RETURNING id
    `).bind(crypto.randomUUID(), projectId, row.id, eventId, conversationId, eventName).first();
    if (!claimed) continue;
    const conversation = await conversationById(env.DB, projectId, conversationId);
    const conditions = configuration.conditions as WorkflowCondition[];
    if (!conditions.every((condition) => matches(condition, conversation, event))) {
      await recordResult(env.DB, row.id, eventId, { matched: false });
      continue;
    }
    const result = await executeActions(env.DB, projectId, conversation, configuration.actions as WorkflowAction[], `automation:${row.id}`);
    await recordResult(env.DB, row.id, eventId, { matched: true, ...result });
  }
}

export async function executeMacro(
  db: D1Database,
  projectId: number,
  conversationId: string,
  macroId: string,
  actorId: string,
) {
  const macro = await db.prepare(`
    SELECT id, configuration_json FROM messaging_configuration_entities
    WHERE project_id = ? AND entity_type = 'macro' AND id = ? AND enabled = 1
  `).bind(projectId, macroId).first<{ id: string; configuration_json: string }>();
  if (!macro) throw failure('macro_not_found', 'Enabled macro not found', 404);
  const configuration = JSON.parse(macro.configuration_json) as Record<string, unknown>;
  validateWorkflowConfiguration('macro', configuration);
  const conversation = await conversationById(db, projectId, conversationId);
  return executeActions(db, projectId, conversation, configuration.actions as WorkflowAction[], actorId);
}

async function executeActions(
  db: D1Database,
  projectId: number,
  conversation: Record<string, unknown>,
  actions: WorkflowAction[],
  actorId: string,
) {
  let status = String(conversation.status || 'open');
  let priority = String(conversation.priority || 'normal');
  let assignedUser = conversation.assigned_user_id == null ? null : String(conversation.assigned_user_id);
  let assignedTeam = conversation.assigned_team_id == null ? null : String(conversation.assigned_team_id);
  const labels = new Set(parseStringArray(conversation.labels_json));
  const notifications: WorkflowAction[] = [];
  for (const action of actions) {
    if (action.type === 'set_status') status = action.value!;
    else if (action.type === 'set_priority') priority = action.value!;
    else if (action.type === 'assign_agent') assignedUser = action.value || null;
    else if (action.type === 'assign_team') assignedTeam = action.value || null;
    else if (action.type === 'add_label') labels.add(action.value!);
    else if (action.type === 'remove_label') labels.delete(action.value!);
    else if (action.type === 'notify_agent') notifications.push(action);
  }
  await db.prepare(`
    UPDATE conversations SET status = ?, priority = ?, assigned_user_id = ?, assigned_team_id = ?,
      labels_json = ?, resolved_at = CASE WHEN ? = 'closed' THEN COALESCE(resolved_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE NULL END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `).bind(status, priority, assignedUser, assignedTeam, JSON.stringify([...labels]), status, conversation.id, projectId).run();
  for (const notification of notifications) {
    await db.prepare(`
      INSERT INTO messaging_agent_notifications
        (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
      VALUES (?, ?, ?, 'workflow', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), projectId, notification.agent_id,
      notification.title, notification.body, conversation.id, JSON.stringify({ actor_id: actorId })).run();
  }
  await db.prepare(`
    INSERT INTO messaging_audit_events
      (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
    VALUES (?, ?, ?, 'workflow.executed', 'system', ?, ?)
  `).bind(crypto.randomUUID(), conversation.id, projectId, actorId, JSON.stringify({ actions })).run();
  return { status, priority, assigned_user_id: assignedUser, assigned_team_id: assignedTeam, labels: [...labels] };
}

function validateAction(value: unknown): asserts value is WorkflowAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('workflow_action_invalid', 'Every workflow action must be an object');
  const action = value as Record<string, unknown>;
  const type = String(action.type || '') as WorkflowAction['type'];
  if (!actionTypes.has(type)) throw failure('workflow_action_invalid', 'Workflow action type is not supported');
  if (type === 'set_status' && !['open', 'pending', 'closed'].includes(String(action.value))) throw failure('workflow_action_invalid', 'Workflow status is invalid');
  if (type === 'set_priority' && !['low', 'normal', 'high', 'urgent'].includes(String(action.value))) throw failure('workflow_action_invalid', 'Workflow priority is invalid');
  if (['assign_agent', 'assign_team'].includes(type) && action.value != null && String(action.value).length > 255) throw failure('workflow_action_invalid', 'Workflow assignment is invalid');
  if (['add_label', 'remove_label'].includes(type) && (!String(action.value || '').trim() || String(action.value).length > 64)) throw failure('workflow_action_invalid', 'Workflow label is invalid');
  if (type === 'notify_agent') {
    if (!String(action.agent_id || '').trim() || String(action.agent_id).length > 255
      || !String(action.title || '').trim() || String(action.title).length > 255
      || !String(action.body || '').trim() || String(action.body).length > 2000) {
      throw failure('workflow_action_invalid', 'Workflow notification is invalid');
    }
  }
}

function validateCondition(value: unknown): asserts value is WorkflowCondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('workflow_condition_invalid', 'Every automation condition must be an object');
  const condition = value as Record<string, unknown>;
  if (!conditionFields.has(String(condition.field) as WorkflowCondition['field'])
    || !conditionOperators.has(String(condition.operator) as WorkflowCondition['operator'])
    || !String(condition.value ?? '').trim() || String(condition.value).length > 255) {
    throw failure('workflow_condition_invalid', 'Automation condition is invalid');
  }
}

function matches(condition: WorkflowCondition, conversation: Record<string, unknown>, event: Record<string, unknown>) {
  const actual = condition.field === 'sender_kind' || condition.field === 'visibility'
    ? event[condition.field]
    : condition.field === 'labels' ? parseStringArray(conversation.labels_json) : conversation[condition.field];
  if (condition.operator === 'contains') return Array.isArray(actual)
    ? actual.map(String).includes(condition.value)
    : String(actual ?? '').includes(condition.value);
  const equal = String(actual ?? '') === condition.value;
  return condition.operator === 'equals' ? equal : !equal;
}

async function conversationById(db: D1Database, projectId: number, id: string) {
  const conversation = await db.prepare('SELECT * FROM conversations WHERE project_id = ? AND id = ?')
    .bind(projectId, id).first<Record<string, unknown>>();
  if (!conversation) throw failure('conversation_not_found', 'Conversation not found', 404);
  return conversation;
}
async function recordResult(db: D1Database, ruleId: string, eventId: string, result: unknown) {
  await db.prepare('UPDATE messaging_rule_executions SET result_json = ? WHERE rule_id = ? AND event_id = ?')
    .bind(JSON.stringify(result), ruleId, eventId).run();
}
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}
function failure(code: string, message: string, status = 422) { return Object.assign(new Error(message), { code, status }); }
