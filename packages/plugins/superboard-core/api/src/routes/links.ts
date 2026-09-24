import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware } from '../middleware/auth';
import { generateShortCode } from '../lib/crypto';

const links = new Hono<{ Bindings: Env; Variables: { userId: number; instanceId: number } }>();
links.use('*', authMiddleware);

// GET /api/v1/links — list every project link
links.get('/', async (c) => {
  const projectId = c.req.query('project_id');
  const page = parseInt(c.req.query('page') || '1');
  const perPage = parseInt(c.req.query('per_page') || '20');
  const offset = (page - 1) * perPage;

  if (!projectId) return c.json({ error: 'project_id required' }, 422);

  const { results } = await c.env.DB.prepare(`
    SELECT l.*, rc.default_fallback
    FROM links l
    LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ?
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(projectId, perPage, offset).all();

  const { results: [{ count }] } = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM links l LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id WHERE rc.project_id = ?'
  ).bind(projectId).all<{ count: number }>();

  return c.json({ links: results, meta: { total: count, page, per_page: perPage } });
});

// POST /api/v1/links — Create a link.
links.post('/', async (c) => {
  const body = await c.req.json<{
    project_id: number;
    title?: string;
    subtitle?: string;
    image_url?: string;
    data?: Record<string, unknown>;
    tracking_source?: string;
    tracking_medium?: string;
    tracking_campaign?: string;
    ios_url?: string;
    android_url?: string;
    fallback_url?: string;
    tags?: string[];
  }>();

  if (!body.project_id) return c.json({ error: 'project_id required' }, 422);

  // Get or create redirect_config for project
  let redirectConfig = await c.env.DB.prepare(
    'SELECT id FROM redirect_configs WHERE project_id = ?'
  ).bind(body.project_id).first<{ id: number }>();

  if (!redirectConfig) {
    const result = await c.env.DB.prepare(
      'INSERT INTO redirect_configs (project_id, default_fallback) VALUES (?, ?) RETURNING id'
    ).bind(body.project_id, body.fallback_url || null).first<{ id: number }>();
    redirectConfig = result!;
  }

  // Generate unique short code
  let path = generateShortCode();
  let exists = await c.env.DB.prepare('SELECT id FROM links WHERE path = ?').bind(path).first();
  while (exists) {
    path = generateShortCode();
    exists = await c.env.DB.prepare('SELECT id FROM links WHERE path = ?').bind(path).first();
  }

  const link = await c.env.DB.prepare(`
    INSERT INTO links (path, title, subtitle, image_url, data, tags, redirect_config_id, tracking_source, tracking_medium, tracking_campaign, generated_from_platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dashboard')
    RETURNING *
  `).bind(
    path,
    body.title || null,
    body.subtitle || null,
    body.image_url || null,
    body.data ? JSON.stringify(body.data) : null,
    JSON.stringify(body.tags || []),
    redirectConfig.id,
    body.tracking_source || null,
    body.tracking_medium || null,
    body.tracking_campaign || null,
  ).first();

  // Add platform-specific redirects if provided
  if (body.ios_url) {
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO custom_redirects (link_id, platform, url) VALUES (?, ?, ?)'
    ).bind((link as { id: number }).id, 'ios', body.ios_url).run();
  }
  if (body.android_url) {
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO custom_redirects (link_id, platform, url) VALUES (?, ?, ?)'
    ).bind((link as { id: number }).id, 'android', body.android_url).run();
  }

  const domain = c.env.SHORTLINK_DOMAIN;
  return c.json({ link, short_url: `https://${domain}/${path}` }, 201);
});

// GET /api/v1/links/:id
links.get('/:id', async (c) => {
  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(c.req.param('id')).first();
  if (!link) return c.json({ error: 'Not found' }, 404);

  const redirects = await c.env.DB.prepare(
    'SELECT * FROM custom_redirects WHERE link_id = ?'
  ).bind(c.req.param('id')).all();

  const domain = c.env.SHORTLINK_DOMAIN;
  return c.json({ link, redirects: redirects.results, short_url: `https://${domain}/${(link as { path: string }).path}` });
});

// PATCH /api/v1/links/:id
links.patch('/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const allowed = ['title', 'subtitle', 'image_url', 'data', 'tags', 'active', 'tracking_source', 'tracking_medium', 'tracking_campaign'];
  const updates = Object.entries(body).filter(([k]) => allowed.includes(k));

  if (updates.length === 0) return c.json({ error: 'No valid fields' }, 422);

  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ');
  const values = updates.map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : v);

  await c.env.DB.prepare(
    `UPDATE links SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...values, c.req.param('id')).run();

  const link = await c.env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(c.req.param('id')).first();
  return c.json({ link });
});

// DELETE /api/v1/links/:id
links.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM links WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default links;
