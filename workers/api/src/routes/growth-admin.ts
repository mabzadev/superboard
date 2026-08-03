import { Hono } from 'hono';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { purchasesError } from '../lib/purchases-v2';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';

const growth = new Hono<{ Bindings: Env; Variables: AppVariables }>();
growth.use('*', authMiddleware);

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = await c.env.DB.prepare('SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1')
    .bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
  if (!access) throw purchasesError('project_not_found', 'Project not found', 404);
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, id: String(project.id), role: access.role };
}

growth.all('/:projectId/*', async (c) => {
  try {
    const project = await projectFor(c);
    if (!c.env.GROWTH || !c.env.GROWTH_INTERNAL_TOKEN) {
      throw purchasesError('growth_unavailable', 'Growth services are not configured', 503);
    }
    const current = new URL(c.req.url);
    const suffix = current.pathname.replace(/^\/api\/v2\/growth\/projects\/[^/]+/, '');
    const target = new URL(`https://growth.internal/internal/projects/${project.id}${suffix}`);
    target.search = current.search;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('authorization');
    headers.set('X-OpenGrow-Internal-Token', c.env.GROWTH_INTERNAL_TOKEN);
    headers.set('X-OpenGrow-Actor-Id', String(c.get('userId')));
    const response = await c.env.GROWTH.fetch(new Request(target, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? null : c.req.raw.body,
    }));
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (error: any) {
    const status = Number(error?.status || 422);
    return c.json({
      code: error?.code || 'growth_proxy_failed',
      message: status >= 500 ? 'Growth services are temporarily unavailable' : error?.message || 'Growth request failed',
      retryable: status >= 500,
      request_id: c.req.header('cf-ray') || crypto.randomUUID(),
    }, status as 400);
  }
});

export default growth;
