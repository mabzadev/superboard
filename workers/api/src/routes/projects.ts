import { Hono } from 'hono';
import { Env } from '../types';
import {
  getAuthUserId,
  getOrCreateRedirectConfig,
  jsonArray,
  parseJsonObject,
  resolveProject,
} from '../lib/db';
import { generateShortCode } from '../lib/crypto';
import { readCsvDownload, storeCsvDownload } from '../lib/files';
import { downloadFileMessage, sendMail } from '../lib/mail';

const projects = new Hono<{ Bindings: Env }>();

async function currentUserId(c: any): Promise<number | null> {
  return getAuthUserId(c.env, c.req.header('Authorization'));
}

async function readBody(c: any): Promise<Record<string, any>> {
  const type = c.req.header('content-type') || '';
  if (type.includes('application/json')) return await c.req.json().catch(() => ({}));
  return await c.req.parseBody().catch(() => ({}));
}

function field(body: Record<string, any>, ...names: string[]): any {
  for (const name of names) {
    if (body[name] !== undefined) return body[name];
    const bracket = name.includes('[') ? name : `link[${name}]`;
    if (body[bracket] !== undefined) return body[bracket];
  }
  return undefined;
}

function sanitizePath(input: string): string {
  const cleaned = input.trim().replace(/^\/+/, '').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  return cleaned || generateShortCode();
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

const EVENT_TO_COLUMN: Record<string, string> = {
  view: 'views',
  open: 'opens',
  install: 'installs',
  reinstall: 'reinstalls',
  time_spent: 'time_spent',
  reactivation: 'reactivations',
  app_open: 'app_opens',
  user_referred: 'user_referred',
};

type DateRange = { startDate: string; endDate: string; previousStartDate: string; previousEndDate: string };
type PlatformFilter = { clause: string; values: string[] };

function metricsTemplate() {
  return {
    views: 0,
    link_views: 0,
    link_driven_installs: 0,
    organic_users: 0,
    opens: 0,
    installs: 0,
    reinstalls: 0,
    app_opens: 0,
    new_users: 0,
    returning_users: 0,
    returning_rate: 0,
    referred_users: 0,
    revenue: 0,
    arpu: 0,
    arppu: 0,
    units_sold: 0,
    cancellations: 0,
    first_time_purchases: 0,
  };
}

function isoDate(value: unknown, fallback: Date): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return fallback.toISOString().slice(0, 10);
}

function dashboardDateRange(body: Record<string, any>): DateRange {
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setUTCDate(defaultStart.getUTCDate() - 30);
  const startDate = isoDate(body.start_date, defaultStart);
  const endDate = isoDate(body.end_date, now);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return {
    startDate,
    endDate,
    previousStartDate: previousStart.toISOString().slice(0, 10),
    previousEndDate: previousEnd.toISOString().slice(0, 10),
  };
}

function eachDate(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function platformFilter(platform: unknown, column = 'platform'): PlatformFilter {
  if (platform === undefined || platform === null || platform === '') return { clause: '', values: [] };
  const values = Array.isArray(platform)
    ? platform.map(String).filter(Boolean)
    : String(platform).split(',').map((item) => item.trim()).filter(Boolean);
  if (values.length === 0) return { clause: '', values: [] };
  if (values.length === 1) return { clause: ` AND ${column} = ?`, values };
  return { clause: ` AND ${column} IN (${values.map(() => '?').join(',')})`, values };
}

function metricFromRow(row: any = {}) {
  const metrics = metricsTemplate();
  for (const key of Object.keys(metrics)) {
    (metrics as any)[key] = Number(row[key] || 0);
  }
  metrics.link_driven_installs = Math.max(0, metrics.installs - metrics.organic_users);
  metrics.returning_rate = Number(metrics.returning_rate || 0);
  metrics.arpu = Number(metrics.arpu || 0);
  metrics.arppu = Number(metrics.arppu || 0);
  return metrics;
}

async function uniqueVisitorsFromEvents(db: D1Database, projectId: number, startDate: string, endDate: string, filter: PlatformFilter): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT device_id) AS total
    FROM events
    WHERE project_id = ? AND date(created_at) BETWEEN ? AND ?${filter.clause}
  `).bind(projectId, startDate, endDate, ...filter.values).first<{ total: number }>();
  return Number(row?.total || 0);
}

async function firstTimeVisitorsFromEvents(db: D1Database, projectId: number, startDate: string, endDate: string, filter: PlatformFilter): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT current.device_id) AS total
    FROM events current
    WHERE current.project_id = ?
      AND date(current.created_at) BETWEEN ? AND ?${filter.clause.replaceAll('platform', 'current.platform')}
      AND NOT EXISTS (
        SELECT 1 FROM events previous
        WHERE previous.project_id = current.project_id
          AND previous.device_id = current.device_id
          AND date(previous.created_at) < ?
      )
  `).bind(projectId, startDate, endDate, ...filter.values, startDate).first<{ total: number }>();
  return Number(row?.total || 0);
}

async function purchaseMetricsForRange(db: D1Database, projectId: number, startDate: string, endDate: string, filter: PlatformFilter) {
  const platformJoin = filter.values.length > 0 ? 'LEFT JOIN devices d ON d.id = pe.device_id' : '';
  const platformClause = filter.values.length > 0 ? filter.clause.replaceAll('platform', 'd.platform') : '';
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS units_sold,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('cancel', 'refund') THEN 1 ELSE 0 END), 0) AS cancellations,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN 1 ELSE 0 END), 0) AS first_time_purchases,
      COUNT(DISTINCT CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN pe.device_id END) AS paying_users
    FROM purchase_events pe
    ${platformJoin}
    WHERE pe.project_id = ?
      AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
      AND (pe.webhook_validated = 1 OR pe.store = 0 OR pe.store IS NULL)
      ${platformClause}
  `).bind(String(projectId), startDate, endDate, ...filter.values).first<any>();
  return {
    revenue: Number(row?.revenue || 0),
    units_sold: Number(row?.units_sold || 0),
    cancellations: Number(row?.cancellations || 0),
    first_time_purchases: Number(row?.first_time_purchases || 0),
    paying_users: Number(row?.paying_users || 0),
  };
}

async function metricsForRange(db: D1Database, projectId: number, startDate: string, endDate: string, platform: unknown) {
  const filter = platformFilter(platform);
  const daily = await db.prepare(`
    SELECT COUNT(*) AS rows_count,
      COALESCE(SUM(views), 0) AS views,
      COALESCE(SUM(link_views), 0) AS link_views,
      COALESCE(SUM(installs), 0) AS installs,
      COALESCE(SUM(reinstalls), 0) AS reinstalls,
      COALESCE(SUM(opens), 0) AS opens,
      COALESCE(SUM(app_opens), 0) AS app_opens,
      COALESCE(SUM(new_users), 0) AS new_users,
      COALESCE(SUM(returning_users), 0) AS returning_users,
      COALESCE(SUM(organic_users), 0) AS organic_users,
      COALESCE(SUM(referred_users), 0) AS referred_users,
      COALESCE(SUM(first_time_visitors), 0) AS first_time_visitors,
      COALESCE(SUM(revenue), 0) AS revenue,
      COALESCE(SUM(units_sold), 0) AS units_sold,
      COALESCE(SUM(cancellations), 0) AS cancellations,
      COALESCE(SUM(first_time_purchases), 0) AS first_time_purchases
    FROM daily_project_metrics
    WHERE project_id = ? AND event_date BETWEEN ? AND ?${filter.clause}
  `).bind(projectId, startDate, endDate, ...filter.values).first<any>();

  let metrics = metricFromRow(daily);
  const hasDailyRows = Number(daily?.rows_count || 0) > 0;

  if (!hasDailyRows) {
    const eventRow = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN event = 'view' THEN 1 ELSE 0 END), 0) AS views,
        COALESCE(SUM(CASE WHEN event = 'view' AND link_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS link_views,
        COALESCE(SUM(CASE WHEN event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
        COALESCE(SUM(CASE WHEN event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
        COALESCE(SUM(CASE WHEN event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
        COALESCE(SUM(CASE WHEN event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
        COALESCE(SUM(CASE WHEN event = 'user_referred' THEN 1 ELSE 0 END), 0) AS referred_users,
        COALESCE(SUM(CASE WHEN event = 'install' AND link_id IS NULL THEN 1 ELSE 0 END), 0) AS organic_users
      FROM events
      WHERE project_id = ? AND date(created_at) BETWEEN ? AND ?${filter.clause}
    `).bind(projectId, startDate, endDate, ...filter.values).first<any>();
    metrics = metricFromRow(eventRow);
  }

  const totalUsers = hasDailyRows
    ? Number((await db.prepare(`
        SELECT COUNT(DISTINCT visitor_id) AS total
        FROM visitor_daily_statistics
        WHERE project_id = ? AND event_date BETWEEN ? AND ?${filter.clause}
      `).bind(projectId, startDate, endDate, ...filter.values).first<{ total: number }>())?.total || 0)
    : await uniqueVisitorsFromEvents(db, projectId, startDate, endDate, filter);
  const firstTimeVisitors = hasDailyRows
    ? Number(daily?.first_time_visitors || 0)
    : await firstTimeVisitorsFromEvents(db, projectId, startDate, endDate, filter);
  const purchases = await purchaseMetricsForRange(db, projectId, startDate, endDate, filter);

  metrics.new_users = metrics.new_users || firstTimeVisitors;
  metrics.returning_users = Math.max(0, totalUsers - firstTimeVisitors);
  metrics.returning_rate = totalUsers === 0 ? 0 : Number((metrics.returning_users / totalUsers).toFixed(4));
  if (purchases.revenue !== 0 || purchases.units_sold !== 0 || purchases.cancellations !== 0) {
    metrics.revenue = purchases.revenue;
    metrics.units_sold = purchases.units_sold;
    metrics.cancellations = purchases.cancellations;
    metrics.first_time_purchases = purchases.first_time_purchases;
  }
  metrics.link_driven_installs = Math.max(0, metrics.installs - metrics.organic_users);
  metrics.arpu = totalUsers > 0 ? Number((metrics.revenue / totalUsers).toFixed(2)) : 0;
  metrics.arppu = purchases.paying_users > 0 ? Number((metrics.revenue / purchases.paying_users).toFixed(2)) : 0;
  return metrics;
}

