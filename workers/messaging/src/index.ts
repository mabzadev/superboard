import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireInternal, requireProject, verifyApplicationIdentity } from './auth';
import configuration, { getPublicMessagingConfiguration } from './configuration';
import operations, { ensureMessagingContact } from './operations';
import { runConversationAutomations } from './workflows';
import { handleMessagingQueue, publishMessagingEvent } from './webhooks';
import { ConversationRoom } from './conversation-room';
import type { Actor, Conversation, Env } from './types';
import { MAX_ATTACHMENT_BYTES, readBytesLimited, readJsonObject, safeFilename } from './validation';

const app = new Hono<{
  Bindings: Env;
  Variables: { subject: string; identityExpiresAt: number };
}>();

app.use('*', cors({
  origin: (origin, c) => origin === c.env.CORS_ORIGIN ? origin : undefined,
  allowHeaders: ['Authorization', 'Content-Type', 'X-OpenGrow-Project-Id', 'X-Filename', 'Idempotency-Key'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', service: 'opengrow-messaging', environment: c.env.ENVIRONMENT }));

app.use('/v1/*', async (c, next) => {
  const identity = await verifyApplicationIdentity(c.env, c.req.header('Authorization'));
  c.set('subject', identity.subject);
  c.set('identityExpiresAt', identity.expiresAt);
  await next();
});

app.post('/v1/conversations', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const body = await readJsonObject(c.req.raw);
  const clientId = String(body.client_conversation_id || c.req.header('Idempotency-Key') || '').trim();
  const subjectLine = typeof body.subject === 'string' ? body.subject.trim().slice(0, 255) : '';
  const inboxId = optionalIdentifier(body.inbox_id, 'inbox_id');
  const customAttributes = validateCustomAttributes(body.custom_attributes);
  if (!clientId || clientId.length > 128) throw failure('client_conversation_id_invalid', 'A client conversation id is required', 422);
  if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(`
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, custom_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `).bind(id, projectId, subject, clientId, subjectLine || null, inboxId, JSON.stringify(customAttributes)).first<Record<string, unknown>>();
  const conversation = inserted || await c.env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `).bind(projectId, subject, clientId).first<Record<string, unknown>>();
  if (!conversation) throw new Error('Unable to create conversation');
  await ensureMessagingContact(c.env.DB, projectId, subject);
  if (inserted) {
    await audit(c.env, String(conversation.id), projectId, 'conversation.created', { kind: 'user', id: subject }, {});
    await runConversationAutomations(c.env, projectId, String(conversation.id), 'conversation_created', `conversation_created:${conversation.id}`);
  }
  await publishMessagingEvent(c.env, projectId, `conversation.created:${conversation.id}`, 'conversation.created', {
    conversation_id: conversation.id, external_user_id: subject, inbox_id: conversation.inbox_id,
    status: conversation.status, priority: conversation.priority,
  });
  return c.json({ data: conversation, duplicate: !inserted }, inserted ? 201 : 200);
});

app.get('/v1/conversations', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  return c.json({ data: await listUserConversations(c.env.DB, projectId, subject) });
});

app.get('/v1/configuration', async (c) => {
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  return c.json({ data: await getPublicMessagingConfiguration(c.env.DB, projectId) });
});

app.patch('/v1/conversations/:conversationId', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  const body = await readJsonObject(c.req.raw);
  const status = body.status == null ? null : String(body.status);
  if (status && !['open', 'closed'].includes(status)) throw failure('status_invalid', 'Customers can set only open or closed status');
  const customAttributes = body.custom_attributes == null ? null : validateCustomAttributes(body.custom_attributes);
  if (status == null && customAttributes == null) throw failure('conversation_update_empty', 'No supported conversation update was provided');
  await c.env.DB.prepare(`
    UPDATE conversations SET
      status = COALESCE(?, status),
      custom_attributes_json = COALESCE(?, custom_attributes_json),
      resolved_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHEN ? = 'open' THEN NULL ELSE resolved_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).bind(status, customAttributes == null ? null : JSON.stringify(customAttributes), status, status, conversation.id).run();
  await audit(c.env, conversation.id, projectId, 'conversation.customer_updated', { kind: 'user', id: subject }, {
    status, custom_attributes: customAttributes,
  });
  const eventId = `conversation_customer_updated:${conversation.id}:${crypto.randomUUID()}`;
  await runConversationAutomations(
    c.env, projectId, conversation.id,
    status === 'closed' ? 'conversation_resolved' : status === 'open' ? 'conversation_opened' : 'conversation_updated',
    eventId,
  );
  const updated = await userConversationRecord(c.env, conversation.id, subject, projectId);
  await publishMessagingEvent(c.env, projectId, eventId, 'conversation.updated', {
    conversation_id: conversation.id, status: updated.status, custom_attributes: updated.custom_attributes_json,
  });
  return c.json({ data: updated });
});

app.post('/v1/conversations/:conversationId/csat', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  if (conversation.status !== 'closed') throw failure('csat_not_available', 'CSAT is available after the conversation is closed', 409);
  const body = await readJsonObject(c.req.raw);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw failure('csat_rating_invalid', 'CSAT rating must be between 1 and 5');
  const feedback = body.feedback == null ? null : String(body.feedback).trim().slice(0, 4000) || null;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO messaging_csat_responses
      (id, project_id, conversation_id, contact_external_user_id, rating, feedback)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(id, projectId, conversation.id, subject, rating, feedback).run();
  await audit(c.env, conversation.id, projectId, 'conversation.csat_submitted', { kind: 'user', id: subject }, { rating });
  await publishMessagingEvent(c.env, projectId, `csat:${conversation.id}:${crypto.randomUUID()}`, 'conversation.csat_submitted', {
    conversation_id: conversation.id, rating, feedback,
  });
  return c.json({ data: { conversation_id: conversation.id, rating, feedback } }, 201);
});

export async function listUserConversations(db: D1Database, projectId: number, externalUserId: string) {
  const rows = await db.prepare(`
    SELECT conversation.*,
      (SELECT COUNT(*) FROM messages message
        WHERE message.conversation_id = conversation.id
          AND message.visibility = 'public'
          AND message.sender_kind IN ('agent', 'system')
          AND (conversation.user_last_read_at IS NULL OR message.created_at > conversation.user_last_read_at)
      ) AS unread_count
    FROM conversations conversation
    WHERE conversation.project_id = ? AND conversation.external_user_id = ?
    ORDER BY conversation.updated_at DESC LIMIT 100
  `).bind(projectId, externalUserId).all<Record<string, unknown>>();
  return rows.results;
}

app.get('/v1/conversations/:conversationId/messages', async (c) => {
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), c.get('subject'), projectId);
  const before = Number(c.req.query('before_sequence') || Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 100);
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? AND visibility = 'public' AND sequence < ?
    ORDER BY sequence DESC LIMIT ?
  `).bind(conversation.id, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit).all();
  return c.json({ data: [...rows.results].reverse() });
});

app.post('/v1/conversations/:conversationId/messages', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/messages', c.req.raw, c.get('identityExpiresAt'));
});

app.post('/v1/conversations/:conversationId/read', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/read', c.req.raw, c.get('identityExpiresAt'));
});

app.post('/v1/conversations/:conversationId/typing', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/typing', c.req.raw, c.get('identityExpiresAt'));
});

app.get('/v1/conversations/:conversationId/ws', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/connect', c.req.raw, c.get('identityExpiresAt'));
});

app.post('/v1/conversations/:conversationId/attachments', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return storeAttachment(c.env, conversation, subject, c.req.raw);
});

app.get('/v1/conversations/:conversationId/attachments/:messageId', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return attachmentResponse(c.env, conversation, c.req.param('messageId'), false);
});

app.use('/internal/*', async (c, next) => {
  await requireInternal(c.env, c.req.header('X-OpenGrow-Internal-Token'));
  await next();
});

app.route('/internal/projects', configuration);
app.route('/internal/projects', operations);

app.get('/internal/projects/:projectId/conversations', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const status = c.req.query('status') || '';
  return c.json({ data: await listProjectConversations(c.env.DB, projectId, status) });
});

export async function listProjectConversations(db: D1Database, projectId: number, status = '') {
  const rows = await db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT COUNT(*) FROM messages unread
        WHERE unread.conversation_id = c.id AND unread.sender_kind = 'user'
          AND (c.agent_last_read_at IS NULL OR unread.created_at > c.agent_last_read_at)
      ) AS unread_count
    FROM conversations c
    WHERE c.project_id = ? AND (? = '' OR c.status = ?)
    ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(c.last_message_at, c.created_at) DESC LIMIT 250
  `).bind(projectId, status, status).all<Record<string, unknown>>();
  return rows.results;
}

