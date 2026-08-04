import { Hono } from 'hono';
import { claimRun, evaluateEvent, markRun, releaseRun } from './automations';
import {
  listOfficialMetadataProjects,
  listOfficialMetadataTargets,
  persistOfficialMetadataSnapshot,
} from './official-metadata';
import { audit, enqueueAllProjects, syncProject } from './sync';
import { AUTOMATION_ACTIONS, AUTOMATION_TRIGGERS, AUTOMATION_TRIGGER_ACTIONS, type Env, type GrowthQueueJob } from './types';
import {
  automationAction,
  automationConfig,
  assertAutomationCompatibility,
  automationTrigger,
  booleanFlag,
  boundedJson,
  device,
  failure,
  jsonObject,
  locale,
  optionalString,
  platform,
  positiveInt,
  requiredString,
} from './validation';

const app = new Hono<{ Bindings: Env; Variables: { actorId: string } }>();

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM growth_apps WHERE enabled = 1) AS apps,
      (SELECT COUNT(*) FROM growth_keywords WHERE enabled = 1) AS keywords,
      (SELECT COUNT(*) FROM growth_competitors WHERE enabled = 1) AS competitors,
      (SELECT COUNT(*) FROM growth_automations WHERE enabled = 1) AS automations
  `).first<Record<string, number>>().catch(() => null);
  return c.json({
    status: row ? 'ok' : 'unavailable',
    service: 'opengrow-growth',
    environment: c.env.ENVIRONMENT,
    advanced_provider_configured: Boolean(c.env.APPTWEAK_API_KEY),
    counts: row || {},
  }, row ? 200 : 503);
});

app.use('/internal/*', async (c, next) => {
  const provided = c.req.header('X-OpenGrow-Internal-Token') || '';
  if (!c.env.GROWTH_INTERNAL_TOKEN || !(await constantTimeEqual(provided, c.env.GROWTH_INTERNAL_TOKEN))) {
    throw failure('internal_auth_failed', 'Internal authentication failed', 401);
  }
  c.set('actorId', c.req.header('X-OpenGrow-Actor-Id') || 'system');
  await next();
});

const contracts = (env: Env) => ({
  data: {
    platforms: [
      { id: 'apple', devices: ['iphone', 'ipad'], public_metadata: true, official_owned_metadata: true },
      { id: 'google', devices: ['android'], public_metadata: false, official_owned_metadata: true },
    ],
    sources: [
      { id: 'app_store_connect', configuration_scope: 'project_store_connection', capabilities: ['official_owned_metadata'] },
      { id: 'google_play', configuration_scope: 'project_store_connection', capabilities: ['official_owned_metadata'] },
      { id: 'apple_lookup', configured: true, capabilities: ['public_metadata'] },
      { id: 'apptweak', configured: Boolean(env.APPTWEAK_API_KEY), capabilities: ['metadata', 'keyword_rank', 'keyword_volume', 'keyword_difficulty'] },
    ],
    automation_triggers: AUTOMATION_TRIGGERS,
    automation_actions: AUTOMATION_ACTIONS,
    automation_trigger_actions: AUTOMATION_TRIGGER_ACTIONS,
    limits: { app_identifiers_per_request: 5, keywords_per_request: 5, list_page_size: 250 },
  },
});
app.get('/internal/contracts', (c) => c.json(contracts(c.env)));
app.get('/internal/projects/:projectId/contracts', (c) => {
  project(c);
  return c.json(contracts(c.env));
});

app.get('/internal/official-metadata/projects', async (c) => {
  return c.json({ data: await listOfficialMetadataProjects(c.env) });
});

app.get('/internal/official-metadata/targets', async (c) => {
  const projectId = positiveInt(c.req.query('project_id'), 'project_id');
  return c.json({ data: await listOfficialMetadataTargets(c.env, projectId) });
});

app.post('/internal/projects/:projectId/official-metadata/snapshots', async (c) => {
  const data = await persistOfficialMetadataSnapshot(
    c.env,
    project(c),
    await boundedJson(c.req.raw),
    c.get('actorId'),
  );
  return c.json({ data }, 201);
});

app.get('/internal/projects/:projectId/overview', async (c) => {
  const projectId = project(c);
  const [counts, keywordTrend, recommendations, recentRuns] = await Promise.all([
    c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM growth_apps WHERE project_id = ?) AS apps,
        (SELECT COUNT(*) FROM growth_keywords WHERE project_id = ? AND enabled = 1) AS keywords,
        (SELECT COUNT(*) FROM growth_competitors WHERE project_id = ? AND enabled = 1) AS competitors,
        (SELECT COUNT(*) FROM growth_recommendations WHERE project_id = ? AND status = 'open') AS recommendations,
        (SELECT COUNT(*) FROM growth_automations WHERE project_id = ? AND enabled = 1) AS active_automations
    `).bind(projectId, projectId, projectId, projectId, projectId).first<Record<string, number>>(),
    c.env.DB.prepare(`
      SELECT k.keyword, s.rank, s.volume, s.difficulty, s.observed_date
      FROM growth_keywords k LEFT JOIN growth_keyword_snapshots s ON s.keyword_id = k.id
      WHERE k.project_id = ? AND (s.observed_date IS NULL OR s.observed_date = (
        SELECT MAX(s2.observed_date) FROM growth_keyword_snapshots s2 WHERE s2.keyword_id = k.id
      )) ORDER BY COALESCE(s.volume, 0) DESC, k.keyword LIMIT 20
    `).bind(projectId).all(),
    c.env.DB.prepare(`
      SELECT * FROM growth_recommendations WHERE project_id = ? AND status = 'open'
      ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC LIMIT 20
    `).bind(projectId).all(),
    c.env.DB.prepare(`
      SELECT r.id, r.status, r.created_at, r.updated_at, a.name, a.action_type
      FROM growth_automation_runs r JOIN growth_automations a ON a.id = r.automation_id
      WHERE r.project_id = ? ORDER BY r.created_at DESC LIMIT 20
    `).bind(projectId).all(),
  ]);
  return c.json({ data: { counts: counts || {}, keywords: keywordTrend.results, recommendations: recommendations.results, automation_runs: recentRuns.results } });
});