function buildLink(row: any, redirects: any[] = []) {
  const tags = typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : [];
  const data = parseJsonObject(row.data) || {};
  const ios = redirects.find((r) => r.platform === 'ios');
  const android = redirects.find((r) => r.platform === 'android');
  const desktop = redirects.find((r) => r.platform === 'desktop' || r.platform === 'web');
  return {
    id: String(row.id),
    name: row.title || row.path,
    path: row.path,
    active: row.active !== 0,
    ads_platform: row.generated_from_platform || 'dashboard',
    tags,
    title: row.title || undefined,
    subtitle: row.subtitle || undefined,
    image: row.image_url || undefined,
    data,
    ios_custom_redirect: ios ? { url: ios.url, open_app_if_installed: ios.open_app_if_installed !== 0 } : undefined,
    android_custom_redirect: android ? { url: android.url, open_app_if_installed: android.open_app_if_installed !== 0 } : undefined,
    desktop_custom_redirect: desktop ? { url: desktop.url, open_app_if_installed: desktop.open_app_if_installed !== 0 } : undefined,
    show_preview_ios: row.show_preview_ios === 1,
    show_preview_android: row.show_preview_android === 1,
    tracking_campaign: row.tracking_campaign || undefined,
    tracking_medium: row.tracking_medium || undefined,
    tracking_source: row.tracking_source || undefined,
    campaign_id: row.campaign_id ? String(row.campaign_id) : undefined,
    total_views: Number(row.total_views || 0),
    total_opens: Number(row.total_opens || 0),
    total_installs: Number(row.total_installs || 0),
    total_reinstalls: 0,
    total_reactivations: 0,
    total_time_spent: 0,
    total_revenue: 0,
    access_path: `https://go.vocostar.com/${row.path}`,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function loadLinks(c: any, projectExternalId: string, limit = 50, offset = 0) {
  const project = await resolveProject(c.env.DB, projectExternalId);
  const rows: { results?: any[] } = await c.env.DB.prepare(`
    SELECT l.*,
      COUNT(CASE WHEN e.event = 'view' THEN 1 END) AS total_views,
      COUNT(CASE WHEN e.event = 'open' THEN 1 END) AS total_opens,
      COUNT(CASE WHEN e.event = 'install' THEN 1 END) AS total_installs
    FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    LEFT JOIN events e ON e.link_id = l.id
    WHERE rc.project_id = ?
    GROUP BY l.id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(project.id, limit, offset).all();

  return Promise.all((rows.results || []).map(async (row: any) => {
    const redirects: { results?: any[] } = await c.env.DB.prepare(
      'SELECT * FROM custom_redirects WHERE link_id = ?'
    ).bind(row.id).all();
    return buildLink(row, redirects.results || []);
  }));
}

// =================== LINKS ===================

projects.get('/:id/links/random_path', async (c) => {
  const path = generateShortCode();
  return c.json({ valid_path: path, path });
});

projects.post('/:id/links/check_path', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const path = sanitizePath(String(body.path || ''));
  const existing = await c.env.DB.prepare(`
    SELECT l.id FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ? AND l.path = ?
  `).bind(project.id, path).first();
  return c.json({ available: !existing });
});

projects.post('/:id/links', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, project.id);
  const path = sanitizePath(String(field(body, 'path') || generateShortCode()));
  const title = String(field(body, 'name', 'title') || path);
  const tags = field(body, 'tags') || [];
  const data = field(body, 'data') || {};

  const duplicate = await c.env.DB.prepare('SELECT id FROM links WHERE path = ?').bind(path).first();
  if (duplicate) return c.json({ error: 'Path already exists' }, 422);

  const link = await c.env.DB.prepare(`
    INSERT INTO links (
      path, title, subtitle, image_url, data, tags, redirect_config_id, campaign_id,
      tracking_source, tracking_medium, tracking_campaign, generated_from_platform,
      show_preview_ios, show_preview_android
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dashboard', ?, ?)
    RETURNING *
  `).bind(
    path,
    title,
    field(body, 'subtitle') || null,
    field(body, 'image', 'image_url') || null,
    JSON.stringify(parseJsonObject(data) || {}),
    jsonArray(tags),
    redirectConfigId,
    field(body, 'campaign_id') || null,
    field(body, 'tracking_source') || null,
    field(body, 'tracking_medium') || null,
    field(body, 'tracking_campaign') || null,
    toBool(field(body, 'show_preview_ios')) ? 1 : 0,
    toBool(field(body, 'show_preview_android')) ? 1 : 0,
  ).first<any>();

  const redirects = [
    ['ios', field(body, 'ios_url', 'ios_custom_redirect')],
    ['android', field(body, 'android_url', 'android_custom_redirect')],
    ['desktop', field(body, 'desktop_url', 'desktop_custom_redirect')],
  ] as const;

  for (const [platform, value] of redirects) {
    const url = typeof value === 'object' ? value?.url : value;
    if (url) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO custom_redirects (link_id, platform, url, open_app_if_installed) VALUES (?, ?, ?, ?)'
      ).bind(link.id, platform, String(url), 1).run();
    }
  }

  return c.json({ link: buildLink(link), short_url: `https://${c.env.SHORTLINK_DOMAIN}/${path}` }, 201);
});

projects.post('/:id/links/search_v2', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await readBody(c);
  const page = Number(body.page || 1);
  const perPage = Number(body.per_page || body.limit || 20);
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM links l JOIN redirect_configs rc ON rc.id = l.redirect_config_id WHERE rc.project_id = ?'
  ).bind(project.id).first<{ total: number }>();
  const links = await loadLinks(c, c.req.param('id'), perPage, (page - 1) * perPage);
  return c.json({
    links,
    meta: {
      total_pages: Math.max(1, Math.ceil((count?.total || 0) / perPage)),
      total_entries: count?.total || 0,
    },
  });
});

projects.post('/:id/links/search', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await readBody(c);
  const page = Number(body.page || 1);
  const perPage = Number(body.per_page || body.limit || 20);
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM links l JOIN redirect_configs rc ON rc.id = l.redirect_config_id WHERE rc.project_id = ?'
  ).bind(project.id).first<{ total: number }>();
  const links = await loadLinks(c, c.req.param('id'), perPage, (page - 1) * perPage);
  return c.json({
    links,
    meta: {
      total_pages: Math.max(1, Math.ceil((count?.total || 0) / perPage)),
      total_entries: count?.total || 0,
    },
  });
});

