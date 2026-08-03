import { Hono } from 'hono';
import { Env } from '../types';
import { sdkMiddleware } from '../middleware/auth';
import { getOrCreateRedirectConfig, getOrCreateProject, parseJsonObject } from '../lib/db';
import { generateShortCode } from '../lib/crypto';
import purchasesRoutes from './purchases-sdk';
import { AppVariables } from '../types';

const sdk = new Hono<{ Bindings: Env; Variables: AppVariables }>();
sdk.use('*', sdkMiddleware);
sdk.route('/purchases/v1', purchasesRoutes);
sdk.onError((error, c) => {
  if (error?.message === 'Invalid project for SDK credentials') {
    return c.json({ error: error.message }, 403);
  }
  console.error('sdk_route_failed', error);
  return c.json({ error: 'Internal server error' }, 500);
});

async function readBody(c: any): Promise<Record<string, any>> {
  const type = c.req.header('content-type') || '';
  if (type.includes('application/json')) return await c.req.json().catch(() => ({}));
  return await c.req.parseBody().catch(() => ({}));
}

function requestCountry(c: any): string | null {
  const requestWithCf = c.req.raw as Request & { cf?: { country?: string } };
  const value = String(requestWithCf.cf?.country || c.req.header('CF-IPCountry') || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function platformMatches(platforms: string[], platform: string | null | undefined) {
  if (platforms.length === 0) return true;
  if (!platform) return false;
  return platforms.includes(platform) || (platform === 'web' && platforms.includes('desktop'));
}

function messageAccessUrl(c: any, notificationId: unknown) {
  return `${new URL(c.req.url).origin}/mm/${notificationId}`;
}

function notificationMessageRow(c: any, row: any) {
  return {
    id: String(row.message_id),
    read: row.read === 1,
    access_url: messageAccessUrl(c, row.notification_id),
    updated_at: row.notification_updated_at || row.updated_at,
    title: row.title || '',
    subtitle: row.subtitle || '',
    auto_display: row.auto_display === 1,
  };
}

async function addNotificationsForNewVisitor(db: D1Database, projectId: number, visitorId: string | number, deviceId: number) {
  const device = await db.prepare('SELECT platform, push_token FROM devices WHERE id = ?').bind(deviceId).first<{ platform: string | null; push_token: string | null }>();
  const rows = await db.prepare(`
    SELECT n.id, n.title, n.subtitle, n.send_push, nt.platforms
    FROM notifications n
    JOIN notification_targets nt ON nt.notification_id = n.id
    WHERE n.project_id = ?
      AND COALESCE(n.archived, 0) = 0
      AND COALESCE(nt.new_users, 0) = 1
  `).bind(projectId).all<any>();
  for (const notification of rows.results || []) {
    if (!platformMatches(parseJsonArray(notification.platforms), device?.platform)) continue;
    await db.prepare(`
      INSERT INTO notification_messages (notification_id, visitor_id, device_id, read)
      SELECT ?, ?, ?, 0
      WHERE NOT EXISTS (
        SELECT 1 FROM notification_messages
        WHERE notification_id = ? AND visitor_id = ?
      )
    `).bind(notification.id, String(visitorId), deviceId, notification.id, String(visitorId)).run();
    if (notification.send_push === 1 && device?.push_token && (device.platform === 'ios' || device.platform === 'android')) {
      await enqueuePushNotification(db, projectId, notification, device.platform, device.push_token);
    }
  }
}

async function enqueuePushNotification(db: D1Database, projectId: number, notification: any, platform: string, pushToken: string) {
  const appId = await rpushAppForProjectPlatform(db, projectId, platform);
  if (!appId) return;
  const data = JSON.stringify({ linksquared: 'true', notification_id: String(notification.id) });
  await db.prepare(`
    INSERT INTO rpush_notifications (
      app_id, device_token, alert, alert_is_json, notification, data, type,
      delivered, failed, processing, created_at, updated_at
    )
    SELECT ?, ?, ?, 1, ?, ?, ?, 0, 0, 0, datetime('now'), datetime('now')
    WHERE NOT EXISTS (
      SELECT 1 FROM rpush_notifications
      WHERE app_id = ? AND device_token = ? AND data = ?
    )
  `).bind(
    appId,
    pushToken,
    JSON.stringify({ title: notification.title || '', subtitle: notification.subtitle || '' }),
    platform === 'android' ? JSON.stringify({ title: notification.title || '', body: notification.subtitle || '' }) : null,
    data,
    platform === 'ios' ? 'Rpush::Apnsp8::Notification' : 'Rpush::Fcm::Notification',
    appId,
    pushToken,
    data,
  ).run();
}

async function rpushAppForProjectPlatform(db: D1Database, projectId: number | string, platform: string) {
  if (platform === 'ios') {
    const row = await db.prepare(`
      SELECT ra.id
      FROM projects p
      JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'ios'
      JOIN ios_configurations ic ON ic.application_id = a.id
      JOIN ios_push_configurations ipc ON ipc.ios_configuration_id = ic.id OR ipc.application_id = a.id
      JOIN rpush_apps ra ON ra.name = ipc.name || CASE WHEN COALESCE(p.test, 0) = 1 THEN '-development' ELSE '-production' END
      WHERE p.id = ?
      LIMIT 1
    `).bind(String(projectId)).first<{ id: string }>();
    return row?.id || null;
  }
  if (platform === 'android') {
    const row = await db.prepare(`
      SELECT ra.id
      FROM projects p
      JOIN applications a ON a.instance_id = p.instance_id AND a.platform = 'android'
      JOIN android_configurations ac ON ac.application_id = a.id
      JOIN android_push_configurations apc ON apc.android_configuration_id = ac.id OR apc.application_id = a.id
      JOIN rpush_apps ra ON ra.name = apc.name
      WHERE p.id = ?
      LIMIT 1
    `).bind(String(projectId)).first<{ id: string }>();
    return row?.id || null;
  }
  return null;
}

async function ensureVisitor(db: D1Database, projectId: number, deviceId: number, sdkIdentifier?: string | null, attributes?: Record<string, unknown>) {
  const existing = await db.prepare(
    'SELECT id FROM visitors WHERE project_id = ? AND device_id = ? LIMIT 1'
  ).bind(String(projectId), deviceId).first<{ id: string | number }>();
  const serializedAttributes = attributes ? JSON.stringify(attributes) : null;
  if (existing) {
    await db.prepare(`
      UPDATE visitors
      SET sdk_identifier = COALESCE(?, sdk_identifier),
          sdk_attributes = COALESCE(?, sdk_attributes),
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(sdkIdentifier || null, serializedAttributes, existing.id).run();
    return { id: existing.id, created: false };
  }
  const created = await db.prepare(`
    INSERT INTO visitors (project_id, device_id, sdk_identifier, uuid, sdk_attributes)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).bind(String(projectId), deviceId, sdkIdentifier || null, crypto.randomUUID(), serializedAttributes || '{}').first<{ id: string | number }>();
  if (created?.id) {
    await addNotificationsForNewVisitor(db, projectId, created.id, deviceId);
  }
  return { id: created?.id ?? null, created: true };
}

async function visitorForDevice(db: D1Database, projectId: number, deviceId: number) {
  return db.prepare(
    'SELECT id FROM visitors WHERE project_id = ? AND device_id = ? LIMIT 1'
  ).bind(String(projectId), deviceId).first<{ id: string }>();
}

async function currentSdkProject(c: any, body: Record<string, any> = {}) {
  const projectId = c.get('projectId') || body.project_id || c.req.query('project_id');
  const instanceId = c.get('instanceId');
  if (projectId) {
    const project = instanceId
      ? await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND instance_id = ? LIMIT 1').bind(projectId, instanceId).first()
      : await c.env.DB.prepare('SELECT * FROM projects WHERE id = ? LIMIT 1').bind(projectId).first();
    if (project) return project;
    throw new Error('Invalid project for SDK credentials');
  }
  return getOrCreateProject(c.env.DB, c.get('instanceId'), 'production');
}

async function sdkVisitor(c: any, projectId?: number | string) {
  const linksquared = c.req.header('LINKSQUARED') || c.req.header('linksquared') || c.req.query('linksquared');
  if (!linksquared) return null;
  const scopedProjectId = projectId || c.get('projectId');
  const projectClause = scopedProjectId ? 'AND v.project_id = ?' : '';
  const values = scopedProjectId ? [linksquared, linksquared, String(scopedProjectId)] : [linksquared, linksquared];
  return c.env.DB.prepare(`
    SELECT v.*, d.platform, d.push_token
    FROM visitors v
    JOIN devices d ON d.id = v.device_id
    WHERE (v.id = ? OR v.uuid = ?)
    ${projectClause}
    LIMIT 1
  `).bind(...values).first();
}

function sdkVisitorJson(row: any) {
  return {
    id: String(row.id),
    uuid: row.uuid || String(row.id),
    sdk_identifier: row.sdk_identifier || '',
    sdk_attributes: parseJsonObject(row.sdk_attributes) || {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function domainForProject(db: D1Database, projectId: number, fallbackDomain: string) {
  const existing = await db.prepare('SELECT id FROM domains WHERE project_id = ? ORDER BY id ASC LIMIT 1')
    .bind(projectId).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db.prepare('INSERT INTO domains (domain, project_id) VALUES (?, ?) RETURNING id')
    .bind(fallbackDomain, projectId).first<{ id: number }>();
  if (!created) throw new Error('Unable to create domain');
  return created.id;
}

function linkPayload(row: any) {
  return {
    id: String(row.id),
    name: row.name || row.title || row.path,
    title: row.title || row.name || row.path,
    subtitle: row.subtitle || null,
    image_url: row.image_url || null,
    path: row.path,
    access_path: `/${row.path}`,
    active: row.active === 1,
    data: parseJsonObject(row.data) || {},
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : [],
    tracking_source: row.tracking_source || null,
    tracking_medium: row.tracking_medium || null,
    tracking_campaign: row.tracking_campaign || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findProjectLink(db: D1Database, projectId: number, path: string) {
  return db.prepare(`
    SELECT l.*
    FROM links l
    LEFT JOIN domains d ON d.id = l.domain_id
    LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE l.path = ? AND (d.project_id = ? OR rc.project_id = ?)
    LIMIT 1
  `).bind(path, projectId, projectId).first<any>();
}

async function linkMetrics(db: D1Database, projectId: number, linkId?: number) {
  const linkClause = linkId ? 'AND e.link_id = ?' : '';
  const values = linkId ? [projectId, linkId] : [projectId];
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred
    FROM events e
    WHERE e.project_id = ? ${linkClause}
  `).bind(...values).first<any>();
}

function metricsPayload(row: any) {
  return {
    views: Number(row?.views || 0),
    opens: Number(row?.opens || 0),
    installs: Number(row?.installs || 0),
    reinstalls: Number(row?.reinstalls || 0),
    app_opens: Number(row?.app_opens || 0),
    user_referred: Number(row?.user_referred || 0),
  };
}

async function notificationMessages(db: D1Database, visitorId: string, options: { unreadOnly?: boolean; autoDisplayOnly?: boolean; page?: number } = {}) {
  const unreadClause = options.unreadOnly ? ' AND COALESCE(nm.read, 0) = 0' : '';
  const autoDisplayClause = options.autoDisplayOnly ? ' AND COALESCE(n.auto_display, 0) = 1' : '';
  const page = Math.max(1, Number(options.page || 1));
  return db.prepare(`
    SELECT nm.id AS message_id,
      nm.notification_id,
      nm.read,
      nm.updated_at,
      n.title,
      n.subtitle,
      n.auto_display,
      n.updated_at AS notification_updated_at
    FROM notification_messages nm
    JOIN notifications n ON n.id = nm.notification_id
    WHERE nm.visitor_id = ?
      AND COALESCE(n.archived, 0) = 0
      ${unreadClause}
      ${autoDisplayClause}
    ORDER BY nm.updated_at DESC
    LIMIT 25 OFFSET ?
  `).bind(String(visitorId), (page - 1) * 25).all<any>();
}

// Upstream SDK auth endpoint. Uses PROJECT-KEY + PLATFORM + IDENTIFIER headers.
sdk.post('/authenticate', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '0.0.0.0';
  const countryCode = requestCountry(c);
  const userAgent = String(body.user_agent || c.req.header('User-Agent') || '');
  if (!userAgent || !body.app_version) return c.json({ error: 'user_agent and app_version required' }, 422);

  const existing = body.vendor_id
    ? await c.env.DB.prepare('SELECT id FROM devices WHERE vendor = ? ORDER BY updated_at DESC LIMIT 1').bind(body.vendor_id).first<{ id: number }>()
    : null;
  let deviceId = existing?.id;
  if (deviceId) {
    await c.env.DB.prepare(`
      UPDATE devices
      SET ip = ?, remote_ip = ?, user_agent = ?, model = COALESCE(?, model), build = COALESCE(?, build),
          app_version = ?, platform = COALESCE(?, platform), language = COALESCE(?, language),
          timezone = COALESCE(?, timezone), country_code = COALESCE(?, country_code), updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      ip, ip, userAgent, body.model || null, body.build || null, body.app_version,
      c.req.header('PLATFORM') || c.req.header('platform') || body.platform || null,
      body.language || null, body.timezone || null, countryCode, deviceId,
    ).run();
  } else {
    const created = await c.env.DB.prepare(`
      INSERT INTO devices (ip, remote_ip, user_agent, platform, model, vendor, language, timezone, screen_width, screen_height, app_version, build, webgl_vendor, webgl_renderer, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      ip, ip, userAgent,
      c.req.header('PLATFORM') || c.req.header('platform') || body.platform || null,
      body.model || null, body.vendor_id || body.vendor || null,
      body.language || null, body.timezone || null,
      body.screen_width || null, body.screen_height || null,
      body.app_version, body.build || null, body.webgl_vendor || null, body.webgl_renderer || null, countryCode,
    ).first<{ id: number }>();
    deviceId = created?.id;
  }
  if (!deviceId) return c.json({ error: 'Unable to authenticate device' }, 500);
  const visitor = await ensureVisitor(c.env.DB, Number(project.id), deviceId, body.sdk_identifier || null, body.sdk_attributes);
  const row = await c.env.DB.prepare(`
    SELECT v.*, d.push_token
    FROM visitors v
    JOIN devices d ON d.id = v.device_id
    WHERE v.id = ?
  `).bind(visitor.id).first<any>();
  const instance = await c.env.DB.prepare('SELECT uri_scheme FROM instances WHERE id = ? LIMIT 1')
    .bind(project.instance_id).first<{ uri_scheme: string }>();
  return c.json({
    linksquared: String(visitor.id),
    uri_scheme: instance?.uri_scheme || '',
    sdk_identifier: row?.sdk_identifier || null,
    sdk_attributes: parseJsonObject(row?.sdk_attributes) || {},
    push_token: row?.push_token || null,
  });
});

sdk.get('/device_for_vendor_id', async (c) => {
  const body = { vendor_id: c.req.query('vendor_id') };
  const project = await currentSdkProject(c, body);
  const device = await c.env.DB.prepare('SELECT id FROM devices WHERE vendor = ? LIMIT 1')
    .bind(body.vendor_id || '').first<{ id: number }>();
  if (!device) return c.json({ last_seen: null });
  const event = await c.env.DB.prepare(`
    SELECT created_at FROM events
    WHERE project_id = ? AND device_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 1
  `).bind(project.id, device.id).first<{ created_at: string }>();
  return c.json({ last_seen: event?.created_at || null });
});

// POST /api/v1/sdk/register — enregistrer un device
sdk.post('/register', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '0.0.0.0';
  const countryCode = requestCountry(c);
  const userAgent = c.req.header('User-Agent') || '';
  const body = await c.req.json<{
    platform?: string;
    model?: string;
    vendor?: string;
    language?: string;
    timezone?: string;
    screen_width?: number;
    screen_height?: number;
    app_version?: string;
    build?: string;
    push_token?: string;
    webgl_vendor?: string;
    webgl_renderer?: string;
    project_id?: number;
    sdk_identifier?: string;
    sdk_attributes?: Record<string, unknown>;
  }>();

  // Upsert device by IP + UA fingerprint
  const existing = await c.env.DB.prepare(
    "SELECT id FROM devices WHERE ip = ? AND user_agent = ? ORDER BY updated_at DESC LIMIT 1"
  ).bind(ip, userAgent).first<{ id: number }>();

  let deviceId: number;

  if (existing) {
    await c.env.DB.prepare(
      "UPDATE devices SET updated_at = datetime('now'), push_token = ?, app_version = ?, build = ?, country_code = COALESCE(?, country_code) WHERE id = ?"
    ).bind(body.push_token || null, body.app_version || null, body.build || null, countryCode, existing.id).run();
    deviceId = existing.id;
  } else {
    const result = await c.env.DB.prepare(`
      INSERT INTO devices (ip, remote_ip, user_agent, platform, model, vendor, language, timezone, screen_width, screen_height, app_version, build, push_token, webgl_vendor, webgl_renderer, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).bind(
      ip, ip, userAgent,
      body.platform || null, body.model || null, body.vendor || null,
      body.language || null, body.timezone || null,
      body.screen_width || null, body.screen_height || null,
      body.app_version || null, body.build || null,
      body.push_token || null, body.webgl_vendor || null, body.webgl_renderer || null, countryCode
    ).first<{ id: number }>();
    deviceId = result!.id;
  }

  const project = await currentSdkProject(c, body);
  const visitor = await ensureVisitor(c.env.DB, Number(project.id), deviceId, body.sdk_identifier || null, body.sdk_attributes);

  return c.json({ device_id: deviceId, visitor_id: visitor.id, install_id: `dev_${deviceId}` });
});

// POST /api/v1/sdk/attribution — deferred deep link matching
sdk.post('/attribution', async (c) => {
  const body = await c.req.json<{
    device_id: number;
    project_id: number;
    install_id?: string;
  }>();
  const project = await currentSdkProject(c, body);
  if (Number(body.project_id) !== Number(project.id)) {
    return c.json({ error: 'Invalid project for SDK credentials' }, 403);
  }

  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '0.0.0.0';
  const countryCode = requestCountry(c);
  if (countryCode) {
    await c.env.DB.prepare("UPDATE devices SET country_code = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(countryCode, body.device_id).run();
  }

  // Look for a pending action (click → install match) via IP fingerprinting
  // Find clicks from same IP within attribution window (7 days)
  const action = await c.env.DB.prepare(`
    SELECT a.id, a.link_id, l.path, l.data, l.title, l.tracking_source, l.tracking_medium, l.tracking_campaign
    FROM actions a
    JOIN links l ON l.id = a.link_id
    JOIN devices d ON d.id = a.device_id
    WHERE d.ip = ? AND a.handled = 0
    AND a.created_at > datetime('now', '-7 days')
    ORDER BY a.created_at DESC LIMIT 1
  `).bind(ip).first<{
    id: number; link_id: number; path: string; data: string | null;
    title: string | null; tracking_source: string | null;
    tracking_medium: string | null; tracking_campaign: string | null;
  }>();

  if (!action) {
    // Register install as organic
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO installed_apps (device_id, project_id) VALUES (?, ?)'
    ).bind(body.device_id, project.id).run();
    await ensureVisitor(c.env.DB, Number(project.id), body.device_id);

    // Track install event
    await c.env.DB.prepare(
      "INSERT INTO events (device_id, project_id, event, platform) VALUES (?, ?, 'install', 'organic')"
    ).bind(body.device_id, project.id).run();

    return c.json({ attributed: false, install_type: 'organic' });
  }

  // Mark action as handled
  await c.env.DB.prepare("UPDATE actions SET handled = 1, updated_at = datetime('now') WHERE id = ?").bind(action.id).run();

  // Register install
  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO installed_apps (device_id, project_id) VALUES (?, ?)'
  ).bind(body.device_id, project.id).run();
  await ensureVisitor(c.env.DB, Number(project.id), body.device_id);

  // Track attributed install event
  await c.env.DB.prepare(`
    INSERT INTO events (device_id, project_id, link_id, event, platform)
    VALUES (?, ?, ?, 'install', 'attributed')
  `).bind(body.device_id, project.id, action.link_id).run();

  return c.json({
    attributed: true,
    install_type: 'attributed',
    link: {
      id: action.link_id,
      path: action.path,
      short_code: action.path,
      data: action.data ? JSON.parse(action.data) : null,
      title: action.title,
      utm_parameters: {
        source: action.tracking_source,
        medium: action.tracking_medium,
        campaign: action.tracking_campaign,
      }
    }
  });
});

// POST /api/v1/sdk/events — tracker des events in-app
sdk.post('/events', async (c) => {
  const body = await c.req.json<{
    device_id: number;
    project_id: number;
    event: string;
    platform?: string;
    data?: Record<string, unknown>;
    app_version?: string;
    link_id?: number;
    sdk_identifier?: string;
    sdk_attributes?: Record<string, unknown>;
  }>();

  const project = await currentSdkProject(c, body);
  if (Number(body.project_id) !== Number(project.id)) {
    return c.json({ error: 'Invalid project for SDK credentials' }, 403);
  }

  await ensureVisitor(c.env.DB, Number(project.id), body.device_id, body.sdk_identifier || null, body.sdk_attributes);

  await c.env.DB.prepare(`
    INSERT INTO events (device_id, project_id, link_id, event, platform, data, app_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.device_id, project.id,
    body.link_id || null, body.event,
    body.platform || null,
    body.data ? JSON.stringify(body.data) : null,
    body.app_version || null
  ).run();

  return c.json({ success: true });
});

// Upstream SDK event alias: authenticated by PROJECT-KEY headers and LINKSQUARED.
sdk.post('/event', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  let linkId = null;
  if (body.path) {
    const link = await findProjectLink(c.env.DB, Number(project.id), String(body.path));
    linkId = link?.id || null;
  }
  if (body.link && !linkId) {
    const urlPath = String(body.link).split('/').filter(Boolean).pop() || '';
    const link = await findProjectLink(c.env.DB, Number(project.id), urlPath);
    linkId = link?.id || null;
  }
  await c.env.DB.prepare(`
    INSERT INTO events (device_id, project_id, link_id, event, platform, engagement_time, created_at)
    VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).bind(
    visitor.device_id,
    project.id,
    linkId,
    body.event || 'app_open',
    c.req.header('PLATFORM') || c.req.header('platform') || visitor.platform || null,
    body.engagement_time || null,
    body.created_at || null,
  ).run();
  return c.json({ message: 'Event added' });
});

sdk.post('/data_for_device', async (c) => {
  const project = await currentSdkProject(c, await readBody(c));
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  const action = await c.env.DB.prepare(`
    SELECT a.id AS action_id, a.link_id, l.*
    FROM actions a
    JOIN links l ON l.id = a.link_id
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    JOIN devices d ON d.id = a.device_id
    WHERE d.ip = (SELECT ip FROM devices WHERE id = ?)
      AND rc.project_id = ?
      AND a.handled = 0
    ORDER BY datetime(a.created_at) DESC
    LIMIT 1
  `).bind(visitor.device_id, project.id).first<any>();
  if (!action) return c.json({ data: null, link: null, tracking: null });
  await c.env.DB.prepare("UPDATE actions SET handled = 1, updated_at = datetime('now') WHERE id = ?")
    .bind(action.action_id).run();
  return c.json({
    data: parseJsonObject(action.data) || null,
    link: linkPayload(action),
    tracking: {
      source: action.tracking_source || null,
      medium: action.tracking_medium || null,
      campaign: action.tracking_campaign || null,
    },
    project_id: Number(project.id),
  });
});

sdk.post('/data_for_device_and_url', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  const path = String(body.url || '').split('/').filter(Boolean).pop() || '';
  const link = path ? await findProjectLink(c.env.DB, Number(project.id), path) : null;
  return c.json({ data: link ? parseJsonObject(link.data) || null : null, link: link ? linkPayload(link) : null });
});

sdk.post('/data_for_device_and_path', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  const link = body.path ? await findProjectLink(c.env.DB, Number(project.id), String(body.path)) : null;
  return c.json({ data: link ? parseJsonObject(link.data) || null : null, link: link ? linkPayload(link) : null });
});

sdk.post('/link_details', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  const link = body.path ? await findProjectLink(c.env.DB, Number(project.id), String(body.path)) : null;
  if (!link) return c.json(null);
  return c.json(linkPayload(link));
});

sdk.post('/create_link', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, Number(project.id));
  const domainId = await domainForProject(c.env.DB, Number(project.id), c.env.SHORTLINK_DOMAIN);
  let path = String(body.path || generateShortCode()).trim().replace(/^\/+/, '');
  while (await c.env.DB.prepare('SELECT id FROM links WHERE path = ? LIMIT 1').bind(path).first()) {
    path = generateShortCode();
  }
  const link = await c.env.DB.prepare(`
    INSERT INTO links (
      path, title, subtitle, image_url, data, tags, redirect_config_id, domain_id, visitor_id,
      tracking_source, tracking_medium, tracking_campaign, generated_from_platform, sdk_generated,
      show_preview_ios, show_preview_android, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
    RETURNING *
  `).bind(
    path,
    body.title || null,
    body.subtitle || null,
    body.image_url || null,
    JSON.stringify(parseJsonObject(body.data) || {}),
    JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
    redirectConfigId,
    domainId,
    visitor.id,
    body.tracking_source || null,
    body.tracking_medium || null,
    body.tracking_campaign || null,
    c.req.header('PLATFORM') || c.req.header('platform') || 'sdk',
    body.show_preview_ios ? 1 : 0,
    body.show_preview_android ? 1 : 0,
  ).first<any>();
  return c.json({ link: `/${link.path}` });
});

