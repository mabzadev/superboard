import { Hono } from 'hono';
import { Env } from '../types';
import { getOrCreateRedirectConfig, parseJsonObject, resolveProject } from '../lib/db';
import { runMaintenance } from '../lib/maintenance';
import { decryptCredential, encryptSecret, timingSafeEqual } from '../lib/secrets';
import { domainError } from '../lib/domain-modules';
import { readRequestObjectLimited } from '@opengrow/contracts/request-body';

const admin = new Hono<{ Bindings: Env }>();

type ProjectRecord = {
  id: number;
  instance_id: number;
  is_test: number;
  name: string;
  identifier: string;
};

async function adminDenied(c: any): Promise<Response | null> {
  const expected = c.env.ADMIN_API_KEY;
  const provided = c.req.header('X-AUTH') || c.req.header('x-auth');
  if (!expected || !provided || !await timingSafeEqual(expected, provided)) return c.json({ error: 'Invalid credentials' }, 403);
  return null;
}

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 10 * 1024 * 1024);
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

function requestId(c: any): string {
  const provided = String(c.req.header('X-Request-Id') || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(provided) ? provided : crypto.randomUUID();
}

async function cutoverDenied(c: any): Promise<Response | null> {
  const expected = c.env.OPENGROW_CUTOVER_TOKEN;
  const authorization = String(c.req.header('Authorization') || '').trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
  if (!expected || !bearer || !await timingSafeEqual(expected, bearer)) {
    return domainError(requestId(c), 403, 'cutover_forbidden', 'Invalid cutover credentials');
  }
  return null;
}

async function cutoverProject(db: D1Database, raw: string): Promise<ProjectRecord | null> {
  const match = /^(\d+)-(prod|test)$/.exec(raw);
  if (!match) return null;
  return db.prepare(
    'SELECT id, instance_id, is_test, name, identifier FROM projects WHERE instance_id = ? AND is_test = ? LIMIT 1'
  ).bind(Number(match[1]), match[2] === 'test' ? 1 : 0).first<ProjectRecord>();
}

admin.get('/module-cutover/maintenance/:projectRef', async (c) => {
  const denied = await cutoverDenied(c);
  if (denied) return denied;
  const id = requestId(c);
  const project = await cutoverProject(c.env.DB, c.req.param('projectRef'));
  if (!project) return domainError(id, 404, 'project_not_found', 'Project was not found');
  const state = await c.env.DB.prepare(
    'SELECT enabled, window_id, reason, updated_by, updated_at FROM module_cutover_maintenance WHERE project_id = ? LIMIT 1'
  ).bind(project.id).first<Record<string, unknown>>();
  return c.json({
    data: {
      project_ref: c.req.param('projectRef'),
      project_id: project.id,
      enabled: Number(state?.enabled ?? 0) === 1,
      window_id: state?.window_id ?? null,
      reason: state?.reason ?? null,
      updated_by: state?.updated_by ?? null,
      updated_at: state?.updated_at ?? null,
    },
  }, 200, { 'X-Request-Id': id, 'Cache-Control': 'no-store' });
});

admin.put('/module-cutover/maintenance/:projectRef', async (c) => {
  const denied = await cutoverDenied(c);
  if (denied) return denied;
  const id = requestId(c);
  const project = await cutoverProject(c.env.DB, c.req.param('projectRef'));
  if (!project) return domainError(id, 404, 'project_not_found', 'Project was not found');
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return domainError(id, 422, 'maintenance_state_invalid', 'enabled must be a boolean');
  }
  const windowId = String(body.window_id ?? '').trim();
  const reason = String(body.reason ?? '').trim();
  if (body.enabled && (!windowId || !reason)) {
    return domainError(id, 422, 'maintenance_context_required', 'window_id and reason are required when enabling maintenance');
  }
  if (windowId.length > 128 || reason.length > 1_000) {
    return domainError(id, 422, 'maintenance_context_invalid', 'Maintenance context is too long');
  }
  const actor = 'admin_api';
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO module_cutover_maintenance (project_id, enabled, window_id, reason, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled, window_id=excluded.window_id,
        reason=excluded.reason, updated_by=excluded.updated_by, updated_at=excluded.updated_at
    `).bind(project.id, body.enabled ? 1 : 0, windowId || null, reason || null, actor),
    c.env.DB.prepare(`
      INSERT INTO module_cutover_audit (id, project_id, action, actor, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), project.id, body.enabled ? 'maintenance.enabled' : 'maintenance.disabled', actor, JSON.stringify({ window_id: windowId || null, reason: reason || null, request_id: id })),
  ]);
  return c.json({ data: { project_ref: c.req.param('projectRef'), project_id: project.id, enabled: body.enabled, window_id: windowId || null, reason: reason || null } }, 200, { 'X-Request-Id': id, 'Cache-Control': 'no-store' });
});