app.post('/internal/projects/:projectId/conversations', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const body = await readJsonObject(c.req.raw);
  const externalUserId = String(body.external_user_id || '').trim();
  const clientId = String(body.client_conversation_id || c.req.header('Idempotency-Key') || '').trim();
  const subjectLine = typeof body.subject === 'string' ? body.subject.trim().slice(0, 255) : '';
  const inboxId = optionalIdentifier(body.inbox_id, 'inbox_id');
  const customAttributes = validateCustomAttributes(body.custom_attributes);
  if (!externalUserId || externalUserId.length > 255) throw failure('external_user_id_invalid', 'A valid external user id is required');
  if (!clientId || clientId.length > 128) throw failure('client_conversation_id_invalid', 'A client conversation id is required');
  if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
  const result = await upsertProjectConversation(c.env, projectId, externalUserId, clientId, subjectLine || null, {
    inboxId, customAttributes,
  });
  if (!result.duplicate) {
    await audit(c.env, String(result.conversation.id), projectId, 'conversation.created', { kind: 'system', id: 'automation' }, {
      source: 'automation',
    });
    await runConversationAutomations(c.env, projectId, String(result.conversation.id), 'conversation_created', `conversation_created:${result.conversation.id}`);
  }
  await ensureMessagingContact(c.env.DB, projectId, externalUserId);
  await publishMessagingEvent(c.env, projectId, `conversation.created:${result.conversation.id}`, 'conversation.created', {
    conversation_id: result.conversation.id, external_user_id: externalUserId,
    inbox_id: result.conversation.inbox_id, status: result.conversation.status, priority: result.conversation.priority,
  });
  return c.json({ data: result.conversation, duplicate: result.duplicate }, result.duplicate ? 200 : 201);
});

