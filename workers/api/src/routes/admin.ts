import { Hono } from 'hono';
import { Env } from '../types';
import { getOrCreateRedirectConfig, parseJsonObject, resolveProject } from '../lib/db';
import { runMaintenance } from '../lib/maintenance';

const admin = new Hono<{ Bindings: Env }>();

type ProjectRecord = {
  id: number;
  instance_id: number;
  is_test: number;
  name: string;
  identifier: string;
};

function adminDenied(c: any): Response | null {
  const expected = c.env.ADMIN_API_KEY;
  const provided = c.req.header('X-AUTH') || c.req.header('x-auth');
  if (!expected || provided !== expected) return c.json({ error: 'Invalid credentials' }, 403);
  return null;
}

async function readBody(c: any): Promise<Record<string, any>> {
  const type = c.req.header('content-type') || '';
  if (type.includes('multipart/form-data')) return await c.req.parseBody().catch(() => ({}));
  if (type.includes('application/json')) return await c.req.json().catch(() => ({}));
  return await c.req.parseBody().catch(() => ({}));
}

function toBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function serializeSubscription(row: any) {
  return {
    id: row.id,
    instance_id: Number(row.instance_id),
    start_date: row.start_date || row.starts_at,
    end_date: row.end_date || row.ends_at,
    total_maus: Number(row.total_maus || 0),
    active: toBool(row.active, row.status !== 'inactive'),
    status: row.status || (toBool(row.active, true) ? 'active' : 'inactive'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function csvRows(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(value);
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  const headers = (rows.shift() || []).map((header) => header.trim());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] || '').trim()])));
}

function uriSchemeFromPrefix(prefix: string): string {
  return `${prefix.replace(/^https?:\/\//, '').replace(/\/$/, '')}://`;
}

function stripPrefix(value: string, prefix?: string): string {
  if (!prefix) return value.trim();
  return value.replace(prefix, '').trim().replace(/^\/+/, '');
}

async function projectByAdminParam(db: D1Database, raw: unknown): Promise<ProjectRecord | null> {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/-prod$|-test$/.test(value)) {
    const resolved = await resolveProject(db, value);
    return db.prepare('SELECT * FROM projects WHERE id = ? LIMIT 1').bind(resolved.id).first<ProjectRecord>();
  }
  return db.prepare('SELECT * FROM projects WHERE id = ? LIMIT 1').bind(value).first<ProjectRecord>();
}

async function domainForProject(db: D1Database, projectId: number): Promise<number> {
  const existing = await db.prepare('SELECT id FROM domains WHERE project_id = ? ORDER BY id ASC LIMIT 1')
    .bind(projectId).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db.prepare(
    'INSERT INTO domains (domain, project_id) VALUES (?, ?) RETURNING id'
  ).bind('go.vocostar.com', projectId).first<{ id: number }>();
  if (!created) throw new Error('Unable to create project domain');
  return created.id;
}

admin.post('/create_enterprise_subscription', async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const body = await readBody(c);
  const missing = ['start_date', 'end_date', 'total_maus'].filter((key) => body[key] === undefined || body[key] === null || body[key] === '');
  if (missing.length) return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 422);

  const instance = await c.env.DB.prepare('SELECT id FROM instances WHERE id = ? LIMIT 1').bind(body.instance_id).first<{ id: number }>();
  if (!instance) return c.json({ error: 'Instance not found' }, 404);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM enterprise_subscriptions WHERE instance_id = ? AND (active = 1 OR status = 'active') LIMIT 1"
  ).bind(instance.id).first();
  if (existing) return c.json({ error: 'Instance already has an active subscription' }, 422);

  const active = toBool(body.active, true);
  const row = await c.env.DB.prepare(`
    INSERT INTO enterprise_subscriptions (
      instance_id, start_date, end_date, total_maus, active,
      starts_at, ends_at, status, metadata, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
    RETURNING *
  `).bind(
    instance.id,
    String(body.start_date),
    String(body.end_date),
    Number(body.total_maus),
    active ? 1 : 0,
    String(body.start_date),
    String(body.end_date),
    active ? 'active' : 'inactive',
  ).first<any>();

  return c.json({ message: 'Enterprise Subscription created successfully', subscription: serializeSubscription(row) }, 201);
});

