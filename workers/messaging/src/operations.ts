import { Hono } from 'hono';
import type { Env } from './types';
import { readJsonObject } from './validation';
import { executeMacro } from './workflows';

const operations = new Hono<{ Bindings: Env }>();

operations.get('/:projectId/contacts', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = String(c.req.query('q') || '').trim().slice(0, 255);
  const like = `%${escapeLike(query)}%`;
  const rows = await c.env.DB.prepare(`
    SELECT contact.*, company.name AS company_name,
      (SELECT COUNT(*) FROM conversations conversation
       WHERE conversation.project_id = contact.project_id
         AND conversation.external_user_id = contact.external_user_id) AS conversation_count
    FROM messaging_contacts contact
    LEFT JOIN messaging_companies company ON company.id = contact.company_id
    WHERE contact.project_id = ? AND (? = '' OR contact.external_user_id LIKE ? ESCAPE '\\'
      OR COALESCE(contact.name, '') LIKE ? ESCAPE '\\' OR COALESCE(contact.email, '') LIKE ? ESCAPE '\\'
      OR COALESCE(contact.phone, '') LIKE ? ESCAPE '\\')
    ORDER BY contact.updated_at DESC LIMIT 250
  `).bind(projectId, query, like, like, like, like).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeContact) });
});

operations.post('/:projectId/contacts', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const input = contactInput(await readJsonObject(c.req.raw));
  if (input.company_id) await company(c.env.DB, projectId, input.company_id);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`
      INSERT INTO messaging_contacts (
        id, project_id, external_user_id, name, email, phone, company_id, avatar_url,
        blocked, custom_attributes_json, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, projectId, input.external_user_id, input.name, input.email, input.phone,
      input.company_id, input.avatar_url, input.blocked ? 1 : 0,
      JSON.stringify(input.custom_attributes), input.last_seen_at).run();
  } catch (error) { throw conflict(error, 'contact_conflict', 'A contact with this identity or email already exists'); }
  const created = await contact(c.env.DB, projectId, id);
  await audit(c.env.DB, projectId, 'contact', id, 'created', actorId, created);
  return c.json({ data: serializeContact(created) }, 201);
});

operations.get('/:projectId/contacts/:contactId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const row = await contact(c.env.DB, projectId, c.req.param('contactId'));
  const conversations = await c.env.DB.prepare(`
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? ORDER BY updated_at DESC LIMIT 100
  `).bind(projectId, row.external_user_id).all();
  return c.json({ data: { ...serializeContact(row), conversations: conversations.results } });
});

operations.patch('/:projectId/contacts/:contactId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const before = await contact(c.env.DB, projectId, c.req.param('contactId'));
  const body = await readJsonObject(c.req.raw);
  const merged = contactInput({
    ...serializeContact(before), ...body,
    custom_attributes: body.custom_attributes ?? parseJson(before.custom_attributes_json, {}),
  });
  if (merged.company_id) await company(c.env.DB, projectId, merged.company_id);
  try {
    await c.env.DB.prepare(`
      UPDATE messaging_contacts SET external_user_id = ?, name = ?, email = ?, phone = ?,
        company_id = ?, avatar_url = ?, blocked = ?, custom_attributes_json = ?, last_seen_at = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?
    `).bind(merged.external_user_id, merged.name, merged.email, merged.phone, merged.company_id,
      merged.avatar_url, merged.blocked ? 1 : 0, JSON.stringify(merged.custom_attributes),
      merged.last_seen_at, projectId, c.req.param('contactId')).run();
  } catch (error) { throw conflict(error, 'contact_conflict', 'A contact with this identity or email already exists'); }
  const after = await contact(c.env.DB, projectId, c.req.param('contactId'));
  await audit(c.env.DB, projectId, 'contact', String(after.id), 'updated', actorId, after);
  return c.json({ data: serializeContact(after) });
});

operations.get('/:projectId/contacts/:contactId/notes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  await contact(c.env.DB, projectId, c.req.param('contactId'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messaging_contact_notes WHERE project_id = ? AND contact_id = ? ORDER BY created_at DESC
  `).bind(projectId, c.req.param('contactId')).all();
  return c.json({ data: rows.results });
});

