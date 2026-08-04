import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requireInternal, requireProject, verifyApplicationIdentity } from './auth';
import { ConversationRoom } from './conversation-room';
import type { Actor, Conversation, Env } from './types';
import { MAX_ATTACHMENT_BYTES, safeFilename } from './validation';

const app = new Hono<{ Bindings: Env; Variables: { subject: string } }>();

app.use('*', cors({
  origin: (origin, c) => !origin || c.env.CORS_ORIGIN === '*' || origin === c.env.CORS_ORIGIN
    ? origin || '*'
    : c.env.CORS_ORIGIN,
  allowHeaders: ['Authorization', 'Content-Type', 'X-OpenGrow-Project-Id', 'X-Filename', 'Idempotency-Key'],
  allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok', service: 'opengrow-messaging', environment: c.env.ENVIRONMENT }));

app.use('/v1/*', async (c, next) => {
  const subject = await verifyApplicationIdentity(c.env, c.req.header('Authorization'));
  c.set('subject', subject);
  await next();
});

app.post('/v1/conversations', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = String(body.client_conversation_id || c.req.header('Idempotency-Key') || '').trim();
  const subjectLine = typeof body.subject === 'string' ? body.subject.trim().slice(0, 255) : '';
  if (!clientId || clientId.length > 128) throw failure('client_conversation_id_invalid', 'A client conversation id is required', 422);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(`
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `).bind(id, projectId, subject, clientId, subjectLine || null).first<Record<string, unknown>>();
  const conversation = inserted || await c.env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `).bind(projectId, subject, clientId).first<Record<string, unknown>>();
  if (!conversation) throw new Error('Unable to create conversation');
  if (inserted) await audit(c.env, String(conversation.id), projectId, 'conversation.created', { kind: 'user', id: subject }, {});
  return c.json({ data: conversation, duplicate: !inserted }, inserted ? 201 : 200);
});

app.get('/v1/conversations', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ?
    ORDER BY updated_at DESC LIMIT 100
  `).bind(projectId, subject).all();
  return c.json({ data: rows.results });
});

app.get('/v1/conversations/:conversationId/messages', async (c) => {
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), c.get('subject'), projectId);
  const before = Number(c.req.query('before_sequence') || Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 100);
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? AND sequence < ?
    ORDER BY sequence DESC LIMIT ?
  `).bind(conversation.id, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, limit).all();
  return c.json({ data: [...rows.results].reverse() });
});

app.post('/v1/conversations/:conversationId/messages', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/messages', c.req.raw);
});

app.post('/v1/conversations/:conversationId/read', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/read', c.req.raw);
});

app.post('/v1/conversations/:conversationId/typing', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/typing', c.req.raw);
});

app.get('/v1/conversations/:conversationId/ws', async (c) => {
  const subject = c.get('subject');
  const projectId = requireProject(c.env, c.req.header('X-OpenGrow-Project-Id'));
  const conversation = await userConversation(c.env, c.req.param('conversationId'), subject, projectId);
  return roomFetch(c.env, conversation.id, { id: subject, kind: 'user' }, '/connect', c.req.raw);
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
  return attachmentResponse(c.env, conversation, c.req.param('messageId'));
});

app.use('/internal/*', async (c, next) => {
  requireInternal(c.env, c.req.header('X-OpenGrow-Internal-Token'));
  await next();
});

app.get('/internal/projects/:projectId/conversations', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const status = c.req.query('status') || '';
  const rows = await c.env.DB.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
    FROM conversations c
    WHERE c.project_id = ? AND (? = '' OR c.status = ?)
    ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(c.last_message_at, c.created_at) DESC LIMIT 250
  `).bind(projectId, status, status).all();
  return c.json({ data: rows.results });
});

