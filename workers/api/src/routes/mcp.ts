import { Hono } from 'hono';
import { Env } from '../types';
import { generateApiKey, generateShortCode } from '../lib/crypto';
import { getAuthUserId as getStrictAuthUserId } from '../lib/auth';
import { getOrCreateProject, getOrCreateRedirectConfig, jsonArray, parseJsonObject, resolveProject } from '../lib/db';
import { createMcpAuthorizationCode, findMcpClient, redirectUriAllowed, tokenDigest } from '../lib/mcp-oauth';
import { readRequestObjectLimited } from '@superboard/contracts/request-body';
import { buildPlatformStatus } from './platform-status';

const mcp = new Hono<{ Bindings: Env }>();
const MCP_PLATFORMS = ['ios', 'android', 'desktop'] as const;

function paramValue(c: any, body: Record<string, any>, key: string) {
  return body[key] || c.req.query(key);
}

function toBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : (value ? [value] : []);
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function supportedMcpPlatform(platform: string): platform is typeof MCP_PLATFORMS[number] {
  return (MCP_PLATFORMS as readonly string[]).includes(platform);
}

async function getAuthUserId(c: any): Promise<number | null> {
  return getStrictAuthUserId(c.env, c.req.header('Authorization'));
}

async function getMcpUserId(c: any): Promise<number | null> {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const digest = await tokenDigest(token);
  const mcpToken = await c.env.DB.prepare(`
    SELECT user_id FROM mcp_tokens
    WHERE revoked_at IS NULL
      AND (access_token = ? OR token_digest = ?)
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    LIMIT 1
  `).bind(token, digest).first().catch(() => null);
  if (mcpToken?.user_id) {
    await c.env.DB.prepare('UPDATE mcp_tokens SET last_used_at = datetime("now"), updated_at = datetime("now") WHERE access_token = ? OR token_digest = ?')
      .bind(token, digest).run().catch(() => null);
    return Number(mcpToken.user_id);
  }
  return getAuthUserId(c);
}

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 1024 * 1024);
}

async function projectForMcp(c: any, userId: number, raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return null;
  let project: any = null;
  if (/-prod$|-test$/.test(value)) project = await resolveProject(c.env.DB, value);
  else project = await c.env.DB.prepare('SELECT id, instance_id, name, identifier, is_test FROM projects WHERE id = ? LIMIT 1').bind(value).first();
  if (!project) return null;
  const role = await c.env.DB.prepare('SELECT id FROM instance_roles WHERE instance_id = ? AND user_id = ? LIMIT 1')
    .bind(project.instanceId || project.instance_id, userId).first();
  return role ? project : null;
}

async function instanceForMcp(c: any, userId: number, raw: unknown) {
  const value = String(raw || '').replace(/-(prod|test)$/, '').trim();
  const row = await c.env.DB.prepare('SELECT * FROM instances WHERE id = ? LIMIT 1').bind(value).first();
  if (!row) return null;
  const role = await c.env.DB.prepare('SELECT id FROM instance_roles WHERE instance_id = ? AND user_id = ? LIMIT 1')
    .bind(row.id, userId).first();
  return role ? row : null;
}

