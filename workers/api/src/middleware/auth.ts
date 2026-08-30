import { Context, Next } from 'hono';
import { AppVariables, Env } from '../types';
import { getRequestAuthContext } from '../lib/auth';

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) {
  if (c.env.CREDENTIAL_KEY_SCOPE === 'billing') {
    const actor = (c.req.header('X-OpenGrow-Internal-Actor') || '').trim();
    if (/^[1-9][0-9]{0,18}$/.test(actor)) {
      c.set('userId', Number(actor));
      await next();
      return;
    }
  }
  const auth = await getRequestAuthContext(c.env, c.req.raw.headers);
  if (!auth) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
  c.set('userId', auth.userId);
  if (auth.instanceId) c.set('instanceId', auth.instanceId);
  await next();
}

function isServerSdkPath(pathname: string): boolean {
  return /(?:^|\/)(generate_link|metrics_for_project)$/.test(pathname)
    || /(?:^|\/)(link|metrics_for_link)\//.test(pathname);
}

function sdkHeader(c: Context, name: string): string {
  return (c.req.header(name) || c.req.header(name.toLowerCase()) || '').trim();
}

async function getOrCreateProjectForEnvironment(db: D1Database, instanceId: number, environment: string) {
  const isTest = environment === 'test';
  const existing = await db.prepare(
    'SELECT id FROM projects WHERE instance_id = ? AND is_test = ? LIMIT 1'
  ).bind(instanceId, isTest ? 1 : 0).first<{ id: number }>();
  if (existing) return existing.id;

  const instance = await db.prepare('SELECT uri_scheme FROM instances WHERE id = ? LIMIT 1')
    .bind(instanceId).first<{ uri_scheme: string }>();
  const baseName = instance?.uri_scheme || `instance-${instanceId}`;
  const identifier = `${baseName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${isTest ? 'test' : 'prod'}_${instanceId}`;
  const created = await db.prepare(
    'INSERT INTO projects (name, identifier, instance_id, is_test) VALUES (?, ?, ?, ?) RETURNING id'
  ).bind(isTest ? `${baseName} Test` : baseName, identifier, instanceId, isTest ? 1 : 0).first<{ id: number }>();
  if (!created) throw new Error('Unable to create SDK project');
  await db.prepare('INSERT OR IGNORE INTO redirect_configs (project_id, default_fallback) VALUES (?, ?)')
    .bind(created.id, '').run();
  return created.id;
}

async function resolveMobileProject(db: D1Database, projectKey: string) {
  const isTest = projectKey.startsWith('test_');
  const instanceKey = isTest ? projectKey.slice('test_'.length) : projectKey;
  const instance = instanceKey
    ? await db.prepare('SELECT id FROM instances WHERE api_key = ? LIMIT 1')
      .bind(instanceKey).first<{ id: number }>()
    : null;

  if (instance) {
    const instanceId = Number(instance.id);
    const projectId = await getOrCreateProjectForEnvironment(
      db,
      instanceId,
      isTest ? 'test' : 'production',
    );
    return { id: Number(projectId), instance_id: instanceId };
  }

  return db.prepare(
    'SELECT id, instance_id FROM projects WHERE identifier = ? LIMIT 1'
  ).bind(projectKey).first<{ id: number; instance_id: number }>();
}