projects.post('/:id/links/by_ids', async (c) => {
  const body = await readBody(c);
  const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  if (ids.length === 0) return c.json({ links: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT * FROM links WHERE id IN (${placeholders})`).bind(...ids).all<any>();
  return c.json({ links: (rows.results || []).map((row: any) => buildLink(row)) });
});

projects.patch('/:id/links/:linkId', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await readBody(c);
  const linkId = Number(c.req.param('linkId'));
  const updates: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    name: 'title',
    title: 'title',
    subtitle: 'subtitle',
    image: 'image_url',
    image_url: 'image_url',
    tracking_source: 'tracking_source',
    tracking_medium: 'tracking_medium',
    tracking_campaign: 'tracking_campaign',
  };

  for (const [input, column] of Object.entries(map)) {
    const value = field(body, input);
    if (value !== undefined) {
      updates.push(`${column} = ?`);
      values.push(value || null);
    }
  }
  if (field(body, 'active') !== undefined) {
    updates.push('active = ?');
    values.push(toBool(field(body, 'active')) ? 1 : 0);
  }
  if (field(body, 'tags') !== undefined) {
    updates.push('tags = ?');
    values.push(jsonArray(field(body, 'tags')));
  }
  if (field(body, 'data') !== undefined) {
    updates.push('data = ?');
    values.push(JSON.stringify(parseJsonObject(field(body, 'data')) || {}));
  }

  if (updates.length > 0) {
    await c.env.DB.prepare(
      `UPDATE links SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...values, linkId).run();
  }

  const row = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(linkId).first<any>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ link: buildLink(row) });
});

projects.delete('/:id/links/:linkId', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  await c.env.DB.prepare('DELETE FROM custom_redirects WHERE link_id = ?').bind(Number(c.req.param('linkId'))).run();
  await c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(Number(c.req.param('linkId'))).run();
  return c.json({ message: 'Link deleted' });
});

// =================== DOMAIN ===================

projects.get('/:id/domain', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  let domain = await c.env.DB.prepare(
    'SELECT * FROM domains WHERE project_id = ? LIMIT 1'
  ).bind(project.id).first<any>();
  if (!domain) {
    domain = await c.env.DB.prepare(
      'INSERT INTO domains (domain, subdomain, project_id, generic_title, generic_subtitle) VALUES (?, ?, ?, ?, ?) RETURNING *'
    ).bind(c.env.SHORTLINK_DOMAIN, '', project.id, 'Vocostar', 'Share & discover').first<any>();
  }
  return c.json({
    domain: {
      id: String(domain.id),
      subdomain: domain.subdomain || '',
      domain: domain.domain || c.env.SHORTLINK_DOMAIN,
      google_tracking_id: domain.google_tracking_id || null,
      generic_title: domain.generic_title || 'Vocostar',
      generic_subtitle: domain.generic_subtitle || 'Share & discover',
      generic_image_url: domain.generic_image_url || null,
    },
  });
});

projects.put('/:id/domain', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  await c.env.DB.prepare(
    `INSERT INTO domains (domain, subdomain, project_id, generic_title, generic_subtitle, generic_image_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       subdomain = excluded.subdomain,
       generic_title = excluded.generic_title,
       generic_subtitle = excluded.generic_subtitle,
       generic_image_url = excluded.generic_image_url,
       updated_at = datetime('now')`
  ).bind(
    c.env.SHORTLINK_DOMAIN,
    body.subdomain || '',
    project.id,
    body.generic_title || 'Vocostar',
    body.generic_subtitle || '',
    body.generic_image_url || null,
  ).run();
  const domain = await c.env.DB.prepare('SELECT * FROM domains WHERE project_id = ? LIMIT 1').bind(project.id).first<any>();
  return c.json({
    domain: {
      id: String(domain.id),
      subdomain: domain.subdomain || '',
      domain: domain.domain || c.env.SHORTLINK_DOMAIN,
      google_tracking_id: domain.google_tracking_id || null,
      generic_title: domain.generic_title || 'Vocostar',
      generic_subtitle: domain.generic_subtitle || '',
      generic_image_url: domain.generic_image_url || null,
    },
  });
});

projects.get('/:id/domain/defaults', async (c) => {
  return c.json({ generic_title: 'Vocostar', generic_subtitle: 'Share & discover', generic_image_url: null });
});

projects.post('/:id/domain/check_availability', async (c) => {
  return c.json({ available: true });
});

projects.put('/:id/domain/google_tracking_id', async (c) => {
  const body = await readBody(c);
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  await c.env.DB.prepare('UPDATE domains SET google_tracking_id = ?, updated_at = datetime("now") WHERE project_id = ?')
    .bind(body.google_tracking_id || null, project.id).run().catch(() => null);
  return c.json({ message: 'Google tracking id updated' });
});

// =================== REDIRECT CONFIG ===================

async function redirectConfigResponse(c: any, projectExternalId: string) {
  const project = await resolveProject(c.env.DB, projectExternalId);
  const id = await getOrCreateRedirectConfig(c.env.DB, project.id);
  const config: any = await c.env.DB.prepare('SELECT * FROM redirect_configs WHERE id = ?').bind(id).first();
  const redirects: { results?: any[] } = await c.env.DB.prepare('SELECT * FROM redirects WHERE redirect_config_id = ?').bind(id).all();
  const by = (platform: string, variation: string) => {
    const row = (redirects.results || []).find((r: any) => r.platform === platform && r.variation === variation);
    return {
      enabled: row?.enabled === 1,
      variation,
      appstore: row?.appstore === 1,
      fallback_url: row?.fallback_url || null,
      url: row?.fallback_url || null,
    };
  };
  return {
    redirect_config: {
      id: String(id),
      default_fallback: config?.default_fallback || '',
      show_preview_android: config?.show_preview_android === 1,
      show_preview_ios: config?.show_preview_ios === 1,
      show_preview: config?.show_preview_android === 1 || config?.show_preview_ios === 1,
      ios: { phone: by('ios', 'phone'), tablet: by('ios', 'tablet') },
      android: { phone: by('android', 'phone'), tablet: by('android', 'tablet') },
      desktop: { all: by('desktop', 'all') },
    },
  };
}

projects.get('/:id/redirect_config', async (c) => c.json(await redirectConfigResponse(c, c.req.param('id'))));

projects.put('/:id/redirect_config', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const id = await getOrCreateRedirectConfig(c.env.DB, project.id);
  const body = await readBody(c);
  await c.env.DB.prepare(
    'UPDATE redirect_configs SET default_fallback = ?, show_preview_android = ?, show_preview_ios = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(body.default_fallback || '', toBool(body.show_preview_android) ? 1 : 0, toBool(body.show_preview_ios) ? 1 : 0, id).run();
  return c.json(await redirectConfigResponse(c, c.req.param('id')));
});