operations.post('/:projectId/contacts/:contactId/notes', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  await contact(c.env.DB, projectId, c.req.param('contactId'));
  const body = await readJsonObject(c.req.raw);
  const content = text(body.content, 'content', 8_000);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO messaging_contact_notes (id, project_id, contact_id, content, created_by) VALUES (?, ?, ?, ?, ?)
  `).bind(id, projectId, c.req.param('contactId'), content, actorId).run();
  await audit(c.env.DB, projectId, 'contact_note', id, 'created', actorId, { contact_id: c.req.param('contactId') });
  return c.json({ data: await c.env.DB.prepare('SELECT * FROM messaging_contact_notes WHERE id = ?').bind(id).first() }, 201);
});

operations.delete('/:projectId/contacts/:contactId/notes/:noteId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const row = await c.env.DB.prepare(`
    DELETE FROM messaging_contact_notes WHERE id = ? AND contact_id = ? AND project_id = ? RETURNING id
  `).bind(c.req.param('noteId'), c.req.param('contactId'), projectId).first();
  if (!row) throw failure('contact_note_not_found', 'Contact note not found', 404);
  await audit(c.env.DB, projectId, 'contact_note', c.req.param('noteId'), 'deleted', actorId, {});
  return c.body(null, 204);
});

operations.get('/:projectId/companies', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const rows = await c.env.DB.prepare(`
    SELECT company.*, (SELECT COUNT(*) FROM messaging_contacts contact WHERE contact.company_id = company.id) AS contact_count
    FROM messaging_companies company WHERE project_id = ? ORDER BY name LIMIT 250
  `).bind(projectId).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeCompany) });
});

operations.post('/:projectId/companies', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const input = companyInput(await readJsonObject(c.req.raw));
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`
      INSERT INTO messaging_companies (id, project_id, name, domain, description, custom_attributes_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, projectId, input.name, input.domain, input.description, JSON.stringify(input.custom_attributes)).run();
  } catch (error) { throw conflict(error, 'company_conflict', 'A company with this domain already exists'); }
  const created = await company(c.env.DB, projectId, id);
  await audit(c.env.DB, projectId, 'company', id, 'created', actorId, created);
  return c.json({ data: serializeCompany(created) }, 201);
});

operations.get('/:projectId/conversations/:conversationId/participants', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messaging_conversation_participants WHERE project_id = ? AND conversation_id = ? ORDER BY created_at
  `).bind(projectId, c.req.param('conversationId')).all();
  return c.json({ data: rows.results });
});

operations.post('/:projectId/conversations/:conversationId/participants', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const body = await readJsonObject(c.req.raw);
  const kind = String(body.participant_kind || '');
  if (!['agent', 'team', 'contact'].includes(kind)) throw failure('participant_kind_invalid', 'Participant kind is invalid');
  const participantId = text(body.participant_id, 'participant_id', 255);
  await c.env.DB.prepare(`
    INSERT INTO messaging_conversation_participants
      (conversation_id, project_id, participant_kind, participant_id, created_by)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
  `).bind(c.req.param('conversationId'), projectId, kind, participantId, actorId).run();
  await audit(c.env.DB, projectId, 'conversation_participant', `${c.req.param('conversationId')}:${kind}:${participantId}`, 'created', actorId, {});
  return c.json({ data: { conversation_id: c.req.param('conversationId'), participant_kind: kind, participant_id: participantId } }, 201);
});

operations.delete('/:projectId/conversations/:conversationId/participants/:kind/:participantId', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  await c.env.DB.prepare(`
    DELETE FROM messaging_conversation_participants
    WHERE project_id = ? AND conversation_id = ? AND participant_kind = ? AND participant_id = ?
  `).bind(projectId, c.req.param('conversationId'), c.req.param('kind'), c.req.param('participantId')).run();
  await audit(c.env.DB, projectId, 'conversation_participant', c.req.param('participantId'), 'deleted', actorId, {});
  return c.body(null, 204);
});

operations.get('/:projectId/conversations/:conversationId/draft', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const row = await c.env.DB.prepare(`
    SELECT * FROM messaging_conversation_drafts WHERE conversation_id = ? AND agent_id = ?
  `).bind(c.req.param('conversationId'), actorId).first<Record<string, unknown>>();
  return c.json({ data: row ? { ...row, attachments: parseJson(row.attachments_json, []) } : null });
});

operations.put('/:projectId/conversations/:conversationId/draft', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  await conversation(c.env.DB, projectId, c.req.param('conversationId'));
  const body = await readJsonObject(c.req.raw);
  const content = optionalText(body.content, 'content', 8_000);
  const attachments = array(body.attachments ?? [], 'attachments', 20);
  await c.env.DB.prepare(`
    INSERT INTO messaging_conversation_drafts (conversation_id, project_id, agent_id, content, attachments_json)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
      content = excluded.content, attachments_json = excluded.attachments_json,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(c.req.param('conversationId'), projectId, actorId, content, JSON.stringify(attachments)).run();
  return c.json({ data: { conversation_id: c.req.param('conversationId'), agent_id: actorId, content, attachments } });
});