app.get('/internal/projects/:projectId/apps', async (c) => listRows(c, 'growth_apps'));
app.post('/internal/projects/:projectId/apps', async (c) => createStoreEntity(c, 'growth_apps'));
app.patch('/internal/projects/:projectId/apps/:id', async (c) => updateStoreEntity(c, 'growth_apps'));
app.delete('/internal/projects/:projectId/apps/:id', async (c) => deleteRow(c, 'growth_apps', 'app'));

app.get('/internal/projects/:projectId/competitors', async (c) => listRows(c, 'growth_competitors'));
app.post('/internal/projects/:projectId/competitors', async (c) => createStoreEntity(c, 'growth_competitors'));
app.patch('/internal/projects/:projectId/competitors/:id', async (c) => updateStoreEntity(c, 'growth_competitors'));
app.delete('/internal/projects/:projectId/competitors/:id', async (c) => deleteRow(c, 'growth_competitors', 'competitor'));

app.get('/internal/projects/:projectId/keywords', async (c) => {
  const projectId = project(c);
  const rows = await c.env.DB.prepare(`
    SELECT k.*, a.platform, a.app_identifier, a.display_name AS app_name,
      s.rank, s.volume, s.search_popularity, s.difficulty, s.installs,
      s.relevancy, s.chance, s.kei, s.source, s.observed_date
    FROM growth_keywords k JOIN growth_apps a ON a.id = k.app_id
    LEFT JOIN growth_keyword_snapshots s ON s.keyword_id = k.id AND s.observed_date = (
      SELECT MAX(s2.observed_date) FROM growth_keyword_snapshots s2 WHERE s2.keyword_id = k.id
    ) WHERE k.project_id = ? ORDER BY k.keyword LIMIT 250
  `).bind(projectId).all();
  return c.json({ data: rows.results });
});

app.post('/internal/projects/:projectId/keywords', async (c) => {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const appId = requiredString(body.app_id, 'app_id', 64);
  const storeApp = await c.env.DB.prepare('SELECT country, language FROM growth_apps WHERE id = ? AND project_id = ?')
    .bind(appId, projectId).first<{ country: string; language: string }>();
  if (!storeApp) throw failure('app_not_found', 'App not found', 404);
  const keyword = requiredString(body.keyword, 'keyword', 100).toLocaleLowerCase();
  const country = locale(body.country, 'country', storeApp.country);
  const language = locale(body.language, 'language', storeApp.language);
  const id = crypto.randomUUID();
  try {
    const row = await c.env.DB.prepare(`
      INSERT INTO growth_keywords (id, project_id, app_id, keyword, country, language, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
    `).bind(id, projectId, appId, keyword, country, language, booleanFlag(body.enabled, true) ? 1 : 0).first();
    await audit(c.env, projectId, 'growth.keyword.created', 'keyword', id, row, c.get('actorId'));
    return c.json({ data: row }, 201);
  } catch (error) {
    throw mapConstraint(error, 'keyword_exists', 'This keyword is already tracked for the selected app and locale');
  }
});