sdk.get('/visitor_attributes', async (c) => {
  const project = await currentSdkProject(c);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  return c.json({ visitor: sdkVisitorJson(visitor) });
});

sdk.post('/visitor_attributes', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  await c.env.DB.prepare(`
    UPDATE visitors
    SET sdk_identifier = COALESCE(?, sdk_identifier),
        sdk_attributes = COALESCE(?, sdk_attributes),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    body.sdk_identifier || null,
    body.sdk_attributes ? JSON.stringify(body.sdk_attributes) : null,
    visitor.id,
  ).run();
  if (body.push_token) {
    await c.env.DB.prepare('UPDATE devices SET push_token = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(body.push_token, visitor.device_id).run();
  }
  const row = await c.env.DB.prepare('SELECT * FROM visitors WHERE id = ?').bind(visitor.id).first<any>();
  return c.json({ visitor: sdkVisitorJson(row) });
});

sdk.post('/add_payment_event', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const visitor = await sdkVisitor(c, Number(project.id));
  if (!visitor) return c.json({ error: 'Invalid linksquared id' }, 403);
  await c.env.DB.prepare(`
    INSERT INTO purchase_events (
      project_id, device_id, visitor_id, product_id, event_type, price_cents,
      usd_price_cents, currency, quantity, store, store_source, webhook_validated, date, occurred_at, raw_payload
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')), ?)
  `).bind(
    project.id,
    visitor.device_id,
    visitor.id,
    body.product_id || null,
    body.event_type || body.event || 'buy',
    body.price_cents || body.amount_cents || 0,
    body.usd_price_cents || body.price_cents || body.amount_cents || 0,
    body.currency || 'USD',
    body.quantity || 1,
    1,
    c.req.header('PLATFORM') || c.req.header('platform') || null,
    body.date || body.created_at || null,
    body.date || body.created_at || null,
    JSON.stringify(body),
  ).run();
  return c.json({ message: 'Payment event recorded provisionally', verified: false });
});

sdk.post('/generate_link', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, Number(project.id));
  const domainId = await domainForProject(c.env.DB, Number(project.id), c.env.SHORTLINK_DOMAIN);
  let path = String(body.path || generateShortCode()).trim().replace(/^\/+/, '');
  while (await c.env.DB.prepare('SELECT id FROM links WHERE path = ? LIMIT 1').bind(path).first()) path = generateShortCode();
  const link = await c.env.DB.prepare(`
    INSERT INTO links (
      path, title, subtitle, image_url, data, tags, redirect_config_id, domain_id,
      tracking_source, tracking_medium, tracking_campaign, generated_from_platform, sdk_generated,
      show_preview_ios, show_preview_android, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'API', 1, ?, ?, 1)
    RETURNING *
  `).bind(
    path,
    body.title || null,
    body.subtitle || null,
    body.image_url || null,
    JSON.stringify(parseJsonObject(body.data) || {}),
    JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
    redirectConfigId,
    domainId,
    body.tracking_source || null,
    body.tracking_medium || null,
    body.tracking_campaign || null,
    body.show_preview_ios ? 1 : 0,
    body.show_preview_android ? 1 : 0,
  ).first<any>();
  return c.json({ link: `/${link.path}` });
});

sdk.get('/link/:path', async (c) => {
  const project = await currentSdkProject(c);
  const link = await findProjectLink(c.env.DB, Number(project.id), c.req.param('path'));
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ link: linkPayload(link) });
});

sdk.get('/metrics_for_link/:path', async (c) => {
  const project = await currentSdkProject(c);
  const link = await findProjectLink(c.env.DB, Number(project.id), c.req.param('path'));
  if (!link) return c.json({ error: 'Link not found' }, 404);
  return c.json({ metrics: metricsPayload(await linkMetrics(c.env.DB, Number(project.id), Number(link.id))) });
});

sdk.get('/metrics_for_project', async (c) => {
  const project = await currentSdkProject(c);
  return c.json(metricsPayload(await linkMetrics(c.env.DB, Number(project.id))));
});

async function notificationsForRequest(c: any, body: Record<string, any>, unreadOnly = false, autoDisplayOnly = false) {
  const project = await currentSdkProject(c, body);
  const deviceId = Number(body.device_id || c.req.query('device_id') || 0);
  const projectId = Number(body.project_id || c.req.query('project_id') || project.id || 0);
  if (!deviceId || !projectId) return c.json({ error: 'device_id and project_id required' }, 422);
  if (projectId !== Number(project.id)) return c.json({ error: 'Invalid project for SDK credentials' }, 403);
  const visitor = await visitorForDevice(c.env.DB, projectId, deviceId);
  if (!visitor) {
    const notifications: unknown[] = [];
    return c.json({ notifications });
  }
  const rows = await notificationMessages(c.env.DB, String(visitor.id), {
    unreadOnly,
    autoDisplayOnly,
    page: Number(body.page || c.req.query('page') || 1),
  });
  return c.json({ notifications: (rows.results || []).map((row: any) => notificationMessageRow(c, row)) });
}

sdk.post('/notifications_for_device', async (c) => notificationsForRequest(c, await readBody(c)));

sdk.get('/number_of_unread_notifications', async (c) => {
  const project = await currentSdkProject(c);
  const deviceId = Number(c.req.query('device_id') || 0);
  const projectId = Number(c.req.query('project_id') || project.id || 0);
  if (!deviceId || !projectId) return c.json({ error: 'device_id and project_id required' }, 422);
  if (projectId !== Number(project.id)) return c.json({ error: 'Invalid project for SDK credentials' }, 403);
  const visitor = await visitorForDevice(c.env.DB, projectId, deviceId);
  if (!visitor) return c.json({ number_of_unread_notifications: 0 });
  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM notification_messages nm
    JOIN notifications n ON n.id = nm.notification_id
    WHERE nm.visitor_id = ? AND COALESCE(nm.read, 0) = 0 AND COALESCE(n.archived, 0) = 0
  `).bind(String(visitor.id)).first<{ total: number }>();
  return c.json({ number_of_unread_notifications: Number(row?.total || 0) });
});