app.get('/internal/projects/:projectId/conversations/:conversationId/messages', async (c) => {
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), positiveInt(c.req.param('projectId'), 'project_id_invalid'));
  const rows = await c.env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY sequence ASC LIMIT 500')
    .bind(conversation.id).all();
  return c.json({ data: rows.results });
});

app.post('/internal/projects/:projectId/conversations/:conversationId/messages', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = c.req.header('X-OpenGrow-Agent-Id') || '';
  if (!agentId) throw failure('agent_required', 'Agent identity is required', 401);
  return roomFetch(c.env, conversation.id, { id: agentId, kind: 'agent' }, '/messages', c.req.raw);
});

app.post('/internal/projects/:projectId/conversations/:conversationId/read', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = requiredAgent(c.req.header('X-OpenGrow-Agent-Id'));
  return roomFetch(c.env, conversation.id, { id: agentId, kind: 'agent' }, '/read', c.req.raw);
});

app.post('/internal/projects/:projectId/conversations/:conversationId/typing', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = requiredAgent(c.req.header('X-OpenGrow-Agent-Id'));
  return roomFetch(c.env, conversation.id, { id: agentId, kind: 'agent' }, '/typing', c.req.raw);
});

app.get('/internal/projects/:projectId/conversations/:conversationId/ws', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = requiredAgent(c.req.header('X-OpenGrow-Agent-Id'));
  return roomFetch(c.env, conversation.id, { id: agentId, kind: 'agent' }, '/connect', c.req.raw);
});

app.post('/internal/projects/:projectId/conversations/:conversationId/attachments', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = requiredAgent(c.req.header('X-OpenGrow-Agent-Id'));
  return storeAttachment(c.env, conversation, agentId, c.req.raw);
});

app.get('/internal/projects/:projectId/conversations/:conversationId/attachments/:messageId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  requiredAgent(c.req.header('X-OpenGrow-Agent-Id'));
  return attachmentResponse(c.env, conversation, c.req.param('messageId'), true);
});