app.patch('/internal/projects/:projectId/keywords/:id', async (c) => {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const enabled = body.enabled == null ? null : booleanFlag(body.enabled);
  const row = await c.env.DB.prepare(`
    UPDATE growth_keywords SET enabled = COALESCE(?, enabled), updated_at = datetime('now')
    WHERE id = ? AND project_id = ? RETURNING *
  `).bind(enabled == null ? null : enabled ? 1 : 0, c.req.param('id'), projectId).first();
  if (!row) throw failure('keyword_not_found', 'Keyword not found', 404);
  await audit(c.env, projectId, 'growth.keyword.updated', 'keyword', c.req.param('id'), body, c.get('actorId'));
  return c.json({ data: row });
});

app.delete('/internal/projects/:projectId/keywords/:id', async (c) => deleteRow(c, 'growth_keywords', 'keyword'));

app.post('/internal/projects/:projectId/sync', async (c) => {
  const projectId = project(c);
  await c.env.GROWTH_QUEUE.send({ type: 'growth.project.sync', projectId });
  await audit(c.env, projectId, 'growth.sync.queued', 'project', String(projectId), {}, c.get('actorId'));
  return c.json({ data: { status: 'queued' } }, 202);
});

app.get('/internal/projects/:projectId/recommendations', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT * FROM growth_recommendations WHERE project_id = ? ORDER BY updated_at DESC LIMIT 250
  `).bind(project(c)).all();
  return c.json({ data: rows.results });
});

app.patch('/internal/projects/:projectId/recommendations/:id', async (c) => {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const status = requiredString(body.status, 'status', 32);
  if (!['open', 'dismissed', 'completed'].includes(status)) throw failure('status_invalid', 'Unsupported recommendation status');
  const row = await c.env.DB.prepare(`
    UPDATE growth_recommendations SET status = ?, auto_resolved_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND project_id = ? RETURNING *
  `).bind(status, c.req.param('id'), projectId).first();
  if (!row) throw failure('recommendation_not_found', 'Recommendation not found', 404);
  await audit(c.env, projectId, 'growth.recommendation.updated', 'recommendation', c.req.param('id'), { status }, c.get('actorId'));
  return c.json({ data: row });
});

app.get('/internal/projects/:projectId/automations', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM growth_automation_runs r WHERE r.automation_id = a.id) AS run_count,
      (SELECT COUNT(*) FROM growth_automation_runs r WHERE r.automation_id = a.id AND r.status = 'failed') AS failed_count
    FROM growth_automations a WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 250
  `).bind(project(c)).all();
  return c.json({ data: rows.results.map(serializeAutomation) });
});

app.post('/internal/projects/:projectId/automations', async (c) => {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const id = crypto.randomUUID();
  const triggerConfig = automationConfig(body.trigger_config, 'trigger_config');
  const actionConfig = automationConfig(body.action_config, 'action_config');
  const triggerType = automationTrigger(body.trigger_type);
  const actionType = automationAction(body.action_type);
  assertAutomationCompatibility(triggerType, actionType);
  const row = await c.env.DB.prepare(`
    INSERT INTO growth_automations (
      id, project_id, name, trigger_type, action_type, trigger_config_json, action_config_json, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
  `).bind(
    id, projectId, requiredString(body.name, 'name', 120), triggerType, actionType,
    JSON.stringify(triggerConfig), JSON.stringify(actionConfig), booleanFlag(body.enabled, false) ? 1 : 0,
  ).first<Record<string, unknown>>();
  await audit(c.env, projectId, 'growth.automation.created', 'automation', id, { ...row, action_config_json: '[redacted]' }, c.get('actorId'));
  return c.json({ data: serializeAutomation(row || {}) }, 201);
});