projects.put('/:id/redirect_config/redirect', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const id = await getOrCreateRedirectConfig(c.env.DB, project.id);
  const body = await readBody(c);
  const platform = body.platform || 'desktop';
  const variation = body.variation || (platform === 'desktop' ? 'all' : 'phone');
  await c.env.DB.prepare(
    `INSERT INTO redirects (redirect_config_id, platform, variation, enabled, appstore, fallback_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(redirect_config_id, platform, variation) DO UPDATE SET
       enabled = excluded.enabled,
       appstore = excluded.appstore,
       fallback_url = excluded.fallback_url,
       updated_at = datetime('now')`
  ).bind(id, platform, variation, toBool(body.enabled) ? 1 : 0, toBool(body.appstore) ? 1 : 0, body.fallback_url || null).run();
  return c.json(await redirectConfigResponse(c, c.req.param('id')));
});

// =================== DASHBOARD METRICS ===================

projects.post('/:id/dashboard/top_links', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const filter = platformFilter(body.platform, 'lds.platform');
  const dailyRows = await c.env.DB.prepare(`
    SELECT l.*,
      COALESCE(SUM(lds.views), 0) AS views,
      COALESCE(SUM(lds.opens), 0) AS opens,
      COALESCE(SUM(lds.installs), 0) AS installs,
      COALESCE(SUM(lds.reinstalls), 0) AS reinstalls,
      COALESCE(SUM(lds.reactivations), 0) AS reactivations,
      COALESCE(SUM(lds.time_spent), 0) AS time_spent,
      COALESCE(SUM(lds.revenue), 0) AS revenue_cents
    FROM link_daily_statistics lds
    JOIN links l ON l.id = lds.link_id
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ?
      AND COALESCE(l.sdk_generated, 0) = 0
      AND lds.event_date BETWEEN ? AND ?${filter.clause}
    GROUP BY l.id
    ORDER BY installs DESC, views DESC, l.created_at DESC
    LIMIT 10
  `).bind(project.id, range.startDate, range.endDate, ...filter.values).all<any>();

  const eventFilter = platformFilter(body.platform, 'e.platform');
  const eventRows = (dailyRows.results || []).length > 0 ? { results: [] as any[] } : await c.env.DB.prepare(`
    SELECT l.*,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      0 AS revenue_cents
    FROM events e
    JOIN links l ON l.id = e.link_id
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ?
      AND COALESCE(l.sdk_generated, 0) = 0
      AND date(e.created_at) BETWEEN ? AND ?${eventFilter.clause}
    GROUP BY l.id
    ORDER BY installs DESC, views DESC, l.created_at DESC
    LIMIT 10
  `).bind(project.id, range.startDate, range.endDate, ...eventFilter.values).all<any>();

  const rows = (dailyRows.results || []).length > 0 ? dailyRows.results || [] : eventRows.results || [];
  return c.json({
    links: rows.map((row: any) => ({
      id: String(row.id),
      ads_platform: row.generated_from_platform || row.ads_platform || 'dashboard',
      name: row.name || row.title || row.path,
      views: Number(row.views || 0),
      opens: Number(row.opens || 0),
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : [],
      installs: Number(row.installs || 0),
      reinstalls: Number(row.reinstalls || 0),
      reactivations: Number(row.reactivations || 0),
      time_spent: Number(row.time_spent || 0),
      revenue_cents: Number(row.revenue_cents || 0),
    })),
  });
});

projects.post('/:id/dashboard/links_views', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const metrics = Object.fromEntries(eachDate(range.startDate, range.endDate).map((date) => [date, 0]));
  const dailyFilter = platformFilter(body.platform, 'platform');
  const dailyRows = await c.env.DB.prepare(`
    SELECT event_date, COALESCE(SUM(link_views), 0) AS link_views
    FROM daily_project_metrics
    WHERE project_id = ? AND event_date BETWEEN ? AND ?${dailyFilter.clause}
    GROUP BY event_date
  `).bind(project.id, range.startDate, range.endDate, ...dailyFilter.values).all<{ event_date: string; link_views: number }>();
  if ((dailyRows.results || []).length > 0) {
    for (const row of dailyRows.results || []) metrics[String(row.event_date).slice(0, 10)] = Number(row.link_views || 0);
    return c.json({ metrics });
  }

  const eventFilter = platformFilter(body.platform, 'platform');
  const rows = await c.env.DB.prepare(`
    SELECT date(created_at) AS event_date, COUNT(*) AS link_views
    FROM events
    WHERE project_id = ?
      AND link_id IS NOT NULL
      AND event = 'view'
      AND date(created_at) BETWEEN ? AND ?${eventFilter.clause}
    GROUP BY date(created_at)
  `).bind(project.id, range.startDate, range.endDate, ...eventFilter.values).all<{ event_date: string; link_views: number }>();
  for (const row of rows.results || []) metrics[String(row.event_date).slice(0, 10)] = Number(row.link_views || 0);
  return c.json({ metrics });
});

projects.post('/:id/dashboard/metrics_overview', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  return c.json({
    metrics: {
      current: await metricsForRange(c.env.DB, project.id, range.startDate, range.endDate, body.platform),
      previous: await metricsForRange(c.env.DB, project.id, range.previousStartDate, range.previousEndDate, body.platform),
    },
  });
});

// =================== CAMPAIGNS ===================

function campaignRow(row: any) {
  return {
    id: String(row.id),
    name: row.name || 'Campaign',
    active: row.archived !== 1,
    total_views: Number(row.total_views || row.views || 0),
    total_opens: Number(row.total_opens || row.opens || 0),
    total_installs: Number(row.total_installs || row.installs || 0),
    total_reinstalls: Number(row.total_reinstalls || row.reinstalls || 0),
    total_reactivations: Number(row.total_reactivations || row.reactivations || 0),
    total_app_opens: Number(row.total_app_opens || row.app_opens || 0),
    total_user_referred: Number(row.total_user_referred || row.user_referred || 0),
    total_revenue: Number(row.total_revenue || row.revenue || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function campaignMetricsForRange(db: D1Database, projectId: number, startDate: string, endDate: string, platform: unknown) {
  const filter = platformFilter(platform, 'e.platform');
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent
    FROM events e
    JOIN links l ON l.id = e.link_id
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ?
      AND l.campaign_id IS NOT NULL
      AND date(e.created_at) BETWEEN ? AND ?${filter.clause}
  `).bind(projectId, startDate, endDate, ...filter.values).first<any>();
  const metrics = metricFromRow({
    views: row?.views,
    opens: row?.opens,
    installs: row?.installs,
    reinstalls: row?.reinstalls,
    app_opens: row?.app_opens,
    referred_users: row?.user_referred,
  });
  return {
    ...metrics,
    total_views: Number(row?.views || 0),
    total_opens: Number(row?.opens || 0),
    total_installs: Number(row?.installs || 0),
    total_reinstalls: Number(row?.reinstalls || 0),
    total_reactivations: Number(row?.reactivations || 0),
    total_app_opens: Number(row?.app_opens || 0),
    total_user_referred: Number(row?.user_referred || 0),
    total_time_spent: Number(row?.time_spent || 0),
  };
}

projects.post('/:id/campaigns', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const row = await c.env.DB.prepare(
    'INSERT INTO campaigns (name, project_id) VALUES (?, ?) RETURNING *'
  ).bind(body.name || 'Campaign', project.id).first<any>();
  return c.json({ campaign: campaignRow(row) }, 201);
});

projects.post('/:id/campaigns/search_v2', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const filter = platformFilter(body.platform, 'e.platform');
  const rows = await c.env.DB.prepare(`
    SELECT c.*,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS total_views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS total_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS total_installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS total_reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS total_reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS total_app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS total_user_referred
    FROM campaigns c
    LEFT JOIN links l ON l.campaign_id = c.id
    LEFT JOIN events e ON e.link_id = l.id AND date(e.created_at) BETWEEN ? AND ?${filter.clause}
    WHERE c.project_id = ? AND c.archived = 0
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).bind(range.startDate, range.endDate, ...filter.values, project.id).all<any>();
  const data = (rows.results || []).map(campaignRow);
  return c.json({ data, campaigns: data, total_pages: 1, total_entries: data.length });
});

projects.post('/:id/campaigns/search', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const rows = await c.env.DB.prepare(`
    SELECT c.*
    FROM campaigns c
    WHERE c.project_id = ? AND c.archived = 0
    ORDER BY c.created_at DESC
  `).bind(project.id).all<any>();
  const data = (rows.results || []).map(campaignRow);
  return c.json({ data, campaigns: data, total_pages: 1, total_entries: data.length });
});