app.patch('/internal/projects/:projectId/conversations/:conversationId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = c.req.header('X-OpenGrow-Agent-Id') || '';
  if (!agentId) throw failure('agent_required', 'Agent identity is required', 401);
  const body = await readJsonObject(c.req.raw);
  const status = body.status == null ? null : String(body.status);
  const priority = body.priority == null ? null : String(body.priority);
  const assigned = body.assigned_user_id == null ? null : String(body.assigned_user_id).slice(0, 255);
  const assignedTeam = body.assigned_team_id == null ? null : optionalIdentifier(body.assigned_team_id, 'assigned_team_id');
  const inboxId = body.inbox_id == null ? null : optionalIdentifier(body.inbox_id, 'inbox_id');
  const snoozedUntil = body.snoozed_until == null ? null : validTimestamp(body.snoozed_until, 'snoozed_until');
  const customAttributes = body.custom_attributes == null ? null : validateCustomAttributes(body.custom_attributes);
  const labels = body.labels == null ? null : Array.isArray(body.labels)
    ? [...new Set(body.labels.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
    : null;
  if (status && !['open', 'pending', 'closed'].includes(status)) throw failure('status_invalid', 'Invalid conversation status');
  if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority)) throw failure('priority_invalid', 'Invalid conversation priority');
  if (body.labels != null && !labels) throw failure('labels_invalid', 'Labels must be an array');
  if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
  if (assigned) await requireEnabledConfiguration(c.env.DB, projectId, 'agent', assigned, 'auth_user_id');
  if (assignedTeam) await requireEnabledConfiguration(c.env.DB, projectId, 'team', assignedTeam);
  await c.env.DB.prepare(`
    UPDATE conversations SET
      status = COALESCE(?, status), priority = COALESCE(?, priority),
      assigned_user_id = CASE WHEN ? THEN ? ELSE assigned_user_id END,
      assigned_team_id = CASE WHEN ? THEN ? ELSE assigned_team_id END,
      inbox_id = CASE WHEN ? THEN ? ELSE inbox_id END,
      snoozed_until = CASE WHEN ? THEN ? ELSE snoozed_until END,
      custom_attributes_json = COALESCE(?, custom_attributes_json),
      labels_json = COALESCE(?, labels_json),
      resolved_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHEN ? = 'open' THEN NULL ELSE resolved_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).bind(
    status, priority,
    body.assigned_user_id !== undefined ? 1 : 0, assigned,
    body.assigned_team_id !== undefined ? 1 : 0, assignedTeam,
    body.inbox_id !== undefined ? 1 : 0, inboxId,
    body.snoozed_until !== undefined ? 1 : 0, snoozedUntil,
    customAttributes == null ? null : JSON.stringify(customAttributes),
    labels ? JSON.stringify(labels) : null,
    status, status, conversation.id,
  ).run();
  await audit(c.env, conversation.id, projectId, 'conversation.updated', { kind: 'agent', id: agentId }, {
    status, priority, assigned_user_id: assigned, assigned_team_id: assignedTeam,
    inbox_id: inboxId, snoozed_until: snoozedUntil, custom_attributes: customAttributes, labels,
  });
  if (body.assigned_user_id !== undefined && assigned && assigned !== conversation.assigned_user_id) {
    await c.env.DB.prepare(`
      INSERT INTO messaging_agent_notifications
        (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
      VALUES (?, ?, ?, 'conversation_assigned', 'Conversation assigned', 'A conversation was assigned to you.', ?, ?)
    `).bind(crypto.randomUUID(), projectId, assigned, conversation.id, JSON.stringify({ assigned_by: agentId })).run();
  }
  const eventId = `conversation_agent_updated:${conversation.id}:${crypto.randomUUID()}`;
  await runConversationAutomations(
    c.env, projectId, conversation.id,
    status === 'closed' ? 'conversation_resolved' : status === 'open' ? 'conversation_opened' : 'conversation_updated',
    eventId,
  );
  const updated = await projectConversation(c.env, conversation.id, projectId);
  await publishMessagingEvent(c.env, projectId, eventId, 'conversation.updated', {
    conversation_id: conversation.id, status: updated.status, priority: updated.priority,
    assigned_user_id: updated.assigned_user_id, assigned_team_id: updated.assigned_team_id,
    inbox_id: updated.inbox_id, labels: updated.labels_json,
  });
  return c.json({ data: updated });
});

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  if (status >= 500) console.error(JSON.stringify({ event: 'messaging_request_failed', request_id: requestId, error: error.message }));
  return c.json({
    code: (error as { code?: string }).code || 'internal_error',
    message: status >= 500 ? 'Messaging is temporarily unavailable' : error.message,
    retryable: status >= 500,
    request_id: requestId,
  }, status as 400);
});

async function userConversation(env: Env, id: string, subject: string, projectId: number): Promise<Conversation> {
  const conversation = await env.DB.prepare(`
    SELECT id, project_id, external_user_id, status FROM conversations
    WHERE id = ? AND external_user_id = ? AND project_id = ?
  `).bind(id, subject, projectId).first<Conversation>();
  if (!conversation) throw failure('conversation_not_found', 'Conversation not found', 404);
  return conversation;
}

async function userConversationRecord(env: Env, id: string, subject: string, projectId: number) {
  const conversation = await env.DB.prepare(`
    SELECT * FROM conversations WHERE id = ? AND external_user_id = ? AND project_id = ?
  `).bind(id, subject, projectId).first<Record<string, unknown>>();
  if (!conversation) throw failure('conversation_not_found', 'Conversation not found', 404);
  return conversation;
}

async function projectConversation(env: Env, id: string, projectId: number): Promise<Conversation & Record<string, unknown>> {
  const conversation = await env.DB.prepare('SELECT * FROM conversations WHERE id = ? AND project_id = ?')
    .bind(id, projectId).first<Conversation & Record<string, unknown>>();
  if (!conversation) throw failure('conversation_not_found', 'Conversation not found', 404);
  return conversation;
}

export async function upsertProjectConversation(
  env: Pick<Env, 'DB'>,
  projectId: number,
  externalUserId: string,
  clientConversationId: string,
  subject: string | null,
  options: { inboxId?: string | null; customAttributes?: Record<string, unknown> } = {},
) {
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(`
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, custom_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `).bind(
    id, projectId, externalUserId, clientConversationId, subject,
    options.inboxId || null, JSON.stringify(options.customAttributes || {}),
  ).first<Record<string, unknown>>();
  const conversation = inserted || await env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `).bind(projectId, externalUserId, clientConversationId).first<Record<string, unknown>>();
  if (!conversation) throw new Error('Unable to create conversation');
  return { conversation, duplicate: !inserted };
}

function roomFetch(
  env: Env,
  conversationId: string,
  actor: Actor,
  path: string,
  source: Request,
  identityExpiresAt = Date.now() + 15 * 60 * 1000,
) {
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversationId));
  const headers = new Headers(source.headers);
  headers.set('x-room-capability', env.INTERNAL_API_TOKEN);
  headers.set('x-conversation-id', conversationId);
  headers.set('x-actor-id', actor.id);
  headers.set('x-actor-kind', actor.kind);
  headers.set('x-identity-expires-at', String(identityExpiresAt));
  headers.delete('authorization');
  return stub.fetch(new Request(`https://room.internal${path}`, {
    method: source.method, headers, body: source.method === 'GET' || source.method === 'HEAD' ? null : source.body,
  }));
}