app.patch('/internal/projects/:projectId/automations/:id', async (c) => {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const existing = await c.env.DB.prepare('SELECT * FROM growth_automations WHERE id = ? AND project_id = ?')
    .bind(c.req.param('id'), projectId).first<Record<string, unknown>>();
  if (!existing) throw failure('automation_not_found', 'Automation not found', 404);
  const name = body.name == null ? existing.name : requiredString(body.name, 'name', 120);
  const triggerType = body.trigger_type == null ? existing.trigger_type : automationTrigger(body.trigger_type);
  const actionType = body.action_type == null ? existing.action_type : automationAction(body.action_type);
  assertAutomationCompatibility(String(triggerType), String(actionType));
  const triggerConfig = body.trigger_config == null ? automationConfig(parseJson(existing.trigger_config_json), 'trigger_config') : automationConfig(body.trigger_config, 'trigger_config');
  const actionConfig = body.action_config == null ? automationConfig(parseJson(existing.action_config_json), 'action_config') : automationConfig(body.action_config, 'action_config');
  const enabled = body.enabled == null ? Number(existing.enabled) === 1 : booleanFlag(body.enabled);
  const row = await c.env.DB.prepare(`
    UPDATE growth_automations SET name = ?, trigger_type = ?, action_type = ?, trigger_config_json = ?,
      action_config_json = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = ? AND project_id = ? RETURNING *
  `).bind(name, triggerType, actionType, JSON.stringify(triggerConfig), JSON.stringify(actionConfig), enabled ? 1 : 0, c.req.param('id'), projectId).first<Record<string, unknown>>();
  await audit(c.env, projectId, 'growth.automation.updated', 'automation', c.req.param('id'), { ...body, action_config: body.action_config ? '[redacted]' : undefined }, c.get('actorId'));
  return c.json({ data: serializeAutomation(row || {}) });
});

app.delete('/internal/projects/:projectId/automations/:id', async (c) => deleteRow(c, 'growth_automations', 'automation'));
app.post('/internal/projects/:projectId/events', async (c) => c.json({ data: await evaluateEvent(c.env, project(c), await boundedJson(c.req.raw)) }, 202));
app.post('/internal/projects/:projectId/automation-runs/:id/claim', async (c) => c.json({ data: await claimRun(c.env, project(c), c.req.param('id')) }));
app.post('/internal/projects/:projectId/automation-runs/:id/release', async (c) => c.json({ data: await releaseRun(c.env, project(c), c.req.param('id'), await boundedJson(c.req.raw)) }));
app.patch('/internal/projects/:projectId/automation-runs/:id', async (c) => c.json({ data: await markRun(c.env, project(c), c.req.param('id'), await boundedJson(c.req.raw)) }));

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  if (status >= 500) console.error(JSON.stringify({ event: 'growth_request_failed', request_id: requestId, error: error.message }));
  return c.json({
    code: (error as { code?: string }).code || 'internal_error',
    message: status >= 500 ? 'Growth services are temporarily unavailable' : error.message,
    retryable: Boolean((error as { retryable?: boolean }).retryable ?? status >= 500),
    request_id: requestId,
  }, status as 400);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(env.GROWTH_QUEUE.send({ type: 'growth.all.sync' }));
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const job = message.body as GrowthQueueJob;
        if (job?.type === 'growth.project.sync') await syncProject(env, positiveInt(job.projectId, 'project_id'));
        else if (job?.type === 'growth.all.sync') await enqueueAllProjects(env);
        else throw failure('growth_job_invalid', 'Unsupported growth queue job', 422, false);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: 'growth_queue_failed', message_id: message.id, error: error instanceof Error ? error.message : String(error) }));
        if ((error as { retryable?: boolean }).retryable === false) message.ack();
        else message.retry({ delaySeconds: Number((error as { retryDelaySeconds?: number }).retryDelaySeconds || 60) });
      }
    }
  },
} satisfies ExportedHandler<Env>;

function project(c: any): number {
  return positiveInt(c.req.param('projectId'), 'project_id');
}