async function getOrCreateApplication(db: D1Database, instanceId: number, platform: string, enabled = true): Promise<number> {
  const existing = await db.prepare('SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1')
    .bind(instanceId, platform).first<{ id: number }>();
  if (existing) {
    await db.prepare('UPDATE applications SET enabled = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(enabled ? 1 : 0, existing.id).run();
    return existing.id;
  }
  const created = await db.prepare('INSERT INTO applications (platform, instance_id, enabled) VALUES (?, ?, ?) RETURNING id')
    .bind(platform, instanceId, enabled ? 1 : 0).first<{ id: number }>();
  if (!created) throw new Error('Unable to create application');
  return created.id;
}

async function loadApplicationConfig(db: D1Database, instanceId: number, platform: string) {
  if (platform === 'ios') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled,
             ic.id AS config_id, ic.bundle_id, ic.app_prefix, ic.tablet_enabled
      FROM applications a
      LEFT JOIN ios_configurations ic ON ic.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'ios'
      LIMIT 1
    `).bind(instanceId).first<any>();
    if (!row) return null;
    return {
      id: String(row.id),
      instance_id: row.instance_id,
      platform: 'ios',
      enabled: row.enabled !== 0,
      bundle_id: row.bundle_id,
      team_id: row.app_prefix,
      configuration: row.config_id ? {
        id: String(row.config_id),
        bundle_id: row.bundle_id,
        app_prefix: row.app_prefix,
        tablet_enabled: row.tablet_enabled === 1,
      } : null,
    };
  }

  if (platform === 'android') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled,
             ac.id AS config_id, ac.identifier, ac.sha256s, ac.tablet_enabled
      FROM applications a
      LEFT JOIN android_configurations ac ON ac.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'android'
      LIMIT 1
    `).bind(instanceId).first<any>();
    if (!row) return null;
    const sha256s = parseJsonArray(row.sha256s);
    return {
      id: String(row.id),
      instance_id: row.instance_id,
      platform: 'android',
      enabled: row.enabled !== 0,
      package_name: row.identifier,
      sha256_cert_fingerprints: sha256s,
      configuration: row.config_id ? {
        id: String(row.config_id),
        identifier: row.identifier,
        sha256s,
        tablet_enabled: row.tablet_enabled === 1,
      } : null,
    };
  }

  if (platform === 'desktop') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled,
             dc.id AS config_id, dc.fallback_url, dc.generated_page, dc.mac_enabled, dc.mac_uri, dc.windows_enabled, dc.windows_uri
      FROM applications a
      LEFT JOIN desktop_configurations dc ON dc.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'desktop'
      LIMIT 1
    `).bind(instanceId).first<any>();
    if (!row) return null;
    return {
      id: String(row.id),
      instance_id: row.instance_id,
      platform: 'desktop',
      enabled: row.enabled !== 0,
      fallback_url: row.fallback_url,
      configuration: row.config_id ? {
        id: String(row.config_id),
        fallback_url: row.fallback_url,
        generated_page: row.generated_page !== 0,
        mac_enabled: row.mac_enabled === 1,
        mac_uri: row.mac_uri,
        windows_enabled: row.windows_enabled === 1,
        windows_uri: row.windows_uri,
      } : null,
    };
  }

  return null;
}

async function setupPlatformConfiguration(db: D1Database, instanceId: number, platform: string, config: Record<string, any>) {
  const appId = await getOrCreateApplication(db, instanceId, platform, config.enabled === undefined ? true : toBool(config.enabled));
  if (platform === 'ios') {
    const bundleId = config.bundle_id || config.identifier || null;
    const appPrefix = config.app_prefix || config.team_id || '';
    await db.prepare(`
      INSERT INTO ios_configurations (application_id, bundle_id, app_prefix, tablet_enabled)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(application_id) DO UPDATE SET
        bundle_id = excluded.bundle_id,
        app_prefix = excluded.app_prefix,
        tablet_enabled = excluded.tablet_enabled,
        updated_at = datetime('now')
    `).bind(appId, bundleId, appPrefix, toBool(config.tablet_enabled) ? 1 : 0).run();
  }

  if (platform === 'android') {
    const identifier = config.identifier || config.package_name || '';
    const sha256s = jsonArray(config.sha256s || config.sha256_cert_fingerprints || []);
    await db.prepare(`
      INSERT INTO android_configurations (application_id, identifier, sha256s, tablet_enabled)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(application_id) DO UPDATE SET
        identifier = excluded.identifier,
        sha256s = excluded.sha256s,
        tablet_enabled = excluded.tablet_enabled,
        updated_at = datetime('now')
    `).bind(appId, identifier, sha256s, toBool(config.tablet_enabled) ? 1 : 0).run();
  }

  if (platform === 'desktop') {
    const values = [
      config.fallback_url || null,
      toBool(config.generated_page, true) ? 1 : 0,
      toBool(config.mac_enabled) ? 1 : 0,
      config.mac_uri || null,
      toBool(config.windows_enabled) ? 1 : 0,
      config.windows_uri || null,
    ];
    const existing = await db.prepare('SELECT id FROM desktop_configurations WHERE application_id = ? LIMIT 1')
      .bind(appId).first<{ id: string | number }>();
    if (existing) {
      await db.prepare(`
        UPDATE desktop_configurations
        SET fallback_url = ?, generated_page = ?, mac_enabled = ?, mac_uri = ?,
            windows_enabled = ?, windows_uri = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(...values, existing.id).run();
    } else {
      await db.prepare(`
        INSERT INTO desktop_configurations (
          application_id, platform, fallback_url, generated_page, mac_enabled, mac_uri, windows_enabled, windows_uri
        ) VALUES (?, 'desktop', ?, ?, ?, ?, ?, ?)
      `).bind(appId, ...values).run();
    }
  }

  return loadApplicationConfig(db, instanceId, platform);
}

