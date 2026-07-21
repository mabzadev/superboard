import { Hono } from 'hono';
import { Env } from '../types';
import { authMiddleware } from '../middleware/auth';

const analytics = new Hono<{ Bindings: Env; Variables: { userId: number; instanceId: number } }>();
analytics.use('*', authMiddleware);

// GET /api/v1/analytics/overview?project_id=X&period=30d
analytics.get('/overview', async (c) => {
  const projectId = c.req.query('project_id');
  const period = c.req.query('period') || '30d';
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  if (!projectId) return c.json({ error: 'project_id required' }, 422);

  // Aggregate totals from events table (live, no pre-aggregation needed)
  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(CASE WHEN event = 'install' THEN 1 END) as total_installs,
      COUNT(CASE WHEN event = 'open' THEN 1 END) as total_opens,
      COUNT(CASE WHEN event = 'view' THEN 1 END) as total_views,
      COUNT(DISTINCT device_id) as unique_devices
    FROM events
    WHERE project_id = ?
    AND created_at > datetime('now', '-${days} days')
  `).bind(projectId).first<{
    total_installs: number;
    total_opens: number;
    total_views: number;
    unique_devices: number;
  }>();

  // Daily breakdown
  const { results: daily } = await c.env.DB.prepare(`
    SELECT
      date(created_at) as date,
      COUNT(CASE WHEN event = 'install' THEN 1 END) as installs,
      COUNT(CASE WHEN event = 'open' THEN 1 END) as opens,
      COUNT(CASE WHEN event = 'view' THEN 1 END) as views,
      COUNT(DISTINCT device_id) as unique_devices
    FROM events
    WHERE project_id = ?
    AND created_at > datetime('now', '-${days} days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).bind(projectId).all();

  return c.json({ totals, daily, period });
});

// GET /api/v1/analytics/links?project_id=X
analytics.get('/links', async (c) => {
  const projectId = c.req.query('project_id');
  const period = c.req.query('period') || '30d';
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  if (!projectId) return c.json({ error: 'project_id required' }, 422);

  const { results } = await c.env.DB.prepare(`
    SELECT
      l.id, l.path, l.title, l.tracking_source, l.tracking_campaign,
      COUNT(CASE WHEN e.event = 'view' THEN 1 END) as views,
      COUNT(CASE WHEN e.event = 'install' THEN 1 END) as installs,
      COUNT(CASE WHEN e.event = 'open' THEN 1 END) as opens,
      COUNT(DISTINCT e.device_id) as unique_devices
    FROM links l
    LEFT JOIN events e ON e.link_id = l.id
      AND e.created_at > datetime('now', '-${days} days')
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id = ?
    GROUP BY l.id
    ORDER BY views DESC
    LIMIT 50
  `).bind(projectId).all();

  return c.json({ links: results, period });
});

// GET /api/v1/projects — liste les projets de l'instance
analytics.get('/projects', async (c) => {
  const instanceId = c.get('instanceId');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM projects WHERE instance_id = ? ORDER BY created_at DESC'
  ).bind(instanceId).all();
  return c.json({ projects: results });
});

// POST /api/v1/projects
analytics.post('/projects', async (c) => {
  const instanceId = c.get('instanceId');
  const { name } = await c.req.json<{ name: string }>();
  if (!name) return c.json({ error: 'name required' }, 422);

  const identifier = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36);
  const project = await c.env.DB.prepare(
    'INSERT INTO projects (name, identifier, instance_id) VALUES (?, ?, ?) RETURNING *'
  ).bind(name, identifier, instanceId).first();

  return c.json({ project }, 201);
});

export default analytics;