async function domainForProject(db: D1Database, projectId: number, shortlinkDomain: string): Promise<number> {
  const existing = await db.prepare('SELECT id FROM domains WHERE project_id = ? ORDER BY id ASC LIMIT 1')
    .bind(projectId).first<{ id: number }>();
  if (existing) return existing.id;
  const created = await db.prepare(
    'INSERT INTO domains (domain, project_id) VALUES (?, ?) RETURNING id'
  ).bind(shortlinkDomain, projectId).first<{ id: number }>();
  if (!created) throw new Error('Unable to create project domain');
  return created.id;
}

admin.post('/migrate_firebase_links', async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const body = await readBody(c);
  const file = body.file as File | string | undefined;
  const contentType = typeof file === 'object' && 'type' in file ? file.type : c.req.header('content-type') || '';
  if (!file || (typeof file === 'object' && contentType !== 'text/csv' && !contentType.includes('csv'))) {
    return c.json({ error: 'Please upload a valid CSV file.' }, 422);
  }

  const project = await projectByAdminParam(c.env.DB, body.project_id);
  if (!project) return c.json({ error: 'Project not found' }, 404);
  const domainId = await domainForProject(c.env.DB, project.id, c.env.SHORTLINK_DOMAIN);
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
  const denied = await adminDenied(c);
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

admin.post('/billing/rewrap_credentials', async (c) => {
  const denied = await adminDenied(c);
  if (denied) return denied;
  const targetKey = c.env.BILLING_CREDENTIALS_REWRAP_KEY;
  if (!targetKey) return c.json({ error: 'Billing credential rewrap key is unavailable' }, 503);
  const body = await readBody(c);
  const targetVersion = String(body.target_version || 'billing-v1');
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(targetVersion)) return c.json({ error: 'Invalid target key version' }, 422);
  const sources = [
    { table: 'ios_server_api_keys', rows: await c.env.DB.prepare('SELECT id, encrypted_key FROM ios_server_api_keys WHERE encrypted_key IS NOT NULL').all<{ id: string; encrypted_key: string }>() },
    { table: 'android_server_api_keys', rows: await c.env.DB.prepare('SELECT id, encrypted_key FROM android_server_api_keys WHERE encrypted_key IS NOT NULL').all<{ id: string; encrypted_key: string }>() },
  ] as const;
  const updates: D1PreparedStatement[] = [];
  const counts: Record<string, number> = {};
  for (const source of sources) {
    counts[source.table] = source.rows.results?.length || 0;
    for (const row of source.rows.results || []) {
      const clear = await decryptCredential(c.env, row.encrypted_key);
      const encrypted = await encryptSecret(clear, targetKey);
      const scoped = `${targetVersion}.${encrypted.slice('v1.'.length)}`;
      updates.push(
        c.env.DB.prepare(`UPDATE ${source.table} SET billing_encrypted_key = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(scoped, row.id),
        c.env.DB.prepare(`
          INSERT INTO billing_credential_rewrap_audit
            (id, source_table, source_id, target_key_version, actor)
          VALUES (?, ?, ?, ?, 'admin_api')
        `).bind(crypto.randomUUID(), source.table, row.id, targetVersion),
      );
    }
  }
  if (updates.length) await c.env.DB.batch(updates);
  return c.json({ rewrapped: counts, target_version: targetVersion, plaintext_exposed: false });
});

export default admin;