app.post('/internal/projects/:projectId/conversations', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const externalUserId = String(body.external_user_id || '').trim();
  const clientId = String(body.client_conversation_id || c.req.header('Idempotency-Key') || '').trim();
  const subjectLine = typeof body.subject === 'string' ? body.subject.trim().slice(0, 255) : '';
  if (!externalUserId || externalUserId.length > 255) throw failure('external_user_id_invalid', 'A valid external user id is required');
  if (!clientId || clientId.length > 128) throw failure('client_conversation_id_invalid', 'A client conversation id is required');
  const result = await upsertProjectConversation(c.env, projectId, externalUserId, clientId, subjectLine || null);
  if (!result.duplicate) {
    await audit(c.env, String(result.conversation.id), projectId, 'conversation.created', { kind: 'system', id: 'automation' }, {
      source: 'automation',
    });
  }
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
  return attachmentResponse(c.env, conversation, c.req.param('messageId'));
});

app.patch('/internal/projects/:projectId/conversations/:conversationId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'), 'project_id_invalid');
  const conversation = await projectConversation(c.env, c.req.param('conversationId'), projectId);
  const agentId = c.req.header('X-OpenGrow-Agent-Id') || '';
  if (!agentId) throw failure('agent_required', 'Agent identity is required', 401);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const status = body.status == null ? null : String(body.status);
  const priority = body.priority == null ? null : String(body.priority);
  const assigned = body.assigned_user_id == null ? null : String(body.assigned_user_id).slice(0, 255);
  const labels = body.labels == null ? null : Array.isArray(body.labels)
    ? [...new Set(body.labels.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 20)
    : null;
  if (status && !['open', 'pending', 'closed'].includes(status)) throw failure('status_invalid', 'Invalid conversation status');
  if (priority && !['low', 'normal', 'high', 'urgent'].includes(priority)) throw failure('priority_invalid', 'Invalid conversation priority');
  if (body.labels != null && !labels) throw failure('labels_invalid', 'Labels must be an array');
  await c.env.DB.prepare(`
    UPDATE conversations SET
      status = COALESCE(?, status), priority = COALESCE(?, priority),
      assigned_user_id = CASE WHEN ? THEN ? ELSE assigned_user_id END,
      labels_json = COALESCE(?, labels_json), updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, priority, body.assigned_user_id !== undefined ? 1 : 0, assigned, labels ? JSON.stringify(labels) : null, conversation.id).run();
  await audit(c.env, conversation.id, projectId, 'conversation.updated', { kind: 'agent', id: agentId }, {
    status, priority, assigned_user_id: assigned, labels,
  });
  const updated = await projectConversation(c.env, conversation.id, projectId);
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
) {
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(`
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `).bind(id, projectId, externalUserId, clientConversationId, subject).first<Record<string, unknown>>();
  const conversation = inserted || await env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `).bind(projectId, externalUserId, clientConversationId).first<Record<string, unknown>>();
  if (!conversation) throw new Error('Unable to create conversation');
  return { conversation, duplicate: !inserted };
}

function roomFetch(env: Env, conversationId: string, actor: Actor, path: string, source: Request) {
  const stub = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversationId));
  const headers = new Headers(source.headers);
  headers.set('x-room-capability', env.INTERNAL_API_TOKEN);
  headers.set('x-conversation-id', conversationId);
  headers.set('x-actor-id', actor.id);
  headers.set('x-actor-kind', actor.kind);
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

async function storeAttachment(
  env: Env,
  conversation: Conversation,
  uploaderId: string,
  request: Request,
) {
  const announced = Number(request.headers.get('Content-Length') || 0);
  if (announced > MAX_ATTACHMENT_BYTES) throw failure('attachment_too_large', 'Attachment is limited to 10 MB', 413);
  const bytes = await request.arrayBuffer();
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

async function attachmentResponse(env: Env, conversation: Conversation, messageId: string) {
  const message = await env.DB.prepare(`
    SELECT attachment_key, attachment_name, attachment_content_type FROM messages
    WHERE id = ? AND conversation_id = ? AND attachment_key IS NOT NULL
  `).bind(messageId, conversation.id).first<{
    attachment_key: string; attachment_name: string | null; attachment_content_type: string | null;
  }>();
  if (!message) throw failure('attachment_not_found', 'Attachment not found', 404);
  const object = await env.ATTACHMENTS.get(message.attachment_key);
  if (!object) throw failure('attachment_not_found', 'Attachment not found', 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', `attachment; filename="${safeFilename(message.attachment_name || 'attachment')}"`);
  return new Response(object.body, { headers });
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export { ConversationRoom };
export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