sdk.post('/mark_notification_as_read', async (c) => {
  const body = await readBody(c);
  const project = await currentSdkProject(c, body);
  const deviceId = Number(body.device_id || c.req.query('device_id') || 0);
  const projectId = Number(body.project_id || c.req.query('project_id') || project.id || 0);
  const id = body.id || body.notification_id || c.req.query('id');
  if (!deviceId || !projectId || !id) return c.json({ error: 'device_id, project_id and id required' }, 422);
  if (projectId !== Number(project.id)) return c.json({ error: 'Invalid project for SDK credentials' }, 403);
  const visitor = await visitorForDevice(c.env.DB, projectId, deviceId);
  if (!visitor) return c.json({ error: 'Notification not found' }, 404);
  const row = await c.env.DB.prepare(`
    UPDATE notification_messages
    SET read = 1, updated_at = datetime('now')
    WHERE id = ? AND visitor_id = ?
    RETURNING id
  `).bind(id, String(visitor.id)).first<{ id: number }>();
  if (!row) return c.json({ error: 'Notification not found' }, 404);
  return c.json({ message: 'Marked as read' });
});

sdk.get('/notifications_to_display_automatically', async (c) => {
  return notificationsForRequest(c, {}, true, true);
});

// Backward-compatible Cloudflare path used by the current JS SDK adapter.
sdk.get('/notifications', async (c) => {
  return notificationsForRequest(c, {}, true);
});

export default sdk;