async function redirectConfigResponse(db: D1Database, redirectConfigId: number | string) {
  const config: any = await db.prepare('SELECT * FROM redirect_configs WHERE id = ?').bind(redirectConfigId).first();
  const rows = await db.prepare('SELECT * FROM redirects WHERE redirect_config_id = ?').bind(redirectConfigId).all<any>();
  const by = (platform: string, variation: string) => {
    const row = (rows.results || []).find((item: any) => item.platform === platform && item.variation === variation);
    return {
      enabled: row?.enabled === 1,
      variation,
      appstore: row?.appstore === 1,
      fallback_url: row?.fallback_url || null,
      url: row?.fallback_url || null,
    };
  };
  return {
    id: String(redirectConfigId),
    default_fallback: config?.default_fallback || '',
    show_preview_android: config?.show_preview_android === 1,
    show_preview_ios: config?.show_preview_ios === 1,
    show_preview: config?.show_preview_android === 1 || config?.show_preview_ios === 1,
    ios: { phone: by('ios', 'phone'), tablet: by('ios', 'tablet') },
    android: { phone: by('android', 'phone'), tablet: by('android', 'tablet') },
    desktop: { all: by('desktop', 'all'), phone: by('desktop', 'phone') },
  };
}

async function domainForProject(db: D1Database, projectId: number, fallbackDomain: string) {
  const existing = await db.prepare('SELECT id FROM domains WHERE project_id = ? ORDER BY id ASC LIMIT 1').bind(projectId).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db.prepare('INSERT INTO domains (domain, project_id) VALUES (?, ?) RETURNING id')
    .bind(fallbackDomain, projectId).first<{ id: number }>();
  if (!created) throw new Error('Unable to create domain');
  return created.id;
}