operations.post('/:projectId/conversations/:conversationId/macros/:macroId/execute', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const result = await executeMacro(c.env.DB, projectId, c.req.param('conversationId'), c.req.param('macroId'), actorId);
  return c.json({ data: result });
});

operations.get('/:projectId/csat', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const rows = await c.env.DB.prepare(`
    SELECT response.*, conversation.subject, conversation.assigned_user_id, conversation.assigned_team_id
    FROM messaging_csat_responses response JOIN conversations conversation ON conversation.id = response.conversation_id
    WHERE response.project_id = ? ORDER BY response.created_at DESC LIMIT 250
  `).bind(projectId).all();
  return c.json({ data: rows.results });
});

operations.get('/:projectId/notifications', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const unread = c.req.query('unread') === 'true';
  const rows = await c.env.DB.prepare(`
    SELECT * FROM messaging_agent_notifications
    WHERE project_id = ? AND agent_id = ? AND (? = 0 OR read_at IS NULL)
    ORDER BY created_at DESC LIMIT 250
  `).bind(projectId, actorId, unread ? 1 : 0).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) })) });
});

operations.post('/:projectId/notifications', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const agentId = text(body.agent_id, 'agent_id', 255);
  const notificationType = text(body.notification_type, 'notification_type', 64);
  const title = text(body.title, 'title', 255);
  const notificationBody = text(body.body, 'body', 2_000);
  const conversationId = body.conversation_id == null ? null : text(body.conversation_id, 'conversation_id', 255);
  if (conversationId) await conversation(c.env.DB, projectId, conversationId);
  const payload = object(body.payload ?? {}, 'payload', 8_000);
  await c.env.DB.prepare(`
    INSERT INTO messaging_agent_notifications
      (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, projectId, agentId, notificationType, title, notificationBody, conversationId, JSON.stringify(payload)).run();
  await audit(c.env.DB, projectId, 'notification', id, 'created', actorId, { agent_id: agentId, notification_type: notificationType });
  return c.json({ data: { id } }, 201);
});

operations.patch('/:projectId/notifications/:notificationId/read', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const actorId = actor(c.req.header('X-OpenGrow-Agent-Id'));
  const row = await c.env.DB.prepare(`
    UPDATE messaging_agent_notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND agent_id = ? RETURNING *
  `).bind(c.req.param('notificationId'), projectId, actorId).first();
  if (!row) throw failure('notification_not_found', 'Notification not found', 404);
  return c.json({ data: row });
});

operations.get('/:projectId/search', async (c) => {
  const projectId = positiveInt(c.req.param('projectId'));
  const query = text(c.req.query('q'), 'q', 255);
  if (query.length < 2) throw failure('search_query_too_short', 'Search query must contain at least two characters');
  const like = `%${escapeLike(query)}%`;
  const [contacts, conversations, messages] = await Promise.all([
    c.env.DB.prepare(`SELECT id, external_user_id, name, email, phone FROM messaging_contacts
      WHERE project_id = ? AND (external_user_id LIKE ? ESCAPE '\\' OR COALESCE(name, '') LIKE ? ESCAPE '\\'
        OR COALESCE(email, '') LIKE ? ESCAPE '\\') LIMIT 50`).bind(projectId, like, like, like).all(),
    c.env.DB.prepare(`SELECT * FROM conversations WHERE project_id = ? AND
      (external_user_id LIKE ? ESCAPE '\\' OR COALESCE(subject, '') LIKE ? ESCAPE '\\'
        OR COALESCE(last_message_preview, '') LIKE ? ESCAPE '\\') LIMIT 50`).bind(projectId, like, like, like).all(),
    c.env.DB.prepare(`SELECT message.* FROM messages message JOIN conversations conversation ON conversation.id = message.conversation_id
      WHERE conversation.project_id = ? AND COALESCE(message.body, '') LIKE ? ESCAPE '\\'
      ORDER BY message.created_at DESC LIMIT 50`).bind(projectId, like).all(),
  ]);
  return c.json({ data: { contacts: contacts.results, conversations: conversations.results, messages: messages.results } });
});

export async function ensureMessagingContact(db: D1Database, projectId: number, externalUserId: string) {
  await db.prepare(`
    INSERT INTO messaging_contacts (id, project_id, external_user_id)
    VALUES (?, ?, ?) ON CONFLICT(project_id, external_user_id) DO UPDATE SET
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).bind(crypto.randomUUID(), projectId, externalUserId).run();
}

