import { Hono } from 'hono';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { purchasesError } from '../lib/purchases-v2';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';

const messaging = new Hono<{ Bindings: Env; Variables: AppVariables }>();
messaging.use('*', authMiddleware);

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = await c.env.DB.prepare('SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1')
    .bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
  if (!access) throw purchasesError('project_not_found', 'Project not found', 404);
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, id: String(project.id), role: access.role };
}

messaging.all('/:projectId/*', async (c) => {
  try {
    const project = await projectFor(c);
    if (!c.env.MESSAGING || !c.env.MESSAGING_INTERNAL_TOKEN) {
      throw purchasesError('messaging_unavailable', 'Messaging service is not configured', 503);
    }
    const current = new URL(c.req.url);
    const suffix = current.pathname.replace(/^\/api\/v2\/messaging\/projects\/[^/]+/, '');
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
  } catch (error: any) {
    const status = Number(error?.status || 422);
    return c.json({
      code: error?.code || 'messaging_proxy_failed',
      message: status >= 500 ? 'Messaging is temporarily unavailable' : error?.message || 'Messaging request failed',
      retryable: status >= 500,
      request_id: c.req.header('cf-ray') || crypto.randomUUID(),
    }, status as 400);
  }
});

export default messaging;