projects.post('/:id/campaigns/metrics_overview', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  return c.json({
    metrics: {
      current: await campaignMetricsForRange(c.env.DB, project.id, range.startDate, range.endDate, body.platform),
      previous: await campaignMetricsForRange(c.env.DB, project.id, range.previousStartDate, range.previousEndDate, body.platform),
    },
  });
});
projects.get('/:id/campaigns/:campaignId', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(Number(c.req.param('campaignId'))).first<any>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ campaign: campaignRow(row) });
});
projects.patch('/:id/campaigns/:campaignId', async (c) => {
  const body = await readBody(c);
  await c.env.DB.prepare('UPDATE campaigns SET name = COALESCE(?, name), updated_at = datetime("now") WHERE id = ?')
    .bind(body.name || null, Number(c.req.param('campaignId'))).run();
  const row = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(Number(c.req.param('campaignId'))).first<any>();
  return c.json(campaignRow(row));
});
projects.delete('/:id/campaigns/:campaignId', async (c) => {
  await c.env.DB.prepare('UPDATE campaigns SET archived = 1, updated_at = datetime("now") WHERE id = ?')
    .bind(Number(c.req.param('campaignId'))).run();
  return c.json({ message: 'Campaign deleted' });
});

// =================== EVENTS / ANALYTICS ===================

function eventRow(row: any) {
  return {
    id: String(row.id),
    name: row.event,
    type: row.event,
    created_at: row.created_at,
    properties: parseJsonObject(row.data) || {},
  };
}

async function ensureVisitorForDevice(db: D1Database, projectId: number, deviceId: number, sdkIdentifier?: string | null) {
  const existing = await db.prepare(
    'SELECT id FROM visitors WHERE project_id = ? AND device_id = ? LIMIT 1'
  ).bind(projectId, deviceId).first<{ id: number }>();
  if (existing) {
    if (sdkIdentifier) {
      await db.prepare('UPDATE visitors SET sdk_identifier = COALESCE(?, sdk_identifier), updated_at = datetime("now") WHERE id = ?')
        .bind(sdkIdentifier, existing.id).run();
    }
    return existing.id;
  }
  const created = await db.prepare(`
    INSERT INTO visitors (project_id, device_id, sdk_identifier, uuid, sdk_attributes)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).bind(projectId, deviceId, sdkIdentifier || null, crypto.randomUUID(), '{}').first<{ id: number }>();
  return created?.id ?? null;
}

function visitorMetricsRow(row: any, prefix = 'total_') {
  return {
    [`${prefix}views`]: Number(row.views || 0),
    [`${prefix}opens`]: Number(row.opens || 0),
    [`${prefix}app_opens`]: Number(row.app_opens || 0),
    [`${prefix}installs`]: Number(row.installs || 0),
    [`${prefix}reinstalls`]: Number(row.reinstalls || 0),
    [`${prefix}reactivations`]: Number(row.reactivations || 0),
    [`${prefix}user_referred`]: Number(row.user_referred || 0),
    [`${prefix}time_spent`]: Number(row.time_spent || 0),
    [`${prefix}revenue`]: Number(row.revenue || 0),
  };
}

function visitorRow(row: any) {
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
    ...visitorMetricsRow(row),
  };
}

function referralVisitorRow(row: any) {
  return {
    id: String(row.id),
    uuid: row.uuid || String(row.id),
    sdk_identifier: row.sdk_identifier || '',
    inviter: row.inviter || null,
    platform: row.platform || '',
    updated_at: row.updated_at,
    view_count: Number(row.views || 0),
    open_count: Number(row.opens || 0),
    install_count: Number(row.installs || 0),
    reinstall_count: Number(row.reinstalls || 0),
    reactivations: Number(row.reactivations || 0),
    user_referred_count: Number(row.user_referred || 0),
    time_spent: Number(row.time_spent || 0),
    total_revenue: Number(row.revenue || 0),
    invited_views: Number(row.views || 0),
    invited_app_opens: Number(row.app_opens || 0),
    invited_installs: Number(row.installs || 0),
    invited_reinstalls: Number(row.reinstalls || 0),
    invited_reactivations: Number(row.reactivations || 0),
    invited_user_referred: Number(row.user_referred || 0),
    invited_time_spent: Number(row.time_spent || 0),
  };
}

projects.post('/:id/events/search', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const rows = await c.env.DB.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(project.id).all<any>();
  const events = (rows.results || []).map(eventRow);
  return c.json({ events, meta: { total_pages: 1, total_entries: events.length } });
});
projects.post('/:id/events/sorted', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const rows = await c.env.DB.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(project.id).all<any>();
  return c.json({ events: (rows.results || []).map(eventRow) });
});
projects.post('/:id/events/overview', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const rows = await c.env.DB.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').bind(project.id).all<any>();
  return c.json({ events: (rows.results || []).map(eventRow) });
});
projects.get('/:id/events/metric_values', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const rows = await c.env.DB.prepare(`
    SELECT
      platform,
      app_version,
      build
    FROM events
    WHERE project_id = ?
  `).bind(project.id).all<any>();
  const platforms = new Set<string>();
  const appVersions = new Set<string>();
  const builds = new Set<string>();
  for (const row of rows.results || []) {
    if (row.platform) platforms.add(String(row.platform));
    if (row.app_version) appVersions.add(String(row.app_version));
    if (row.build) builds.add(String(row.build));
  }
  return c.json({
    metrics_values: {
      platforms: Array.from(platforms).sort(),
      app_versions: Array.from(appVersions).sort(),
      builds: Array.from(builds).sort(),
    },
  });
});

projects.post('/add_event', async (c) => {
  const body = await readBody(c);
  const project = await resolveProject(c.env.DB, String(body.project_id));
  const device = await c.env.DB.prepare(
    'INSERT INTO devices (ip, remote_ip, user_agent) VALUES (?, ?, ?) RETURNING id'
  ).bind('0.0.0.0', '0.0.0.0', 'manual').first<{ id: number }>();
  await ensureVisitorForDevice(c.env.DB, project.id, device?.id || 1, body.sdk_identifier || null);
  const result = await c.env.DB.prepare(
    'INSERT INTO events (device_id, project_id, link_id, event, platform, data, app_version, build, engagement_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime("now"))) RETURNING *'
  ).bind(device?.id || 1, project.id, body.link_id || null, body.event || 'custom', body.platform || null, '{}', body.app_version || null, body.build || null, body.engagement_time || null, body.created_at || null).first<any>();
  return c.json({ event: eventRow(result) }, 201);
});

// =================== VISITORS / PURCHASES / NOTIFICATIONS ===================

projects.post('/:id/visitors/search', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const page = Math.max(1, Number(body.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(body.per_page || 20)));
  const filter = platformFilter(body.platform, 'd.platform');
  const term = String(body.term || '').trim();
  const termClause = term ? ' AND (v.uuid LIKE ? OR v.sdk_identifier LIKE ?)' : '';
  const termValues = term ? [`%${term}%`, `%${term}%`] : [];
  const count = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT v.id) AS total
    FROM visitors v
    LEFT JOIN devices d ON d.id = v.device_id
    WHERE v.project_id = ?${filter.clause}${termClause}
  `).bind(project.id, ...filter.values, ...termValues).first<{ total: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT v.*, d.platform,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) ELSE 0 END), 0) AS revenue
    FROM visitors v
    LEFT JOIN devices d ON d.id = v.device_id
    LEFT JOIN events e ON e.device_id = v.device_id AND e.project_id = v.project_id AND date(e.created_at) BETWEEN ? AND ?
    LEFT JOIN purchase_events pe ON pe.device_id = v.device_id AND pe.project_id = v.project_id AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
    WHERE v.project_id = ?${filter.clause}${termClause}
    GROUP BY v.id, d.platform
    ORDER BY v.updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(range.startDate, range.endDate, range.startDate, range.endDate, project.id, ...filter.values, ...termValues, perPage, (page - 1) * perPage).all<any>();
  const total = Number(count?.total || 0);
  return c.json({
    visitors: (rows.results || []).map(visitorRow),
    meta: { total_pages: Math.max(1, Math.ceil(total / perPage)), total_entries: total },
  });
});