function linkJson(row: any) {
  return {
    id: String(row.id),
    name: row.name || row.title || row.path,
    title: row.title || row.name || row.path,
    subtitle: row.subtitle || null,
    path: row.path,
    active: row.active === 1,
    data: parseJsonObject(row.data) || {},
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findProjectLink(db: D1Database, projectId: number, pathOrId: unknown, byPath = false) {
  const column = byPath ? 'l.path' : 'l.id';
  return db.prepare(`
    SELECT l.*
    FROM links l
    LEFT JOIN domains d ON d.id = l.domain_id
    LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE ${column} = ? AND (d.project_id = ? OR rc.project_id = ?)
    LIMIT 1
  `).bind(pathOrId, projectId, projectId).first<any>();
}

async function metricsFor(c: any, projectId: number, linkId?: number) {
  const linkClause = linkId ? ' AND link_id = ?' : '';
  const binds = linkId ? [projectId, linkId] : [projectId];
  const row = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens
    FROM events
    WHERE project_id = ?${linkClause}
  `).bind(...binds).first();
  return {
    views: Number(row?.views || 0),
    opens: Number(row?.opens || 0),
    installs: Number(row?.installs || 0),
    reinstalls: Number(row?.reinstalls || 0),
    app_opens: Number(row?.app_opens || 0),
  };
}

mcp.get('/validate', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  return c.json({ valid: true });
});

mcp.delete('/token', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const digest = await tokenDigest(token);
  await c.env.DB.prepare('UPDATE mcp_tokens SET revoked_at = datetime("now"), updated_at = datetime("now") WHERE access_token = ? OR token_digest = ?')
    .bind(token, digest).run();
  return c.json({ message: 'Token revoked' });
});

mcp.get('/status', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const user = await c.env.DB.prepare('SELECT id, email, name FROM users WHERE id = ?').bind(userId).first<any>();
  const rows = await c.env.DB.prepare(`
    SELECT i.id, i.uri_scheme,
      COUNT(DISTINCT p.id) AS projects_count,
      COUNT(DISTINCT l.id) AS links_count
    FROM instances i
    JOIN instance_roles ir ON ir.instance_id = i.id
    LEFT JOIN projects p ON p.instance_id = i.id
    LEFT JOIN redirect_configs rc ON rc.project_id = p.id
    LEFT JOIN links l ON l.redirect_config_id = rc.id AND COALESCE(l.active, 1) = 1
    WHERE ir.user_id = ?
    GROUP BY i.id
    ORDER BY i.id ASC
  `).bind(userId).all<any>();
  const instances = await Promise.all((rows.results || []).map(async (instance: any) => {
    const projects = await c.env.DB.prepare(`
      SELECT id, name, identifier, is_test
      FROM projects
      WHERE instance_id = ?
      ORDER BY is_test ASC, id ASC
    `).bind(instance.id).all<any>();
    return {
      id: String(instance.id),
      uri_scheme: instance.uri_scheme || null,
      projects_count: Number(instance.projects_count || 0),
      links_count: Number(instance.links_count || 0),
      projects: (projects.results || []).map((project: any) => ({
        id: `${instance.id}-${project.is_test ? 'test' : 'prod'}`,
        name: project.name,
        identifier: project.identifier,
        environment: project.is_test ? 'test' : 'production',
      })),
    };
  }));
  return c.json({ user, instances });
});

mcp.get('/platform-status', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const operator = await c.env.DB.prepare(`
    SELECT role FROM instance_roles
    WHERE user_id = ? AND role IN ('owner', 'admin')
    ORDER BY id ASC LIMIT 1
  `).bind(userId).first<{ role: string }>();
  if (!operator) return c.json({ error: 'admin_required' }, 403);
  return c.json(await buildPlatformStatus(c.env), 200, {
    'cache-control': 'no-store',
  });
});

mcp.get('/usage', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const instance = await instanceForMcp(c, userId, c.req.query('instance_id'));
  if (!instance) return c.json({ error: 'Instance not found' }, 404);
  const activeUsers = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT e.device_id) AS total
    FROM events e
    JOIN projects p ON p.id = e.project_id
    WHERE p.instance_id = ? AND datetime(e.created_at) >= datetime('now', '-30 days')
  `).bind(instance.id).first<{ total: number }>();
  return c.json({ usage: { instance_id: String(instance.id), mau: Number(activeUsers?.total || 0) } });
});

