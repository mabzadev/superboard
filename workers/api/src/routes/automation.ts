import { Hono, type Context } from 'hono';
import { Env } from '../types';
import { runMaintenance } from '../lib/maintenance';
import { parseJsonObject } from '../lib/db';
import { timingSafeEqual } from '../lib/secrets';
import { readJsonObjectLimited, readRequestObjectLimited } from '@opengrow/contracts/request-body';

const automation = new Hono<{ Bindings: Env }>();

type AutomationContext = Context<{ Bindings: Env }>;

async function requireAdminKey(c: AutomationContext): Promise<Response | null> {
  const expected = c.env.ADMIN_API_KEY;
  const provided = c.req.header('X-AUTH') || c.req.header('x-auth');
  if (!expected || !provided || !await timingSafeEqual(provided, expected)) {
    return c.json({ error: 'Invalid credentials' }, 403);
  }
  return null;
}

async function requireMaintenanceKey(c: AutomationContext): Promise<Response | null> {
  const expected = c.env.MAINTENANCE_PROCESS_KEY;
  if (!expected) return c.json({ error: 'Maintenance key is not configured' }, 503);
  const provided = c.req.header('x-maintenance-key');
  if (!provided || !await timingSafeEqual(provided, expected)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return null;
}

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 1024 * 1024);
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

async function projectForInstance(db: D1Database, instanceId: number, test: boolean) {
  return db.prepare('SELECT * FROM projects WHERE instance_id = ? AND is_test = ? ORDER BY id ASC LIMIT 1')
    .bind(instanceId, test ? 1 : 0).first<any>();
}

function visitorJson(row: any) {
  return {
    id: String(row.id),
    uuid: row.uuid || String(row.id),
    sdk_identifier: row.sdk_identifier || '',
    sdk_attributes: parseJsonObject(row.sdk_attributes) || {},
    platform: row.platform || '',
    inviter: row.inviter || null,
    invited: [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function metricJson(row: any) {
  return {
    total_views: Number(row?.views || 0),
    total_opens: Number(row?.opens || 0),
    total_app_opens: Number(row?.app_opens || 0),
    total_installs: Number(row?.installs || 0),
    total_reinstalls: Number(row?.reinstalls || 0),
    total_reactivations: Number(row?.reactivations || 0),
    total_user_referred: Number(row?.user_referred || 0),
    total_time_spent: Number(row?.time_spent || 0),
    total_revenue: Number(row?.revenue || 0),
  };
}

async function visitorMetrics(db: D1Database, visitor: any, projectId: number) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS revenue
    FROM visitors v
    LEFT JOIN events e ON e.device_id = v.device_id AND e.project_id = v.project_id
    LEFT JOIN purchase_events pe ON pe.device_id = v.device_id AND pe.project_id = v.project_id
    WHERE v.id = ? AND v.project_id = ?
  `).bind(visitor.id, projectId).first<any>();
}

async function referralMetrics(db: D1Database, visitor: any, projectId: number) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS revenue
    FROM links l
    LEFT JOIN events e ON e.link_id = l.id AND e.project_id = ?
    LEFT JOIN purchase_events pe ON pe.link_id = l.id AND pe.project_id = ?
    WHERE l.visitor_id = ?
  `).bind(projectId, projectId, visitor.id).first<any>();
}

function linkJson(row: any) {
  return {
    id: String(row.id),
    name: row.name || row.title || row.path,
    title: row.title || row.name || row.path,
    path: row.path,
    active: row.active === 1,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : [],
    data: parseJsonObject(row.data) || {},
    tracking_source: row.tracking_source,
    tracking_medium: row.tracking_medium,
    tracking_campaign: row.tracking_campaign,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function linkMetrics(db: D1Database, linkId: number, projectId: number) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS revenue
    FROM links l
    LEFT JOIN events e ON e.link_id = l.id AND e.project_id = ?
    LEFT JOIN purchase_events pe ON pe.link_id = l.id AND pe.project_id = ?
    WHERE l.id = ?
  `).bind(projectId, projectId, linkId).first<any>();
}

automation.post('/metrics_for_user', async (c) => {
  const denied = await requireAdminKey(c);
  if (denied) return denied;
  const body = await readBody(c);
  const instance = await c.env.DB.prepare('SELECT * FROM instances WHERE api_key = ? LIMIT 1')
    .bind(body.key).first<any>();
  if (!instance) return c.json({ error: 'Key is invalid' }, 404);
  const project = await projectForInstance(c.env.DB, Number(instance.id), toBool(body.test));
  if (!project) return c.json({ error: 'Project is invalid' }, 404);
  const device = await c.env.DB.prepare('SELECT * FROM devices WHERE vendor = ? LIMIT 1')
    .bind(body.vendor_id).first<any>();
  if (!device) return c.json({ error: 'Device is invalid' }, 404);
  const visitor = await c.env.DB.prepare(`
    SELECT v.*, d.platform
    FROM visitors v
    JOIN devices d ON d.id = v.device_id
    JOIN projects p ON p.id = v.project_id
    WHERE d.vendor = ? AND p.instance_id = ? AND p.is_test = ?
    LIMIT 1
  `).bind(body.vendor_id, instance.id, toBool(body.test) ? 1 : 0).first<any>();
  if (!visitor) return c.json({ error: 'Can not find visitor' }, 404);
  const visitorProjectId = Number(visitor.project_id || project.id);
  const numberOfLinks = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM links WHERE visitor_id = ? AND domain_id IN (SELECT id FROM domains WHERE project_id = ?)')
    .bind(visitor.id, visitorProjectId).first<{ total: number }>();
  return c.json({
    visitor: visitorJson(visitor),
    metrics: metricJson(await visitorMetrics(c.env.DB, visitor, visitorProjectId)),
    aggregated_metrics: metricJson(await referralMetrics(c.env.DB, visitor, visitorProjectId)),
    number_of_generated_links: Number(numberOfLinks?.total || 0),
  });
});

automation.post('/details_for_link', async (c) => {
  const denied = await requireAdminKey(c);
  if (denied) return denied;
  const body = await readBody(c);
  const instance = await c.env.DB.prepare('SELECT * FROM instances WHERE api_key = ? LIMIT 1')
    .bind(body.key).first<any>();
  if (!instance) return c.json({ error: 'Key is invalid' }, 404);
  const project = await projectForInstance(c.env.DB, Number(instance.id), toBool(body.test));
  if (!project) return c.json({ error: 'Project is invalid' }, 404);
  const link = await c.env.DB.prepare(`
    SELECT l.*
    FROM links l
    WHERE l.path = ? AND l.domain_id IN (SELECT id FROM domains WHERE project_id = ?)
    LIMIT 1
  `).bind(body.path, project.id).first<any>();
  if (!link) return c.json({ link: null, metrics: null });
  return c.json({ link: linkJson(link), metrics: metricJson(await linkMetrics(c.env.DB, Number(link.id), project.id)) });
});

automation.post('/run_maintenance', async (c) => {
  const denied = await requireMaintenanceKey(c);
  if (denied) return denied;
  const body = await readJsonObjectLimited(c.req.raw, 64 * 1024);
  const days = Math.max(1, Math.min(14, Number(body.days || 3)));
  return c.json(await runMaintenance(c.env, days));
});

export default automation;