async function contact(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare('SELECT * FROM messaging_contacts WHERE project_id = ? AND id = ?')
    .bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('contact_not_found', 'Contact not found', 404);
  return row;
}
async function company(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare('SELECT * FROM messaging_companies WHERE project_id = ? AND id = ?')
    .bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('company_not_found', 'Company not found', 404);
  return row;
}
async function conversation(db: D1Database, projectId: number, id: string) {
  const row = await db.prepare('SELECT * FROM conversations WHERE project_id = ? AND id = ?')
    .bind(projectId, id).first<Record<string, unknown>>();
  if (!row) throw failure('conversation_not_found', 'Conversation not found', 404);
  return row;
}
function contactInput(body: Record<string, unknown>) {
  return {
    external_user_id: text(body.external_user_id, 'external_user_id', 255),
    name: nullableText(body.name, 'name', 255), email: nullableEmail(body.email),
    phone: nullableText(body.phone, 'phone', 64), company_id: nullableText(body.company_id, 'company_id', 255),
    avatar_url: nullableHttpsUrl(body.avatar_url, 'avatar_url'), blocked: body.blocked === true,
    custom_attributes: object(body.custom_attributes ?? {}, 'custom_attributes', 8_000),
    last_seen_at: nullableTimestamp(body.last_seen_at, 'last_seen_at'),
  };
}
function companyInput(body: Record<string, unknown>) {
  return {
    name: text(body.name, 'name', 255), domain: nullableText(body.domain, 'domain', 255)?.toLowerCase() || null,
    description: nullableText(body.description, 'description', 2_000),
    custom_attributes: object(body.custom_attributes ?? {}, 'custom_attributes', 8_000),
  };
}
function serializeContact(row: Record<string, unknown>) {
  return { ...row, blocked: Number(row.blocked) === 1, custom_attributes: parseJson(row.custom_attributes_json, {}), custom_attributes_json: undefined };
}
function serializeCompany(row: Record<string, unknown>) {
  return { ...row, custom_attributes: parseJson(row.custom_attributes_json, {}), custom_attributes_json: undefined };
}
async function audit(db: D1Database, projectId: number, type: string, id: string, action: string, actorId: string, payload: unknown) {
  await db.prepare(`INSERT INTO messaging_operations_audit_events
    (id, project_id, resource_type, resource_id, action, actor_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), projectId, type, id, action, actorId, JSON.stringify(payload)).run();
}
function positiveInt(value: unknown) {
  const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw failure('project_id_invalid', 'Project id is invalid'); return parsed;
}
function actor(value: unknown) { return text(value, 'agent_id', 255); }
function text(value: unknown, field: string, max: number) {
  const parsed = String(value || '').trim(); if (!parsed || parsed.length > max) throw failure(`${field}_invalid`, `${field} is required and limited to ${max} characters`); return parsed;
}
function optionalText(value: unknown, field: string, max: number) {
  const parsed = value == null ? '' : String(value); if (parsed.length > max) throw failure(`${field}_invalid`, `${field} is limited to ${max} characters`); return parsed;
}
function nullableText(value: unknown, field: string, max: number) { const parsed = optionalText(value, field, max).trim(); return parsed || null; }
function nullableEmail(value: unknown) {
  const parsed = nullableText(value, 'email', 320)?.toLowerCase() || null;
  if (parsed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed)) throw failure('email_invalid', 'Email is invalid'); return parsed;
}
function nullableHttpsUrl(value: unknown, field: string) {
  const parsed = nullableText(value, field, 2048); if (!parsed) return null;
  try { if (new URL(parsed).protocol !== 'https:') throw new Error(); } catch { throw failure(`${field}_invalid`, `${field} must use HTTPS`); } return parsed;
}
function nullableTimestamp(value: unknown, field: string) {
  if (value == null || value === '') return null; const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw failure(`${field}_invalid`, `${field} must be an ISO-8601 timestamp`); return date.toISOString();
}
function object(value: unknown, field: string, max: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > max) throw failure(`${field}_invalid`, `${field} must be an object under ${max} bytes`);
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string, max: number) {
  if (!Array.isArray(value) || value.length > max || JSON.stringify(value).length > 8_000) throw failure(`${field}_invalid`, `${field} must be an array with at most ${max} items`); return value;
}
function parseJson(value: unknown, fallback: unknown) { if (typeof value !== 'string') return fallback; try { return JSON.parse(value); } catch { return fallback; } }
function escapeLike(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_'); }
function conflict(error: unknown, code: string, message: string) {
  if (String((error as Error).message).includes('UNIQUE')) return failure(code, message, 409); return error;
}
function failure(code: string, message: string, status = 422) { return Object.assign(new Error(message), { code, status }); }

export default operations;