// GET /api/v1/mcp/tokens
mcp.get('/tokens', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await c.env.DB.prepare(`
    SELECT
      mt.id,
      COALESCE(mc.client_name, mc.name, NULLIF(mt.name, ''), mt.client_id, 'MCP Client') AS display_name,
      COALESCE(mt.client_id, mc.client_id) AS client_id,
      mt.created_at,
      mt.last_used_at
    FROM mcp_tokens mt
    LEFT JOIN mcp_clients mc ON mc.id = mt.mcp_client_id OR mc.client_id = mt.client_id
    WHERE mt.user_id = ?
      AND mt.revoked_at IS NULL
      AND datetime(mt.created_at) > datetime('now', '-90 days')
    ORDER BY datetime(mt.created_at) DESC
  `).bind(String(userId)).all<any>();
  return c.json({
    tokens: (rows.results || []).map((row: any) => ({
      id: String(row.id),
      name: row.display_name || 'MCP Client',
      client_id: row.client_id || null,
      created_at: row.created_at,
      last_used_at: row.last_used_at || null,
    })),
  });
});

// DELETE /api/v1/mcp/tokens/:tokenId
mcp.delete('/tokens/:tokenId', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const row = await c.env.DB.prepare(`
    UPDATE mcp_tokens
    SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL
    RETURNING id
  `).bind(c.req.param('tokenId'), String(userId)).first<{ id: string }>();
  if (!row) return c.json({ error: 'Token not found' }, 404);
  return c.json({ message: 'Token revoked' });
});

// POST /api/v1/mcp/approve_consent
mcp.post('/approve_consent', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await readBody(c);
  const redirectUri = String(body.redirect_uri || '');
  const clientId = String(body.client_id || '');
  const codeChallenge = String(body.code_challenge || '');
  const codeChallengeMethod = String(body.code_challenge_method || '');
  if (!redirectUri || !clientId) return c.json({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' }, 400);
  if (!codeChallenge || codeChallengeMethod !== 'S256') return c.json({ error: 'invalid_request', error_description: 'PKCE required' }, 400);
  const client = await findMcpClient(c.env.DB, clientId);
  if (!client) return c.json({ error: 'invalid_client', error_description: 'Unknown client_id' }, 400);
  if (!redirectUriAllowed(client, redirectUri)) {
    return c.json({ error: 'invalid_request', error_description: 'redirect_uri not registered for this client' }, 400);
  }
  const code = await createMcpAuthorizationCode(c.env.DB, {
    client,
    userId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    state: body.state || null,
    scope: body.scope || 'mcp:full',
  });
  return c.json({ code, redirect_uri: redirectUri, state: body.state || null });
});

mcp.post('/projects', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  if (!body.name) return c.json({ error: 'name is required' }, 422);
  const uriBase = String(body.name).toLowerCase().replace(/[^a-z0-9]/g, '') || 'instance';
  const created = await c.env.DB.prepare(
    'INSERT INTO instances (api_key, uri_scheme) VALUES (?, ?) RETURNING *'
  ).bind(generateApiKey(), `${uriBase}${generateShortCode(8).toLowerCase()}`).first<any>();
  await c.env.DB.prepare('INSERT INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)')
    .bind(userId, created.id, 'owner').run();
  const production = await getOrCreateProject(c.env.DB, created.id, 'production');
  const test = await getOrCreateProject(c.env.DB, created.id, 'test');
  return c.json({
    instance: {
      id: String(created.id),
      uri_scheme: created.uri_scheme,
      production: {
        id: production.externalId,
        name: production.name,
        identifier: production.identifier,
      },
      test: {
        id: test.externalId,
        name: test.name,
        identifier: test.identifier,
      },
    },
  }, 201);
});

mcp.post('/links/search', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare(`
    SELECT l.*
    FROM links l
    LEFT JOIN domains d ON d.id = l.domain_id
    LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE d.project_id = ? OR rc.project_id = ?
    ORDER BY datetime(l.created_at) DESC
    LIMIT ?
  `).bind(project.id, project.id, Math.min(100, Number(body.limit || 25))).all<any>();
  return c.json({ links: (rows.results || []).map(linkJson) });
});