projects.post('/:id/visitors/aggregated', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const page = Math.max(1, Number(body.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(body.per_page || 20)));
  const filter = platformFilter(body.platform, 'd.platform');
  const term = String(body.term || '').trim();
  const termClause = term ? ' AND (v.uuid LIKE ? OR v.sdk_identifier LIKE ?)' : '';
  const termValues = term ? [`%${term}%`, `%${term}%`] : [];
  const count = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT v.id) AS total
    FROM visitors v
    LEFT JOIN devices d ON d.id = v.device_id
    WHERE v.project_id = ?${filter.clause}${termClause}
  `).bind(project.id, ...filter.values, ...termValues).first<{ total: number }>();
  const rows = await c.env.DB.prepare(`
    SELECT v.*, d.platform,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) ELSE 0 END), 0) AS revenue
    FROM visitors v
    LEFT JOIN devices d ON d.id = v.device_id
    LEFT JOIN links l ON l.visitor_id = v.id
    LEFT JOIN events e ON e.link_id = l.id AND e.project_id = v.project_id AND date(e.created_at) BETWEEN ? AND ?
    LEFT JOIN purchase_events pe ON pe.link_id = l.id AND pe.project_id = v.project_id AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
    WHERE v.project_id = ?${filter.clause}${termClause}
    GROUP BY v.id, d.platform
    ORDER BY v.updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(range.startDate, range.endDate, range.startDate, range.endDate, project.id, ...filter.values, ...termValues, perPage, (page - 1) * perPage).all<any>();
  const total = Number(count?.total || 0);
  return c.json({
    visitors: (rows.results || []).map(referralVisitorRow),
    meta: { total_pages: Math.max(1, Math.ceil(total / perPage)), total_entries: total },
  });
});

projects.get('/:id/visitors/:visitorId', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const visitorId = c.req.param('visitorId');
  const row = await c.env.DB.prepare(`
    SELECT v.*, d.platform,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) ELSE 0 END), 0) AS revenue
    FROM visitors v
    LEFT JOIN devices d ON d.id = v.device_id
    LEFT JOIN events e ON e.device_id = v.device_id AND e.project_id = v.project_id
    LEFT JOIN purchase_events pe ON pe.device_id = v.device_id AND pe.project_id = v.project_id
    WHERE v.project_id = ? AND v.id = ?
    GROUP BY v.id, d.platform
  `).bind(project.id, visitorId).first<any>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  const visitor = visitorRow(row);
  const numberOfLinks = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM links WHERE visitor_id = ?')
    .bind(visitorId).first<{ total: number }>();
  return c.json({
    visitor,
    metrics: { ...visitor, number_of_generated_links: Number(numberOfLinks?.total || 0) },
    aggregated_metrics: referralVisitorRow(row),
    number_of_generated_links: Number(numberOfLinks?.total || 0),
  });
});

projects.post('/:id/visitors/metrics', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const row = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent
    FROM events e
    WHERE e.project_id = ? AND date(e.created_at) BETWEEN ? AND ?
  `).bind(project.id, range.startDate, range.endDate).first<any>();
  return c.json({ metrics: visitorMetricsRow(row, 'total_') });
});

projects.post('/:id/visitors/aggregated_metrics', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const row = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'reactivation' THEN 1 ELSE 0 END), 0) AS reactivations,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN e.event = 'time_spent' THEN COALESCE(e.engagement_time, 0) ELSE 0 END), 0) AS time_spent
    FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    LEFT JOIN events e ON e.link_id = l.id AND date(e.created_at) BETWEEN ? AND ?
    WHERE rc.project_id = ?
  `).bind(range.startDate, range.endDate, project.id).first<any>();
  return c.json({ metrics: visitorMetricsRow(row, 'total_') });
});