async function mobileProject(c: Context<{ Bindings: Env; Variables: AppVariables }>, projectKey: string) {
  const platform = sdkHeader(c, 'PLATFORM').toLowerCase();
  const identifier = sdkHeader(c, 'IDENTIFIER');
  if (!platform || !identifier) {
    return { error: c.json({ error: 'PROJECT-KEY, PLATFORM and IDENTIFIER required' }, 401) };
  }

  const project = await resolveMobileProject(c.env.DB, projectKey);
  if (!project) return { error: c.json({ error: 'Invalid credentials' }, 403) };

  let configured: { id: number | string } | null = null;
  if (platform === 'ios') {
    configured = await c.env.DB.prepare(`
      SELECT a.id
      FROM applications a
      JOIN ios_configurations ic ON ic.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'ios'
        AND COALESCE(a.enabled, 1) = 1
        AND ic.bundle_id = ?
      LIMIT 1
    `).bind(project.instance_id, identifier).first<{ id: number }>();
  } else if (platform === 'android') {
    configured = await c.env.DB.prepare(`
      SELECT a.id
      FROM applications a
      JOIN android_configurations ac ON ac.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'android'
        AND COALESCE(a.enabled, 1) = 1
        AND ac.identifier = ?
      LIMIT 1
    `).bind(project.instance_id, identifier).first<{ id: number }>();
  } else if (platform === 'web') {
    configured = await c.env.DB.prepare(`
      SELECT a.id
      FROM applications a
      JOIN web_configurations wc ON wc.application_id = a.id
      LEFT JOIN web_configuration_linked_domains wcld ON wcld.web_configuration_id = wc.id
      WHERE a.instance_id = ? AND a.platform = 'web'
        AND COALESCE(a.enabled, 1) = 1
        AND (
          lower(wcld.domain) = lower(?)
          OR lower(replace(replace(wc.site_url, 'https://', ''), 'http://', '')) = lower(?)
        )
      LIMIT 1
    `).bind(project.instance_id, identifier, identifier).first<{ id: number }>();
  } else if (platform === 'desktop') {
    configured = await c.env.DB.prepare(`
      SELECT a.id
      FROM applications a
      JOIN desktop_configurations dc ON dc.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'desktop'
        AND COALESCE(a.enabled, 1) = 1
        AND (dc.bundle_identifier = ? OR dc.package_name = ?)
      LIMIT 1
    `).bind(project.instance_id, identifier, identifier).first<{ id: number }>();
  } else {
    return { error: c.json({ error: 'Unsupported platform' }, 422) };
  }

  if (!configured) return { error: c.json({ error: 'Invalid platform configuration' }, 403) };
  return { project, platform, identifier };
}

export async function sdkMiddleware(c: Context<{ Bindings: Env; Variables: AppVariables }>, next: Next) {
  const apiKey = c.req.header('X-Api-Key');
  const projectKey = c.req.header('PROJECT-KEY') || c.req.header('project-key');
  if (!apiKey && !projectKey) {
    return c.json({ error: 'API key required' }, 401);
  }

  if (projectKey) {
    const path = new URL(c.req.url).pathname;
    if (isServerSdkPath(path)) {
      const environment = sdkHeader(c, 'ENVIRONMENT').toLowerCase();
      if (!['production', 'test'].includes(environment)) {
        return c.json({ error: 'ENVIRONMENT must be production or test' }, 401);
      }
      const instance = await c.env.DB.prepare('SELECT id FROM instances WHERE api_key = ? LIMIT 1')
        .bind(projectKey).first<{ id: number }>();
      if (!instance) return c.json({ error: 'Invalid credentials' }, 403);
      const projectId = await getOrCreateProjectForEnvironment(c.env.DB, Number(instance.id), environment);
      c.set('instanceId', Number(instance.id));
      c.set('projectId', Number(projectId));
      c.set('sdkAuthMode', 'server');
    } else {
      const result = await mobileProject(c, projectKey);
      if ('error' in result) return result.error;
      c.set('instanceId', Number(result.project.instance_id));
      c.set('projectId', Number(result.project.id));
      c.set('sdkAuthMode', 'mobile');
      c.set('sdkPlatform', result.platform);
      c.set('sdkIdentifier', result.identifier);
    }
    await next();
    return;
  }

  const instance = await c.env.DB.prepare(
    'SELECT id FROM instances WHERE api_key = ?'
  ).bind(apiKey).first<{ id: number }>();

  if (!instance) {
    return c.json({ error: 'Invalid API key' }, 401);
  }
  c.set('instanceId', instance.id);
  c.set('sdkAuthMode', 'legacy');
  await next();
}