mcp.post('/links', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, Number(project.id));
  const domainId = await domainForProject(c.env.DB, Number(project.id), c.env.SHORTLINK_DOMAIN);
  let path = String(body.path || generateShortCode()).replace(/^\/+/, '');
  while (await c.env.DB.prepare('SELECT id FROM links WHERE path = ? LIMIT 1').bind(path).first()) path = generateShortCode();
  const link = await c.env.DB.prepare(`
    INSERT INTO links (
      name, title, subtitle, path, image_url, data, tags, redirect_config_id, domain_id,
      tracking_campaign, tracking_medium, tracking_source, generated_from_platform, sdk_generated, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mcp', ?, 1)
    RETURNING *
  `).bind(
    body.name,
    body.title || body.name,
    body.subtitle || null,
    path,
    body.image_url || null,
    JSON.stringify(parseJsonObject(body.data) || {}),
    jsonArray(body.tags || []),
    redirectConfigId,
    domainId,
    body.tracking_campaign || null,
    body.tracking_medium || null,
    body.tracking_source || null,
    body.hidden ? 1 : 0,
  ).first<any>();
  return c.json({ link: linkJson(link) }, 201);
});

mcp.get('/links/by-path/:path', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const project = await projectForMcp(c, userId, c.req.query('project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const link = await findProjectLink(c.env.DB, Number(project.id), c.req.param('path'), true);
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ link: linkJson(link) });
});