admin.patch('/update_enterprise_subscription', async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const body = await readBody(c);
  const current = await c.env.DB.prepare('SELECT * FROM enterprise_subscriptions WHERE id = ? LIMIT 1').bind(body.id).first<any>();
  if (!current) return c.json({ error: 'Enterprise Subscription not found' }, 404);
  const active = body.active === undefined ? toBool(current.active, current.status !== 'inactive') : toBool(body.active, true);
  await c.env.DB.prepare(`
    UPDATE enterprise_subscriptions
    SET active = ?, status = ?, start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date),
        total_maus = COALESCE(?, total_maus), starts_at = COALESCE(?, starts_at), ends_at = COALESCE(?, ends_at),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    active ? 1 : 0,
    active ? 'active' : 'inactive',
    body.start_date || null,
    body.end_date || null,
    body.total_maus === undefined ? null : Number(body.total_maus),
    body.start_date || null,
    body.end_date || null,
    body.id,
  ).run();
  const row = await c.env.DB.prepare('SELECT * FROM enterprise_subscriptions WHERE id = ?').bind(body.id).first<any>();
  return c.json({ message: 'Enterprise Subscription updated successfully', subscription: serializeSubscription(row) });
});

admin.post('/migrate_firebase_links', async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const body = await readBody(c);
  const file = body.file as File | string | undefined;
  const contentType = typeof file === 'object' && 'type' in file ? file.type : c.req.header('content-type') || '';
  if (!file || (typeof file === 'object' && contentType !== 'text/csv' && !contentType.includes('csv'))) {
    return c.json({ error: 'Please upload a valid CSV file.' }, 422);
  }

  const project = await projectByAdminParam(c.env.DB, body.project_id);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const domainId = await domainForProject(c.env.DB, project.id);
  const redirectConfigId = await getOrCreateRedirectConfig(c.env.DB, project.id);
  const text = typeof file === 'string' ? file : await file.text();
  const created: any[] = [];
  const skipped: any[] = [];

  for (const row of csvRows(text)) {
    const linkName = row.name || '';
    const shortLink = row.short_link || '';
    const originalDeeplink = row.link || '';
    const deeplink = body.deeplink_prefix
      ? originalDeeplink.replace(String(body.deeplink_prefix), uriSchemeFromPrefix(String(body.deeplink_prefix)))
      : originalDeeplink;
    const path = stripPrefix(shortLink, body.short_link_prefix ? String(body.short_link_prefix) : undefined);

    if (!path) {
      skipped.push({ reason: 'blank_path', name: linkName, path });
      continue;
    }

    const duplicate = await c.env.DB.prepare('SELECT id FROM links WHERE domain_id = ? AND path = ? LIMIT 1')
      .bind(domainId, path).first();
    if (duplicate) {
      skipped.push({ reason: 'duplicate_on_domain', name: linkName, path });
      continue;
    }

    const link = await c.env.DB.prepare(`
      INSERT INTO links (
        name, title, path, generated_from_platform, domain_id, active, redirect_config_id,
        tracking_campaign, tracking_medium, tracking_source, data, created_at, updated_at
      )
      VALUES (?, ?, ?, 'dashboard', ?, 1, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      RETURNING *
    `).bind(
      linkName,
      linkName,
      path,
      domainId,
      redirectConfigId,
      row.utm_campaign || null,
      row.utm_medium || null,
      row.utm_source || null,
      JSON.stringify({ appLink: deeplink }),
    ).first<any>();
    created.push({
      id: String(link.id),
      name: link.name || link.title,
      path: link.path,
      data: parseJsonObject(link.data) || {},
    });
  }

  return c.json({ created_count: created.length, skipped_count: skipped.length, skipped, links: created });
});

admin.post('/flush_events', async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const body = await readBody(c);
  const days = Math.max(1, Math.min(7, Number(body.aggregate_days || 1)));
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const processed = await c.env.DB.prepare(
    'UPDATE events SET processed = 1, updated_at = datetime("now") WHERE COALESCE(processed, 0) = 0 AND datetime(created_at) >= datetime(?)'
  ).bind(cutoff).run();
  const discarded = await c.env.DB.prepare(
    'UPDATE events SET processed = -1, updated_at = datetime("now") WHERE COALESCE(processed, 0) = 0 AND datetime(created_at) < datetime(?)'
  ).bind(cutoff).run();
  const summary = await runMaintenance(c.env, days);
  return c.json({
    message: 'Events flushed and metrics aggregated',
    processed: processed.meta?.changes || 0,
    discarded: discarded.meta?.changes || 0,
    dates_aggregated: summary.dates,
  });
});

export default admin;
