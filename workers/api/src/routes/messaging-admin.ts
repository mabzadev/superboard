import { Hono } from 'hono';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { purchasesError } from '../lib/purchases-v2';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';

const messaging = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const REALTIME_TICKET_TTL_MS = 60_000;

type RealtimeTicketRow = {
  project_id: string;
  project_external_id: string;
  conversation_id: string;
  user_id: string;
  expires_at: string;
};

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = await c.env.DB.prepare('SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1')
    .bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
  if (!access) throw purchasesError('project_not_found', 'Project not found', 404);
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, id: String(project.id), role: access.role };
}

messaging.post('/:projectId/conversations/:conversationId/realtime-ticket', authMiddleware, async (c) => {
  try {
    if (!c.env.MESSAGING || !c.env.MESSAGING_INTERNAL_TOKEN) {
      throw purchasesError('messaging_unavailable', 'Messaging service is not configured', 503);
    }
    const project = await projectFor(c);
    const conversationId = requiredIdentifier(c.req.param('conversationId'), 'conversation_id');
    const issued = await issueMessagingRealtimeTicket(c.env.DB, {
      projectId: project.id,
      projectExternalId: requiredIdentifier(c.req.param('projectId'), 'project_id'),
      conversationId,
      userId: String(c.get('userId')),
    });
    return c.json({ data: issued }, 201);
  } catch (error) {
    return messagingError(c, error);
  }
});

messaging.get('/:projectId/conversations/:conversationId/ws', async (c) => {
  try {
    if (!c.env.MESSAGING || !c.env.MESSAGING_INTERNAL_TOKEN) {
      throw purchasesError('messaging_unavailable', 'Messaging service is not configured', 503);
    }
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
      throw purchasesError('messaging_upgrade_required', 'WebSocket upgrade is required', 426);
    }
    const conversationId = requiredIdentifier(c.req.param('conversationId'), 'conversation_id');
    const ticket = requiredTicket(c.req.query('ticket'));
    const authorized = await consumeMessagingRealtimeTicket(c.env.DB, {
      ticket,
      projectExternalId: requiredIdentifier(c.req.param('projectId'), 'project_id'),
      conversationId,
    });
    if (!authorized) throw purchasesError('messaging_realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401);
    const headers = new Headers(c.req.raw.headers);
    headers.delete('authorization');
    headers.delete('cookie');
    headers.set('X-OpenGrow-Internal-Token', c.env.MESSAGING_INTERNAL_TOKEN);
    headers.set('X-OpenGrow-Agent-Id', authorized.user_id);
    return c.env.MESSAGING.fetch(new Request(
      `https://messaging.internal/internal/projects/${authorized.project_id}/conversations/${encodeURIComponent(conversationId)}/ws`,
      { method: 'GET', headers },
    ));
  } catch (error) {
    return messagingError(c, error);
  }
});

messaging.all('/:projectId/*', authMiddleware, async (c) => {
  try {
    const project = await projectFor(c);
    if (!c.env.MESSAGING || !c.env.MESSAGING_INTERNAL_TOKEN) {
      throw purchasesError('messaging_unavailable', 'Messaging service is not configured', 503);
    }
    const current = new URL(c.req.url);
    const suffix = current.pathname.replace(/^\/api\/v2\/messaging\/projects\/[^/]+/, '');
    requireMessagingAccess(c.req.method, suffix, project.role);
    const target = new URL(`https://messaging.internal/internal/projects/${project.id}${suffix}`);
    target.search = current.search;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('authorization');
    headers.set('X-OpenGrow-Internal-Token', c.env.MESSAGING_INTERNAL_TOKEN);
    headers.set('X-OpenGrow-Agent-Id', String(c.get('userId')));
    const response = await c.env.MESSAGING.fetch(new Request(target, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? null : c.req.raw.body,
    }));
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error) { return messagingError(c, error); }
});

export async function issueMessagingRealtimeTicket(
  db: D1Database,
  params: { projectId: string; projectExternalId: string; conversationId: string; userId: string },
  now = Date.now(),
) {
  const ticket = randomTicket();
  const tokenHash = await sha256Hex(ticket);
  const expiresAt = new Date(now + REALTIME_TICKET_TTL_MS).toISOString();
  await db.prepare(`
    INSERT INTO messaging_realtime_tickets (
      token_hash, project_id, project_external_id, conversation_id, user_id, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    tokenHash,
    params.projectId,
    params.projectExternalId,
    params.conversationId,
    params.userId,
    expiresAt,
  ).run();
  return { ticket, expires_at: expiresAt };
}

export function requireMessagingAccess(method: string, suffix: string, role: string) {
  const normalizedMethod = method.toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod);
  const administrative = suffix === '/settings' || suffix.startsWith('/settings/entities');
  if (mutating && administrative && !['owner', 'admin'].includes(role)) {
    throw purchasesError('insufficient_role', 'Owner or admin access is required to change Chat configuration', 403);
  }
}

export async function consumeMessagingRealtimeTicket(
  db: D1Database,
  params: { ticket: string; projectExternalId: string; conversationId: string },
  now = Date.now(),
) {
  const tokenHash = await sha256Hex(params.ticket);
  return db.prepare(`
    UPDATE messaging_realtime_tickets SET consumed_at = ?
    WHERE token_hash = ? AND project_external_id = ? AND conversation_id = ?
      AND consumed_at IS NULL AND expires_at > ?
    RETURNING project_id, project_external_id, conversation_id, user_id, expires_at
  `).bind(
    new Date(now).toISOString(),
    tokenHash,
    params.projectExternalId,
    params.conversationId,
    new Date(now).toISOString(),
  ).first<RealtimeTicketRow>();
}

function requiredIdentifier(value: unknown, field: string) {
  const parsed = String(value || '').trim();
  if (!parsed || parsed.length > 255) throw purchasesError(`${field}_invalid`, `A valid ${field} is required`, 422);
  return parsed;
}

function requiredTicket(value: unknown) {
  const ticket = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    throw purchasesError('messaging_realtime_ticket_invalid', 'Realtime ticket is invalid or expired', 401);
  }
  return ticket;
}

function randomTicket() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function messagingError(c: any, error: unknown) {
  const tagged = error as { status?: number; code?: string; message?: string };
  const status = Number(tagged?.status || 422);
  return c.json({
    code: tagged?.code || 'messaging_proxy_failed',
    message: status >= 500 ? 'Messaging is temporarily unavailable' : tagged?.message || 'Messaging request failed',
    retryable: status >= 500,
    request_id: c.req.header('cf-ray') || crypto.randomUUID(),
  }, status as 400);
}

export default messaging;