async function revenueRows(c: any, projectExternalId: string, body: Record<string, any>) {
  const project = await resolveProject(c.env.DB, projectExternalId);
  const projectId = String(project.id);
  const range = dashboardDateRange(body);
  const page = Math.max(1, Number(body.current_page || body.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(body.per_page || 20)));
  const filter = platformFilter(body.platform, 'd.platform');
  const term = String(body.term || '').trim();
  const termClause = term ? ' AND pe.product_id LIKE ?' : '';
  const termValues = term ? [`%${term}%`] : [];
  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM (
      SELECT pe.product_id
      FROM purchase_events pe
      LEFT JOIN devices d ON d.id = pe.device_id
      WHERE pe.project_id = ?
        AND pe.product_id IS NOT NULL
        AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
        ${filter.clause}
        ${termClause}
      GROUP BY pe.product_id
    ) grouped
  `).bind(projectId, range.startDate, range.endDate, ...filter.values, ...termValues).first();
  const rows = await c.env.DB.prepare(`
    SELECT
      pe.product_id,
      '[' || GROUP_CONCAT(DISTINCT '"' || COALESCE(d.platform, pe.store_source, 'unknown') || '"') || ']' AS platforms,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS units_sold,
      COUNT(DISTINCT CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN pe.device_id END) AS first_time_purchases,
      MAX(0, COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.quantity, 1) ELSE 0 END), 0) - COUNT(DISTINCT CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN pe.device_id END)) AS repeat_purchases,
      COALESCE(SUM(CASE
        WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1)
        WHEN pe.event_type = 'refund' THEN -1 * COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1)
        ELSE 0
      END), 0) AS total_revenue_usd_cents,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('cancel', 'refund') THEN 1 ELSE 0 END), 0) AS cancellations
    FROM purchase_events pe
    LEFT JOIN devices d ON d.id = pe.device_id
    WHERE pe.project_id = ?
      AND pe.product_id IS NOT NULL
      AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
      ${filter.clause}
      ${termClause}
    GROUP BY pe.product_id
    ORDER BY units_sold DESC, total_revenue_usd_cents DESC
    LIMIT ? OFFSET ?
  `).bind(projectId, range.startDate, range.endDate, ...filter.values, ...termValues, perPage, (page - 1) * perPage).all();
  const data = (rows.results || []).map((row: any) => {
    const units = Number(row.units_sold || 0);
    const revenue = Number(row.total_revenue_usd_cents || 0);
    return {
      product_id: row.product_id || 'unknown',
      platforms: row.platforms || '[]',
      units_sold: units,
      first_time_purchases: Number(row.first_time_purchases || 0),
      repeat_purchases: Number(row.repeat_purchases || 0),
      total_revenue_usd_cents: revenue,
      arpu_usd_cents: units > 0 ? Math.round(revenue / units) : 0,
      ltv_usd_cents: units > 0 ? Math.round(revenue / units) : 0,
      cancellations: Number(row.cancellations || 0),
    };
  });
  const total = Number(count?.total || 0);
  return { data, total_pages: Math.max(1, Math.ceil(total / perPage)), total_entries: total };
}

function purchaseEventRow(row: any) {
  return {
    id: String(row.id),
    event_type: row.event_type,
    purchase_type: row.purchase_type,
    product_id: row.product_id,
    identifier: row.identifier,
    transaction_id: row.transaction_id,
    original_transaction_id: row.original_transaction_id,
    price_cents: Number(row.price_cents || 0),
    usd_price_cents: Number(row.usd_price_cents || row.price_cents || 0),
    currency: row.currency,
    date: row.date || row.occurred_at || row.created_at,
    expires_date: row.expires_date,
    processed: row.processed === 1,
    store: row.store === 1,
    store_source: row.store_source,
    webhook_validated: row.webhook_validated === 1,
    quantity: Number(row.quantity || 1),
    order_id: row.order_id,
    platform: row.platform || row.store_source || null,
    link_id: row.link_id ? String(row.link_id) : null,
  };
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

async function purchaseRows(c: any, projectExternalId: string, body: Record<string, any>) {
  const project = await resolveProject(c.env.DB, projectExternalId);
  const projectId = String(project.id);
  const range = dashboardDateRange(body);
  const page = Math.max(1, Number(body.current_page || body.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(body.per_page || 20)));
  const sortMap: Record<string, string> = {
    id: 'pe.id',
    event_type: 'pe.event_type',
    device_id: 'pe.device_id',
    product_id: 'pe.product_id',
    identifier: 'pe.identifier',
    price_cents: 'pe.price_cents',
    currency: 'pe.currency',
    usd_price_cents: 'pe.usd_price_cents',
    date: 'pe.date',
    created_at: 'pe.created_at',
    updated_at: 'pe.updated_at',
  };
  const sortBy = sortMap[String(body.sort_by || '')] || 'pe.date';
  const direction = body.ascending === true || body.ascending === 'true' ? 'ASC' : 'DESC';
  const term = String(body.term || '').trim();
  const termClause = term ? ' AND pe.event_type LIKE ? ESCAPE \'\\\'' : '';
  const termValues = term ? [`%${term.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`] : [];
  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM purchase_events pe
    WHERE pe.project_id = ?
      AND date(COALESCE(pe.date, pe.occurred_at, pe.created_at)) BETWEEN ? AND ?
      AND (pe.webhook_validated = 1 OR pe.store = 0 OR pe.store IS NULL)
      ${termClause}
  `).bind(projectId, range.startDate, range.endDate, ...termValues).first();
  const rows = await c.env.DB.prepare(`
    SELECT pe.*, d.platform
    FROM purchase_events pe
    LEFT JOIN devices d ON d.id = pe.device_id
    WHERE pe.project_id = ?
      AND date(COALESCE(pe.date, pe.occurred_at, pe.created_at)) BETWEEN ? AND ?
      AND (pe.webhook_validated = 1 OR pe.store = 0 OR pe.store IS NULL)
      ${termClause}
    ORDER BY ${sortBy} ${direction}
    LIMIT ? OFFSET ?
  `).bind(projectId, range.startDate, range.endDate, ...termValues, perPage, (page - 1) * perPage).all();
  const total = Number(count?.total || 0);
  return {
    data: (rows.results || []).map(purchaseEventRow),
    total_pages: Math.max(1, Math.ceil(total / perPage)),
    total_entries: total,
  };
}

projects.post('/:id/purchases/search', async (c) => c.json(await purchaseRows(c, c.req.param('id'), await readBody(c))));
projects.post('/:id/purchases/revenue', async (c) => c.json(await revenueRows(c, c.req.param('id'), await readBody(c))));

function notificationAccessUrl(c: any, notificationId: unknown) {
  return `${new URL(c.req.url).origin}/mm/${notificationId}`;
}

function notificationRow(c: any, row: any) {
  const platforms = parseJsonArray(row.platforms);
  return {
    id: String(row.id),
    title: row.title || '',
    subtitle: row.subtitle || '',
    target: {
      id: row.target_id ? String(row.target_id) : undefined,
      platforms,
      new_users: row.new_users === 1,
      existing_users: row.existing_users === 1,
    },
    read_count: Number(row.read_count || 0),
    auto_display: row.auto_display === 1,
    send_push: row.send_push === 1,
    archived: row.archived === 1,
    updated_at: row.updated_at,
    html: row.html,
    access_url: notificationAccessUrl(c, row.id),
  };
}

function targetPlatformClause(platforms: string[], alias = 'd') {
  const values = platforms.filter(Boolean);
  if (values.length === 0) return { clause: '', values: [] as string[] };
  return {
    clause: ` AND ${alias}.platform IN (${values.map(() => '?').join(',')})`,
    values,
  };
}

function csvValue(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: unknown[]): string {
  return values.map(csvValue).join(',');
}

async function createMessagesForExistingVisitors(db: D1Database, notificationId: number, projectId: number, platforms: string[]) {
  const platform = targetPlatformClause(platforms, 'd');
  await db.prepare(`
    INSERT INTO notification_messages (notification_id, visitor_id, device_id, read)
    SELECT ?, v.id, v.device_id, 0
    FROM visitors v
    JOIN devices d ON d.id = v.device_id
    WHERE v.project_id = ?
      AND v.device_id IS NOT NULL
      ${platform.clause}
      AND NOT EXISTS (
        SELECT 1 FROM notification_messages nm
        WHERE nm.notification_id = ? AND nm.visitor_id = v.id
      )
  `).bind(notificationId, String(projectId), ...platform.values, notificationId).run();
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

async function enqueuePushNotifications(db: D1Database, notificationId: number | string, projectId: number | string) {
  const notification = await db.prepare(`
    SELECT id, title, subtitle, send_push
    FROM notifications
    WHERE id = ? AND COALESCE(send_push, 0) = 1 AND COALESCE(archived, 0) = 0
    LIMIT 1
  `).bind(notificationId).first<any>();
  if (!notification) return 0;

  const rows = await db.prepare(`
    SELECT DISTINCT nm.device_id, d.push_token, d.platform
    FROM notification_messages nm
    JOIN devices d ON d.id = nm.device_id
    WHERE nm.notification_id = ?
      AND d.push_token IS NOT NULL
      AND d.push_token != ''
      AND d.platform IN ('ios', 'android')
  `).bind(notificationId).all<any>();

  let queued = 0;
  for (const row of rows.results || []) {
    const appId = await rpushAppForProjectPlatform(db, projectId, row.platform);
    if (!appId) continue;
    const data = JSON.stringify({ linksquared: 'true', notification_id: String(notificationId) });
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
      row.push_token,
      JSON.stringify({ title: notification.title || '', subtitle: notification.subtitle || '' }),
      row.platform === 'android' ? JSON.stringify({ title: notification.title || '', body: notification.subtitle || '' }) : null,
      data,
      row.platform === 'ios' ? 'Rpush::Apnsp8::Notification' : 'Rpush::Fcm::Notification',
      appId,
      row.push_token,
      data,
    ).run();
    queued += 1;
  }
  return queued;
}