mcp.patch('/links/:id', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const link = await findProjectLink(c.env.DB, Number(project.id), c.req.param('id'));
  if (!link) return c.json({ error: 'Link not found' }, 404);
  await c.env.DB.prepare(`
    UPDATE links
    SET name = COALESCE(?, name), title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
        data = COALESCE(?, data), tags = COALESCE(?, tags), sdk_generated = COALESCE(?, sdk_generated),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    body.name || null,
    body.title || null,
    body.subtitle || null,
    body.data ? JSON.stringify(parseJsonObject(body.data) || {}) : null,
    body.tags ? jsonArray(body.tags) : null,
    body.hidden === undefined ? null : (body.hidden ? 1 : 0),
    link.id,
  ).run();
  const updated = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(link.id).first<any>();
  return c.json({ link: linkJson(updated) });
});

mcp.delete('/links/:id', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const project = await projectForMcp(c, userId, c.req.query('project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const link = await findProjectLink(c.env.DB, Number(project.id), c.req.param('id'));
  if (!link) return c.json({ error: 'Link not found' }, 404);
  await c.env.DB.prepare('UPDATE links SET active = 0, updated_at = datetime("now") WHERE id = ?').bind(link.id).run();
  return c.json({ link: { ...linkJson(link), active: false } });
});

mcp.post('/analytics/link', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const link = await findProjectLink(c.env.DB, Number(project.id), body.path, true);
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ link_path: link.path, metrics: await metricsFor(c, Number(project.id), Number(link.id)) });
});

mcp.post('/analytics/overview', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  return c.json({ metrics: await metricsFor(c, Number(project.id)) });
});

mcp.post('/analytics/top_links', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare(`
    SELECT l.*, COUNT(e.id) AS views
    FROM links l
    LEFT JOIN events e ON e.link_id = l.id AND e.event = 'view'
    LEFT JOIN domains d ON d.id = l.domain_id
    LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE d.project_id = ? OR rc.project_id = ?
    GROUP BY l.id
    ORDER BY views DESC, datetime(l.created_at) DESC
    LIMIT ?
  `).bind(project.id, project.id, Math.min(25, Number(body.limit || 10))).all<any>();
  return c.json({ links: (rows.results || []).map((row: any) => ({ ...linkJson(row), views: Number(row.views || 0) })) });
});

mcp.post('/campaigns', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  if (!body.name) return c.json({ error: 'name is required' }, 400);
  const campaign = await c.env.DB.prepare('INSERT INTO campaigns (name, project_id) VALUES (?, ?) RETURNING *')
    .bind(body.name, project.id).first<any>();
  return c.json({ campaign }, 201);
});

mcp.post('/campaigns/search', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const rows = await c.env.DB.prepare('SELECT * FROM campaigns WHERE project_id = ? AND archived = 0 ORDER BY created_at DESC')
    .bind(project.id).all<any>();
  return c.json({ campaigns: rows.results || [], meta: { page: 1, per_page: 100, total_pages: 1, total_entries: rows.results?.length || 0 } });
});

mcp.delete('/campaigns/:campaignId', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const project = await projectForMcp(c, userId, c.req.query('project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const campaign = await c.env.DB.prepare('UPDATE campaigns SET archived = 1, updated_at = datetime("now") WHERE id = ? AND project_id = ? RETURNING *')
    .bind(c.req.param('campaignId'), project.id).first<any>();
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404);
  return c.json({ campaign });
});

mcp.put('/redirects', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const project = await projectForMcp(c, userId, paramValue(c, body, 'project_id'));
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, Number(project.id));
  await c.env.DB.prepare('UPDATE redirect_configs SET default_fallback = COALESCE(?, default_fallback), show_preview_ios = COALESCE(?, show_preview_ios), show_preview_android = COALESCE(?, show_preview_android), updated_at = datetime("now") WHERE id = ?')
    .bind(
      body.default_fallback || null,
      body.show_preview_ios === undefined ? null : (toBool(body.show_preview_ios) ? 1 : 0),
      body.show_preview_android === undefined ? null : (toBool(body.show_preview_android) ? 1 : 0),
      redirectConfigId,
    ).run();

  const platforms = parseJsonObject(body.platforms) || {};
  const unsupported = Object.keys(platforms).find((platform) => !supportedMcpPlatform(platform));
  if (unsupported) return c.json({ error: `Unsupported platform: ${unsupported}. Supported: ios, android, desktop` }, 400);

  for (const [platform, rawConfig] of Object.entries(platforms)) {
    const config = parseJsonObject(rawConfig) || {};
    const variation = String(config.variation || (platform === 'desktop' ? 'all' : 'phone'));
    await c.env.DB.prepare(`
      INSERT INTO redirects (redirect_config_id, platform, variation, enabled, appstore, fallback_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(redirect_config_id, platform, variation) DO UPDATE SET
        enabled = excluded.enabled,
        appstore = excluded.appstore,
        fallback_url = excluded.fallback_url,
        updated_at = datetime('now')
    `).bind(
      redirectConfigId,
      platform,
      variation,
      config.enabled === undefined ? 1 : (toBool(config.enabled) ? 1 : 0),
      toBool(config.appstore) ? 1 : 0,
      config.fallback_url || config.url || null,
    ).run();
  }

  return c.json({ redirect_config: await redirectConfigResponse(c.env.DB, redirectConfigId) });
});

mcp.put('/sdk', async (c) => {
  const userId = await getMcpUserId(c);
  if (!userId) return c.json({ error: 'invalid_token' }, 401);
  const body = await readBody(c);
  const instance = await instanceForMcp(c, userId, paramValue(c, body, 'instance_id'));
  if (!instance) return c.json({ error: 'Instance not found' }, 404);
  const platforms = parseJsonObject(body.platforms) || {};
  const unsupported = Object.keys(platforms).find((platform) => !supportedMcpPlatform(platform));
  if (unsupported) return c.json({ error: `Unsupported platform: ${unsupported}. Supported: ios, android, desktop` }, 400);
  if (Object.keys(platforms).length === 0) return c.json({ error: 'platforms is required' }, 400);

  const configured: Record<string, any> = {};
  for (const [platform, rawConfig] of Object.entries(platforms)) {
    configured[platform] = await setupPlatformConfiguration(
      c.env.DB,
      Number(instance.id),
      platform,
      parseJsonObject(rawConfig) || {},
    );
  }
  return c.json({ configurations: configured });
});

export default mcp;