async function listRows(c: any, table: 'growth_apps' | 'growth_competitors') {
  const order = table === 'growth_apps' ? 'is_primary DESC, created_at DESC' : 'created_at DESC';
  const rows = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${order} LIMIT 250`)
    .bind(project(c)).all();
  return c.json({ data: rows.results });
}

async function createStoreEntity(c: any, table: 'growth_apps' | 'growth_competitors') {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const selectedPlatform = platform(body.platform);
  const selectedDevice = device(body.device, selectedPlatform);
  const isApp = table === 'growth_apps';
  const id = crypto.randomUUID();
  const isPrimary = isApp && booleanFlag(body.is_primary, false);
  const statements: D1PreparedStatement[] = [];
  if (isPrimary) statements.push(c.env.DB.prepare(`UPDATE growth_apps SET is_primary = 0, updated_at = datetime('now') WHERE project_id = ? AND platform = ?`).bind(projectId, selectedPlatform));
  statements.push(c.env.DB.prepare(`
    INSERT INTO ${table} (
      id, project_id, platform, app_identifier, display_name, country, language, device,
      ${isApp ? 'is_primary,' : ''} enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${isApp ? '?,' : ''} ?)
  `).bind(
    id, projectId, selectedPlatform, requiredString(body.app_identifier, 'app_identifier', 255),
    optionalString(body.display_name, 'display_name', 255), locale(body.country, 'country', 'us'),
    locale(body.language, 'language', 'en'), selectedDevice,
    ...(isApp ? [isPrimary ? 1 : 0] : []), booleanFlag(body.enabled, true) ? 1 : 0,
  ));
  try { await c.env.DB.batch(statements); }
  catch (error) { throw mapConstraint(error, 'store_entity_exists', 'This store app is already configured for the selected locale'); }
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
  await audit(c.env, projectId, `growth.${isApp ? 'app' : 'competitor'}.created`, isApp ? 'app' : 'competitor', id, row, c.get('actorId'));
  return c.json({ data: row }, 201);
}

async function updateStoreEntity(c: any, table: 'growth_apps' | 'growth_competitors') {
  const projectId = project(c);
  const body = await boundedJson(c.req.raw);
  const existing = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id = ?`).bind(c.req.param('id'), projectId).first() as Record<string, unknown> | null;
  if (!existing) throw failure('store_entity_not_found', 'Store app not found', 404);
  const displayName = body.display_name === undefined ? existing.display_name : optionalString(body.display_name, 'display_name', 255);
  const enabled = body.enabled === undefined ? Number(existing.enabled) === 1 : booleanFlag(body.enabled);
  const isApp = table === 'growth_apps';
  const isPrimary = isApp ? body.is_primary === undefined ? Number(existing.is_primary) === 1 : booleanFlag(body.is_primary) : false;
  const statements: D1PreparedStatement[] = [];
  if (isApp && isPrimary) statements.push(c.env.DB.prepare(`UPDATE growth_apps SET is_primary = 0, updated_at = datetime('now') WHERE project_id = ? AND platform = ?`).bind(projectId, existing.platform));
  statements.push(c.env.DB.prepare(`
    UPDATE ${table} SET display_name = ?, enabled = ?, ${isApp ? 'is_primary = ?,' : ''} updated_at = datetime('now')
    WHERE id = ? AND project_id = ?
  `).bind(displayName, enabled ? 1 : 0, ...(isApp ? [isPrimary ? 1 : 0] : []), c.req.param('id'), projectId));
  await c.env.DB.batch(statements);
  const row = await c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(c.req.param('id')).first();
  await audit(c.env, projectId, `growth.${isApp ? 'app' : 'competitor'}.updated`, isApp ? 'app' : 'competitor', c.req.param('id'), body, c.get('actorId'));
  return c.json({ data: row });
}

async function deleteRow(c: any, table: string, resourceType: string) {
  const projectId = project(c);
  const result = await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND project_id = ?`).bind(c.req.param('id'), projectId).run();
  if (result.meta.changes === 0) throw failure(`${resourceType}_not_found`, `${capitalize(resourceType)} not found`, 404);
  await audit(c.env, projectId, `growth.${resourceType}.deleted`, resourceType, c.req.param('id'), {}, c.get('actorId'));
  return c.body(null, 204);
}

function serializeAutomation(row: Record<string, unknown>) {
  return { ...row, enabled: Number(row.enabled) === 1, trigger_config: parseJson(row.trigger_config_json), action_config: parseJson(row.action_config_json), trigger_config_json: undefined, action_config_json: undefined };
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function mapConstraint(error: unknown, code: string, message: string) {
  return /unique|constraint/i.test(error instanceof Error ? error.message : String(error)) ? failure(code, message, 409) : error;
}

function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0 && left.length === right.length;
}