async function audit(env: Env, conversationId: string, projectId: number, eventType: string, actor: Actor, payload: unknown) {
  await env.DB.prepare(`
    INSERT INTO messaging_audit_events (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), conversationId, projectId, eventType, actor.kind, actor.id, JSON.stringify(payload)).run();
}

function positiveInt(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw failure(code, 'A positive integer is required');
  return parsed;
}

function failure(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

function requiredAgent(value?: string): string {
  const agentId = String(value || '').trim();
  if (!agentId || agentId.length > 255) throw failure('agent_required', 'Agent identity is required', 401);
  return agentId;
}

function optionalIdentifier(value: unknown, field: string) {
  if (value == null || value === '') return null;
  const parsed = String(value).trim();
  if (!parsed || parsed.length > 255) throw failure(`${field}_invalid`, `${field} must be at most 255 characters`);
  return parsed;
}

function validTimestamp(value: unknown, field: string) {
  if (value === '') return null;
  const parsed = String(value);
  const date = new Date(parsed);
  if (!parsed || Number.isNaN(date.getTime())) throw failure(`${field}_invalid`, `${field} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function validateCustomAttributes(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw failure('custom_attributes_invalid', 'Custom attributes must be an object');
  const attributes = value as Record<string, unknown>;
  const keys = Object.keys(attributes);
  if (keys.length > 50 || keys.some((key) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))) {
    throw failure('custom_attributes_invalid', 'Custom attributes contain too many keys or an invalid key');
  }
  const serialized = JSON.stringify(attributes);
  if (serialized.length > 8000) throw failure('custom_attributes_invalid', 'Custom attributes are limited to 8 KB');
  return JSON.parse(serialized) as Record<string, unknown>;
}

async function requireEnabledInbox(db: D1Database, projectId: number, inboxId: string) {
  const row = await db.prepare(`
    SELECT id FROM messaging_configuration_entities
    WHERE project_id = ? AND entity_type = 'inbox' AND id = ? AND enabled = 1
  `).bind(projectId, inboxId).first();
  if (!row) throw failure('inbox_not_found', 'Enabled Inbox configuration not found', 404);
}

async function requireEnabledConfiguration(
  db: D1Database,
  projectId: number,
  type: 'agent' | 'team',
  value: string,
  configurationKey?: string,
) {
  const row = configurationKey
    ? await db.prepare(`
      SELECT id FROM messaging_configuration_entities
      WHERE project_id = ? AND entity_type = ? AND enabled = 1
        AND json_extract(configuration_json, ?) = ?
    `).bind(projectId, type, `$.${configurationKey}`, value).first()
    : await db.prepare(`
      SELECT id FROM messaging_configuration_entities
      WHERE project_id = ? AND entity_type = ? AND enabled = 1 AND id = ?
    `).bind(projectId, type, value).first();
  if (!row) throw failure(`${type}_not_found`, `Enabled ${type} configuration not found`, 404);
}

async function storeAttachment(
  env: Env,
  conversation: Conversation,
  uploaderId: string,
  request: Request,
) {
  const bytes = await readBytesLimited(
    request,
    MAX_ATTACHMENT_BYTES,
    'attachment_too_large',
    'Attachment is limited to 10 MB',
  );
  if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw failure('attachment_invalid', 'Attachment must contain between 1 byte and 10 MB', 422);
  }
  const filename = safeFilename(request.headers.get('X-Filename') || 'attachment');
  const uploaderHash = (await sha256(uploaderId)).slice(0, 24);
  const key = `attachments/${conversation.project_id}/${uploaderHash}/${conversation.id}/${crypto.randomUUID()}/${filename}`;
  const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
  await env.ATTACHMENTS.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { conversationId: conversation.id, uploadedBy: uploaderHash },
  });
  return Response.json({ key, filename, content_type: contentType, size: bytes.byteLength }, { status: 201 });
}

async function attachmentResponse(env: Env, conversation: Conversation, messageId: string, allowPrivate: boolean) {
  const message = await env.DB.prepare(`
    SELECT attachment_key, attachment_name, attachment_content_type FROM messages
    WHERE id = ? AND conversation_id = ? AND attachment_key IS NOT NULL
      AND (? = 1 OR visibility = 'public')
  `).bind(messageId, conversation.id, allowPrivate ? 1 : 0).first<{
    attachment_key: string; attachment_name: string | null; attachment_content_type: string | null;
  }>();
  if (!message) throw failure('attachment_not_found', 'Attachment not found', 404);
  const object = await env.ATTACHMENTS.get(message.attachment_key);
  if (!object) throw failure('attachment_not_found', 'Attachment not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', `attachment; filename="${safeFilename(message.attachment_name || 'attachment')}"`);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  return new Response(object.body, { headers });
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export { ConversationRoom };
export default { fetch: app.fetch, queue: handleMessagingQueue } satisfies ExportedHandler<Env>;