projects.post('/:id/notifications/search', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const archived = toBool(body.archived) ? 1 : 0;
  const page = Math.max(1, Number(body.page || body.current_page || 1));
  const perPage = Math.max(1, Math.min(100, Number(body.per_page || 20)));
  const term = String(body.term || '').trim().toLowerCase();
  const hasNewUsersFilter = body.for_new_users !== undefined && body.for_new_users !== null && body.for_new_users !== '';
  const newUsersFilter = toBool(body.for_new_users) ? 1 : 0;
  const termClause = term ? ' AND (LOWER(n.title) LIKE ? OR LOWER(n.subtitle) LIKE ?)' : '';
  const termValues = term ? [`%${term}%`, `%${term}%`] : [];
  const newUsersClause = hasNewUsersFilter ? ' AND COALESCE(nt.new_users, 0) = ?' : '';
  const newUsersValues = hasNewUsersFilter ? [newUsersFilter] : [];
  const count = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM notifications n
    LEFT JOIN notification_targets nt ON nt.notification_id = n.id
    WHERE n.project_id = ? AND COALESCE(n.archived, 0) = ?
      ${newUsersClause}
      ${termClause}
  `).bind(project.id, archived, ...newUsersValues, ...termValues).first();
  const rows = await c.env.DB.prepare(`
    SELECT n.*,
      nt.id AS target_id,
      COALESCE(nt.platforms, '[]') AS platforms,
      COALESCE(nt.new_users, 0) AS new_users,
      COALESCE(nt.existing_users, 0) AS existing_users,
      (
        SELECT COUNT(*)
        FROM notification_messages nm
        WHERE nm.notification_id = n.id AND COALESCE(nm.read, 0) = 1
      ) AS read_count
    FROM notifications n
    LEFT JOIN notification_targets nt ON nt.notification_id = n.id
    WHERE n.project_id = ? AND COALESCE(n.archived, 0) = ?
      ${newUsersClause}
      ${termClause}
    ORDER BY n.updated_at DESC
    LIMIT ? OFFSET ?
  `).bind(project.id, archived, ...newUsersValues, ...termValues, perPage, (page - 1) * perPage).all<any>();
  const total = Number(count?.total || 0);
  return c.json({
    data: (rows.results || []).map((row: any) => notificationRow(c, row)),
    total_pages: Math.max(1, Math.ceil(total / perPage)),
    total_entries: total,
  });
});

projects.post('/:id/notifications', async (c) => {
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const platforms = parseJsonArray(body.platforms);
  const newUsers = toBool(body.new_users ?? body.for_new_users);
  const existingUsers = toBool(body.existing_users ?? body.for_existing_users);
  if (newUsers === existingUsers) {
    return c.json({ error: "New and existing users can't both be selected or both be empty" }, 422);
  }
  const row = await c.env.DB.prepare(
    'INSERT INTO notifications (project_id, title, subtitle, html, send_push, auto_display) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
  ).bind(project.id, body.title || '', body.subtitle || '', body.html_message || body.html || null, toBool(body.send_push) ? 1 : 0, toBool(body.auto_display) ? 1 : 0).first<any>();
  await c.env.DB.prepare(`
    INSERT INTO notification_targets (notification_id, existing_users, new_users, platforms)
    VALUES (?, ?, ?, ?)
  `).bind(String(row.id), existingUsers ? 1 : 0, newUsers ? 1 : 0, JSON.stringify(platforms)).run();
  if (existingUsers) {
    await createMessagesForExistingVisitors(c.env.DB, row.id, project.id, platforms);
    await enqueuePushNotifications(c.env.DB, row.id, project.id);
  }
  const serialized = notificationRow(c, {
    ...row,
    platforms: JSON.stringify(platforms),
    new_users: newUsers ? 1 : 0,
    existing_users: existingUsers ? 1 : 0,
    read_count: 0,
  });
  return c.json({ ...serialized, notification: serialized }, 201);
});

projects.delete('/:id/notifications/:notifId', async (c) => {
  const notifId = Number(c.req.param('notifId'));
  const target = await c.env.DB.prepare('SELECT existing_users FROM notification_targets WHERE notification_id = ? LIMIT 1')
    .bind(String(notifId)).first<{ existing_users: number }>();
  if (target?.existing_users === 1) {
    return c.json({ error: "You can't archive a notification for existing users!" }, 422);
  }
  const row = await c.env.DB.prepare(`
    UPDATE notifications
    SET archived = 1, updated_at = datetime("now")
    WHERE id = ?
    RETURNING *
  `).bind(notifId).first<any>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({ notifications: notificationRow(c, { ...row, ...target, platforms: '[]', read_count: 0 }) });
});

projects.get('/exports/:fileKey', async (c) => {
  const key = decodeURIComponent(c.req.param('fileKey'));
  const response = await readCsvDownload(c.env, key);
  if (!response) return c.json({ error: 'Export not found or expired' }, 404);
  return response;
});

projects.post('/:id/exports/links', async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const project = await resolveProject(c.env.DB, c.req.param('id'));
  const body = await readBody(c);
  const range = dashboardDateRange(body);
  const activeFilter = body.active === undefined || body.active === null || body.active === ''
    ? ''
    : ' AND COALESCE(l.active, 0) = ?';
  const activeValues = activeFilter ? [toBool(body.active) ? 1 : 0] : [];
  const campaignFilter = body.campaign_id ? ' AND l.campaign_id = ?' : '';
  const campaignValues = body.campaign_id ? [Number(body.campaign_id)] : [];
  const rows = await c.env.DB.prepare(`
    SELECT l.id, l.title, l.path, l.active, l.campaign_id, l.created_at,
      COALESCE(SUM(CASE WHEN e.event = 'view' THEN 1 ELSE 0 END), 0) AS views,
      COALESCE(SUM(CASE WHEN e.event = 'open' THEN 1 ELSE 0 END), 0) AS opens,
      COALESCE(SUM(CASE WHEN e.event = 'install' THEN 1 ELSE 0 END), 0) AS installs,
      COALESCE(SUM(CASE WHEN e.event = 'reinstall' THEN 1 ELSE 0 END), 0) AS reinstalls,
      COALESCE(SUM(CASE WHEN e.event = 'app_open' THEN 1 ELSE 0 END), 0) AS app_opens,
      COALESCE(SUM(CASE WHEN e.event = 'user_referred' THEN 1 ELSE 0 END), 0) AS user_referred,
      COALESCE(SUM(CASE WHEN pe.event_type IN ('buy', 'refund_reversed') THEN COALESCE(pe.usd_price_cents, pe.price_cents, 0) * COALESCE(pe.quantity, 1) ELSE 0 END), 0) AS revenue_cents
    FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    LEFT JOIN events e ON e.link_id = l.id AND date(e.created_at) BETWEEN ? AND ?
    LEFT JOIN purchase_events pe ON pe.link_id = l.id AND pe.project_id = rc.project_id AND date(COALESCE(pe.date, pe.created_at)) BETWEEN ? AND ?
    WHERE rc.project_id = ?
      ${activeFilter}
      ${campaignFilter}
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `).bind(range.startDate, range.endDate, range.startDate, range.endDate, project.id, ...activeValues, ...campaignValues).all<any>();
  const csv = [
    csvLine(['id', 'title', 'path', 'active', 'campaign_id', 'views', 'opens', 'installs', 'reinstalls', 'app_opens', 'user_referred', 'revenue_cents', 'created_at']),
    ...(rows.results || []).map((row: any) => csvLine([
      row.id,
      row.title || '',
      row.path,
      row.active === 1,
      row.campaign_id || '',
      row.views,
      row.opens,
      row.installs,
      row.reinstalls,
      row.app_opens,
      row.user_referred,
      row.revenue_cents,
      row.created_at,
    ])),
  ].join('\n');
  const file = await storeCsvDownload(c, { projectId: project.id, prefix: 'links_data', csv });
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
    .bind(userId).first<{ email: string }>();
  if (user?.email) {
    await sendMail(c.env, downloadFileMessage(c.env, user.email, file.name, file.url));
  }
  return c.json({ message: "Export job has been queued. You will be notified when it's ready.", url: file.url }, 202);
});

export default projects;
