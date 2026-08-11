import { Hono } from 'hono';
import { Env } from '../types';
import { hashPassword } from '../lib/crypto';
import { getAuthUserId as getStrictAuthUserId } from '../lib/auth';
import { getOrCreateProject } from '../lib/db';
import { storeCsvDownload } from '../lib/files';
import { downloadFileMessage, invitationMessage, invitationUrl, sendMail } from '../lib/mail';
import { encryptCredential } from '../lib/secrets';
import { isRegistrationAllowed, registrationDeniedBody } from '../lib/deployment';
import { readRequestObjectLimited } from '@superboard/contracts/request-body';
import { readApiJson } from '../lib/request-body';
import { tokenDigest } from '../lib/token-storage';

const instances = new Hono<{ Bindings: Env }>();

async function getAuthUserId(c: any): Promise<number | null> {
  return getStrictAuthUserId(c.env, c.req.header('Authorization'));
}

async function buildInstance(db: any, instanceId: number, userId: number, shortlinkDomain: string) {
  const inst: any = await db.prepare(
    'SELECT id, api_key, uri_scheme, get_started_dismissed, revenue_collection_enabled, created_at FROM instances WHERE id = ?'
  ).bind(instanceId).first();
  if (!inst) return null;

  const role: { role: string } | null = await db.prepare(
    'SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ?'
  ).bind(userId, instanceId).first();

  const hashId = inst.api_key.slice(0, 16);
  await getOrCreateProject(db, instanceId, 'production');
  await getOrCreateProject(db, instanceId, 'test');

  const productionProject = {
    id: String(instanceId) + '-prod',
    name: inst.uri_scheme,
    domain: shortlinkDomain,
    hash_id: hashId,
    bundle_id: null, team_id: null, app_store_id: null,
    play_store_id: null, package_name: null, sha256_cert_fingerprints: null,
  };
  const testProject = {
    id: String(instanceId) + '-test',
    name: inst.uri_scheme + ' (test)',
    domain: shortlinkDomain,
    hash_id: hashId + 't',
    bundle_id: null, team_id: null, app_store_id: null,
    play_store_id: null, package_name: null, sha256_cert_fingerprints: null,
  };

  return {
    id: String(inst.id),
    name: inst.uri_scheme,
    hash_id: hashId,
    api_key: inst.api_key,
    uri_scheme: inst.uri_scheme,
    get_started_dismissed: inst.get_started_dismissed === 1,
    revenue_collection_enabled: inst.revenue_collection_enabled === 1,
    created_at: inst.created_at,
    updated_at: inst.created_at,
    role: role?.role || 'owner',
    production: productionProject,
    test: testProject,
    projects: [productionProject, testProject],
  };
}

function csvValue(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: unknown[]): string {
  return values.map(csvValue).join(',');
}

function requestOrigin(c: any) {
  const host = c.req.header('host') || new URL(c.req.url).host;
  const proto = host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

async function requireInstanceRole(c: any, instanceId: number, adminOnly = false) {
  const userId = await getAuthUserId(c);
  if (!userId) return { error: c.json({ error: 'Unauthorized' }, 401) };
  const role = await c.env.DB.prepare(
    'SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1'
  ).bind(userId, instanceId).first() as { role: string } | null;
  if (!role) return { error: c.json({ error: 'Forbidden' }, 403) };
  if (adminOnly && !['owner', 'admin'].includes(role.role)) {
    return { error: c.json({ error: 'Forbidden' }, 403) };
  }
  return { userId, role: role.role };
}

async function instanceProjects(db: D1Database, instanceId: number) {
  const production = await getOrCreateProject(db, instanceId, 'production');
  const test = await getOrCreateProject(db, instanceId, 'test');
  return [String(production.id), String(test.id)];
}

async function syncIosRpushApps(db: D1Database, iosConfigId: string | number) {
  const push = await db.prepare(`
    SELECT ipc.name, ipc.encrypted_p8_key, ipc.key_id, ipc.certificate_password, ipc.team_id,
           COALESCE(ipc.bundle_id, ic.bundle_id) AS bundle_id,
           COALESCE(ipc.team_id, ic.app_prefix) AS resolved_team_id
    FROM ios_push_configurations ipc
    JOIN ios_configurations ic ON ic.id = ipc.ios_configuration_id OR ic.application_id = ipc.application_id
    WHERE ipc.ios_configuration_id = ?
    LIMIT 1
  `).bind(iosConfigId).first<any>();
  if (!push?.name || !push?.encrypted_p8_key) return;
  const keyId = push.key_id || push.certificate_password;
  const teamId = push.resolved_team_id || push.team_id;
  const names = [`${push.name}-development`, `${push.name}-production`];
  await db.prepare(`DELETE FROM rpush_apps WHERE name IN (?, ?)`).bind(...names).run();
  for (const environment of ['development', 'production']) {
    await db.prepare(`
      INSERT INTO rpush_apps (
        name, environment, type, encrypted_apn_key, apn_key_id, team_id, bundle_id,
        connections, feedback_enabled, created_at, updated_at
      ) VALUES (?, ?, 'Rpush::Apnsp8::App', ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
    `).bind(`${push.name}-${environment}`, environment, push.encrypted_p8_key, keyId, teamId, push.bundle_id).run();
  }
}

async function syncAndroidRpushApp(db: D1Database, androidConfigId: string | number) {
  const push = await db.prepare(`
    SELECT name, encrypted_fcm_server_key, firebase_project_id
    FROM android_push_configurations
    WHERE android_configuration_id = ?
    LIMIT 1
  `).bind(androidConfigId).first<any>();
  if (!push?.name || !push?.encrypted_fcm_server_key) return;
  await db.prepare('DELETE FROM rpush_apps WHERE name = ?').bind(push.name).run();
  await db.prepare(`
    INSERT INTO rpush_apps (
      name, environment, type, encrypted_json_key, firebase_project_id, connections,
      feedback_enabled, created_at, updated_at
    ) VALUES (?, 'production', 'Rpush::Fcm::App', ?, ?, 30, 1, datetime('now'), datetime('now'))
  `).bind(push.name, push.encrypted_fcm_server_key, push.firebase_project_id).run();
}

async function getStartedSetup(db: D1Database, instanceId: number) {
  const production = await getOrCreateProject(db, instanceId, 'production');
  const test = await getOrCreateProject(db, instanceId, 'test');
  const projectIds = [production.id, test.id];

  const ios = await db.prepare(`
    SELECT ic.id
    FROM ios_configurations ic
    JOIN applications a ON a.id = ic.application_id
    WHERE a.instance_id = ?
      AND a.platform = 'ios'
      AND COALESCE(a.enabled, 1) != 0
      AND ic.bundle_id IS NOT NULL
      AND ic.app_prefix IS NOT NULL
    LIMIT 1
  `).bind(instanceId).first();

  const android = await db.prepare(`
    SELECT ac.id
    FROM android_configurations ac
    JOIN applications a ON a.id = ac.application_id
    WHERE a.instance_id = ?
      AND a.platform = 'android'
      AND COALESCE(a.enabled, 1) != 0
      AND ac.identifier IS NOT NULL
    LIMIT 1
  `).bind(instanceId).first();

  const web = await db.prepare(`
    SELECT wc.id
    FROM web_configurations wc
    JOIN applications a ON a.id = wc.application_id
    JOIN web_configuration_linked_domains wcld ON wcld.web_configuration_id = wc.id
    WHERE a.instance_id = ?
      AND a.platform = 'web'
      AND COALESCE(a.enabled, 1) != 0
      AND wcld.domain IS NOT NULL
    LIMIT 1
  `).bind(instanceId).first();

  const links = await db.prepare(`
    SELECT l.id
    FROM links l
    JOIN redirect_configs rc ON rc.id = l.redirect_config_id
    WHERE rc.project_id IN (${projectIds.map(() => '?').join(',')})
    LIMIT 1
  `).bind(...projectIds).first();

  const campaigns = await db.prepare(`
    SELECT id
    FROM campaigns
    WHERE project_id IN (${projectIds.map(() => '?').join(',')})
      AND COALESCE(archived, 0) = 0
    LIMIT 1
  `).bind(...projectIds).first();

  const fallback = await db.prepare(`
    SELECT rc.id
    FROM redirect_configs rc
    LEFT JOIN redirects r ON r.redirect_config_id = rc.id
    WHERE rc.project_id IN (${projectIds.map(() => '?').join(',')})
      AND (
        COALESCE(rc.default_fallback, '') != ''
        OR COALESCE(r.fallback_url, '') != ''
        OR COALESCE(r.enabled, 0) != 0
      )
    LIMIT 1
  `).bind(...projectIds).first();

  return {
    android_sdk: !!android,
    ios_sdk: !!ios,
    web_sdk: !!web,
    has_created_campaigns: !!campaigns,
    has_created_links: !!links,
    redirect_fallback: !!fallback,
  };
}

function placeholders(values: unknown[]) {
  return values.map(() => '?').join(',');
}

async function allIds(db: D1Database, sql: string, binds: unknown[]): Promise<string[]> {
  const rows = await db.prepare(sql).bind(...binds).all<any>();
  return (rows.results || []).map((row) => String(row.id));
}

async function deleteRun(db: D1Database, sql: string, binds: unknown[] = []) {
  const result = await db.prepare(sql).bind(...binds).run();
  return result.meta?.changes || 0;
}

async function deleteInstanceTree(env: Env, instanceId: number) {
  const db = env.DB;
  const summary: Record<string, number> = {};
  const add = async (key: string, sql: string, binds: unknown[] = []) => {
    summary[key] = (summary[key] || 0) + await deleteRun(db, sql, binds).catch((error) => {
      console.error('instance_delete_step_failed', { key, message: error?.message || String(error) });
      throw error;
    });
  };

  const projectIds = await allIds(db, 'SELECT id FROM projects WHERE instance_id = ?', [instanceId]);
  const appIds = await allIds(db, 'SELECT id FROM applications WHERE instance_id = ?', [instanceId]);
  const projectIn = projectIds.length ? placeholders(projectIds) : "''";
  const appIn = appIds.length ? placeholders(appIds) : "''";

  const fileRows = projectIds.length || appIds.length
    ? await db.prepare(`
      SELECT file_key FROM downloadable_files
      WHERE ${projectIds.length ? `project_id IN (${projectIn})` : '0'}
         OR ${appIds.length ? `application_id IN (${appIn})` : '0'}
    `).bind(...projectIds, ...appIds).all<{ file_key: string }>()
    : { results: [] as { file_key: string }[] };

  if (env.R2) {
    for (const row of fileRows.results || []) {
      if (row.file_key) await env.R2.delete(row.file_key).catch(() => undefined);
    }
  }

  const linkIds = projectIds.length
    ? await allIds(db, `
      SELECT DISTINCT l.id
      FROM links l
      LEFT JOIN redirect_configs rc ON rc.id = l.redirect_config_id
      LEFT JOIN domains d ON d.id = l.domain_id
      WHERE rc.project_id IN (${projectIn}) OR d.project_id IN (${projectIn})
    `, [...projectIds, ...projectIds])
    : [];
  const linkIn = linkIds.length ? placeholders(linkIds) : "''";

  const notificationIds = projectIds.length
    ? await allIds(db, `SELECT id FROM notifications WHERE project_id IN (${projectIn})`, projectIds)
    : [];
  const notificationIn = notificationIds.length ? placeholders(notificationIds) : "''";

  const visitorIds = projectIds.length
    ? await allIds(db, `SELECT id FROM visitors WHERE project_id IN (${projectIn})`, projectIds)
    : [];
  const visitorIn = visitorIds.length ? placeholders(visitorIds) : "''";

  const inAppProductIds = projectIds.length
    ? await allIds(db, `SELECT id FROM in_app_products WHERE project_id IN (${projectIn})`, projectIds)
    : [];
  const inAppProductIn = inAppProductIds.length ? placeholders(inAppProductIds) : "''";

  const rpushNames = appIds.length
    ? await db.prepare(`
      SELECT name AS id FROM ios_push_configurations WHERE application_id IN (${appIn})
      UNION
      SELECT name AS id FROM android_push_configurations WHERE application_id IN (${appIn})
    `).bind(...appIds, ...appIds).all<{ id: string }>()
    : { results: [] as { id: string }[] };
  const rpushAppNames = (rpushNames.results || []).flatMap((row) => {
    if (!row.id) return [];
    return [row.id, `${row.id}-development`, `${row.id}-production`];
  });
  const rpushAppIds = rpushAppNames.length
    ? await allIds(db, `SELECT id FROM rpush_apps WHERE name IN (${placeholders(rpushAppNames)})`, rpushAppNames)
    : [];
  const rpushAppIn = rpushAppIds.length ? placeholders(rpushAppIds) : "''";

  const mcpClientIds = await allIds(db, 'SELECT id FROM mcp_clients WHERE instance_id = ?', [instanceId]);
  const mcpClientIn = mcpClientIds.length ? placeholders(mcpClientIds) : "''";

  if (notificationIds.length) {
    await add('notification_messages', `DELETE FROM notification_messages WHERE notification_id IN (${notificationIn})`, notificationIds);
    await add('notification_targets', `DELETE FROM notification_targets WHERE notification_id IN (${notificationIn})`, notificationIds);
  }
  if (rpushAppIds.length) await add('rpush_notifications', `DELETE FROM rpush_notifications WHERE app_id IN (${rpushAppIn})`, rpushAppIds);
  if (rpushAppNames.length) await add('rpush_apps', `DELETE FROM rpush_apps WHERE name IN (${placeholders(rpushAppNames)})`, rpushAppNames);
  if (linkIds.length) {
    await add('actions', `DELETE FROM actions WHERE link_id IN (${linkIn})`, linkIds);
    await add('custom_redirects', `DELETE FROM custom_redirects WHERE link_id IN (${linkIn})`, linkIds);
    await add('link_daily_statistics', `DELETE FROM link_daily_statistics WHERE link_id IN (${linkIn})`, linkIds);
  }
  if (visitorIds.length) {
    await add('visitor_last_visits', `DELETE FROM visitor_last_visits WHERE visitor_id IN (${visitorIn})`, visitorIds);
    await add('visitor_daily_statistics', `DELETE FROM visitor_daily_statistics WHERE visitor_id IN (${visitorIn})`, visitorIds);
    await add('notification_messages_by_visitor', `DELETE FROM notification_messages WHERE visitor_id IN (${visitorIn})`, visitorIds);
  }
  if (inAppProductIds.length) {
    await add('in_app_product_daily_statistics', `DELETE FROM in_app_product_daily_statistics WHERE in_app_product_id IN (${inAppProductIn})`, inAppProductIds);
  }
  if (mcpClientIds.length) {
    await add('mcp_tokens', `DELETE FROM mcp_tokens WHERE mcp_client_id IN (${mcpClientIn})`, mcpClientIds);
    await add('mcp_authorization_codes', `DELETE FROM mcp_authorization_codes WHERE mcp_client_id IN (${mcpClientIn})`, mcpClientIds);
  }
  if (projectIds.length) {
    await add('iap_webhook_messages', `DELETE FROM iap_webhook_messages WHERE project_id IN (${projectIn})`, projectIds);
    await add('installed_apps', `DELETE FROM installed_apps WHERE project_id IN (${projectIn})`, projectIds);
    await add('purchase_events', `DELETE FROM purchase_events WHERE project_id IN (${projectIn})`, projectIds);
    await add('subscription_states', `DELETE FROM subscription_states WHERE project_id IN (${projectIn})`, projectIds);
    await add('events', `DELETE FROM events WHERE project_id IN (${projectIn})`, projectIds);
    await add('project_daily_active_users', `DELETE FROM project_daily_active_users WHERE project_id IN (${projectIn})`, projectIds);
    await add('daily_project_metrics', `DELETE FROM daily_project_metrics WHERE project_id IN (${projectIn})`, projectIds);
    await add('visitor_daily_statistics_by_project', `DELETE FROM visitor_daily_statistics WHERE project_id IN (${projectIn})`, projectIds);
    await add('visitors', `DELETE FROM visitors WHERE project_id IN (${projectIn})`, projectIds);
    await add('links', `DELETE FROM links WHERE id IN (${linkIn})`, linkIds);
    await add('campaigns', `DELETE FROM campaigns WHERE project_id IN (${projectIn})`, projectIds);
    await add('notifications', `DELETE FROM notifications WHERE project_id IN (${projectIn})`, projectIds);
    await add('in_app_products', `DELETE FROM in_app_products WHERE project_id IN (${projectIn})`, projectIds);
    await add('downloadable_files', `DELETE FROM downloadable_files WHERE project_id IN (${projectIn})`, projectIds);
    await add('redirects', `DELETE FROM redirects WHERE redirect_config_id IN (SELECT id FROM redirect_configs WHERE project_id IN (${projectIn}))`, projectIds);
    await add('redirect_configs', `DELETE FROM redirect_configs WHERE project_id IN (${projectIn})`, projectIds);
    await add('quick_links_by_project', `DELETE FROM quick_links WHERE project_id IN (${projectIn})`, projectIds);
    await add('domains', `DELETE FROM domains WHERE project_id IN (${projectIn})`, projectIds);
  }

  if (appIds.length) {
    await add('ios_server_api_keys', 'DELETE FROM ios_server_api_keys WHERE instance_id = ?', [instanceId]);
    await add('android_server_api_keys', 'DELETE FROM android_server_api_keys WHERE instance_id = ?', [instanceId]);
    await add('ios_push_configurations', `DELETE FROM ios_push_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('android_push_configurations', `DELETE FROM android_push_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('web_configuration_linked_domains', `DELETE FROM web_configuration_linked_domains WHERE web_configuration_id IN (SELECT id FROM web_configurations WHERE application_id IN (${appIn}))`, appIds);
    await add('ios_configurations', `DELETE FROM ios_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('android_configurations', `DELETE FROM android_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('desktop_configurations', `DELETE FROM desktop_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('web_configurations', `DELETE FROM web_configurations WHERE application_id IN (${appIn})`, appIds);
    await add('applications', `DELETE FROM applications WHERE id IN (${appIn})`, appIds);
    await add('downloadable_files_by_application', `DELETE FROM downloadable_files WHERE application_id IN (${appIn})`, appIds);
  }

  await add('mcp_clients', 'DELETE FROM mcp_clients WHERE instance_id = ?', [instanceId]);
  await add('setup_progress_steps', 'DELETE FROM setup_progress_steps WHERE instance_id = ?', [instanceId]);
  await add('enterprise_subscriptions', 'DELETE FROM enterprise_subscriptions WHERE instance_id = ?', [instanceId]);
  await add('quick_links_by_instance', 'DELETE FROM quick_links WHERE instance_id = ?', [instanceId]);
  await add('instance_roles', 'DELETE FROM instance_roles WHERE instance_id = ?', [instanceId]);
  if (projectIds.length) await add('projects', `DELETE FROM projects WHERE id IN (${projectIn})`, projectIds);
  await add('instances', 'DELETE FROM instances WHERE id = ?', [instanceId]);

  return summary;
}

// =================== INSTANCES ===================

instances.get('/', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const roles = await c.env.DB.prepare(
    'SELECT instance_id FROM instance_roles WHERE user_id = ?'
  ).bind(userId).all<{ instance_id: number }>();
  const list = await Promise.all(
    (roles.results || []).map(r => buildInstance(c.env.DB, r.instance_id, userId, c.env.SHORTLINK_DOMAIN))
  );
  return c.json({ instances: list.filter(Boolean) });
});

instances.post('/', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body = await readApiJson(c.req.raw);
  const name = body.name || 'My App';
  const apiKey = crypto.randomUUID().replace(/-/g, '');
  const uriScheme = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now().toString(36);
  const result = await c.env.DB.prepare(
    'INSERT INTO instances (api_key, uri_scheme, revenue_collection_enabled) VALUES (?, ?, ?) RETURNING id'
  ).bind(apiKey, uriScheme, 1).first<{ id: number }>();
  await c.env.DB.prepare(
    'INSERT INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)'
  ).bind(userId, result!.id, 'owner').run();
  const instance = await buildInstance(c.env.DB, result!.id, userId, c.env.SHORTLINK_DOMAIN);
  return c.json({ instance }, 201);
});

instances.get('/:id', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const instance = await buildInstance(c.env.DB, instanceId, userId, c.env.SHORTLINK_DOMAIN);
  if (!instance) return c.json({ error: 'Not found' }, 404);
  return c.json({
    instance,
    get_started_setup: await getStartedSetup(c.env.DB, instanceId),
  });
});

instances.put('/:id', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readApiJson(c.req.raw);
  if (body.name) {
    await c.env.DB.prepare('UPDATE instances SET uri_scheme = ? WHERE id = ?')
      .bind(body.name, instanceId).run();
  }
  const instance = await buildInstance(c.env.DB, instanceId, access.userId, c.env.SHORTLINK_DOMAIN);
  return c.json({ instance });
});

instances.delete('/:id', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const cleanup = await deleteInstanceTree(c.env, instanceId);
  return c.json({ deleted: true, cleanup });
});

// =================== MEMBERS ===================

instances.get('/:id/members', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const rows = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, ir.role FROM instance_roles ir JOIN users u ON u.id = ir.user_id WHERE ir.instance_id = ?'
  ).bind(instanceId).all<any>();
  const members = (rows.results || []).map((r: any) => ({
    user: { id: String(r.id), email: r.email, name: r.name },
    role: r.role,
  }));
  return c.json({ members });
});

instances.post('/:id/members', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readApiJson(c.req.raw);
  const email = String(body.email || body.user?.email || '').trim().toLowerCase();
  const name = body.name || body.user?.name || null;
  const role = body.role || 'member';

  if (!email) return c.json({ error: 'email required' }, 422);
  if (!await isRegistrationAllowed(c.env, email)) {
    return c.json(registrationDeniedBody(), 403);
  }

  const invitationToken = crypto.randomUUID().replace(/-/g, '');
  const invitationTokenDigest = await tokenDigest(invitationToken);
  let invited = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE email = ? LIMIT 1'
  ).bind(email).first<{ id: number; email: string; name: string | null }>();

  if (!invited) {
    const placeholderPassword = await hashPassword(crypto.randomUUID());
    invited = await c.env.DB.prepare(`
      INSERT INTO users (
        email,
        password_hash,
        encrypted_password,
        name,
        invitation_token,
        invitation_created_at,
        invited_by_type,
        invited_by_id
      )
      VALUES (?, ?, ?, ?, ?, datetime("now"), 'User', ?)
      RETURNING id, email, name
    `).bind(email, placeholderPassword, placeholderPassword, name, invitationTokenDigest, access.userId).first<{ id: number; email: string; name: string | null }>();
  } else {
    await c.env.DB.prepare(`
      UPDATE users
      SET invitation_token = ?,
          invitation_created_at = COALESCE(invitation_created_at, datetime("now")),
          invitation_sent_at = NULL,
          invited_by_type = 'User',
          invited_by_id = ?,
          updated_at = datetime("now")
      WHERE id = ?
    `).bind(invitationTokenDigest, access.userId, invited.id).run();
  }

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)'
  ).bind(invited!.id, instanceId, role).run();
  await c.env.DB.prepare(
    'UPDATE users SET invitations_count = COALESCE(invitations_count, 0) + 1 WHERE id = ?'
  ).bind(access.userId).run();

  try {
    await sendMail(c.env, invitationMessage(c.env, invited!.email, invitationToken));
    await c.env.DB.prepare(
      'UPDATE users SET invitation_sent_at = datetime("now"), updated_at = datetime("now") WHERE id = ?'
    ).bind(invited!.id).run();
  } catch (error: any) {
    console.error('invitation_mail_failed', { invited_user_id: invited!.id, error: error?.message || String(error) });
    return c.json({ error: 'Invitation email could not be delivered' }, 503);
  }

  return c.json({
    member: {
      user: { id: String(invited!.id), email: invited!.email, name: invited!.name },
      role,
      invitation_token: invitationToken,
      invitation_url: invitationUrl(c.env, invitationToken),
    },
  }, 201);
});

instances.delete('/:id/members', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readApiJson(c.req.raw);
  const targetUserId = body.user_id || body.id || null;
  const targetEmail = body.email || null;

  if (!targetUserId && !targetEmail) {
    return c.json({ error: 'user_id or email required' }, 422);
  }

  const target = targetUserId
    ? { id: Number(targetUserId) }
    : await c.env.DB.prepare('SELECT id FROM users WHERE email = ? LIMIT 1').bind(targetEmail).first<{ id: number }>();

  if (!target) return c.json({ error: 'Member not found' }, 404);

  await c.env.DB.prepare('DELETE FROM instance_roles WHERE instance_id = ? AND user_id = ?')
    .bind(instanceId, target.id).run();
  const rows = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, ir.role FROM instance_roles ir JOIN users u ON u.id = ir.user_id WHERE ir.instance_id = ?'
  ).bind(instanceId).all<any>();
  return c.json({
    members: (rows.results || []).map((r: any) => ({
      user: { id: String(r.id), email: r.email, name: r.name },
      role: r.role,
    })),
  });
});

instances.get('/:id/role', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const role = await c.env.DB.prepare(
    'SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ?'
  ).bind(userId, instanceId).first<{ role: string }>();
  return c.json({ role: role?.role || 'owner' });
});

// =================== CONFIGURATIONS ===================

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 10 * 1024 * 1024);
}

function toBool(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}

function pick(body: Record<string, any>, ...names: string[]): any {
  for (const name of names) {
    if (body[name] !== undefined) return body[name];
    if (body[`configuration[${name}]`] !== undefined) return body[`configuration[${name}]`];
  }
  return undefined;
}

function jsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(String).filter(Boolean));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '[]';
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(String).filter(Boolean));
    } catch {}
    return JSON.stringify(trimmed.split(/[\n,]/).map((item) => item.trim()).filter(Boolean));
  }
  return '[]';
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function fileName(file: any): string | null {
  if (!file || typeof file === 'string') return null;
  return file.name || file.filename || null;
}

async function fileText(file: any): Promise<string | null> {
  if (!file || typeof file === 'string') return typeof file === 'string' ? file : null;
  if (typeof file.text === 'function') return file.text();
  if (typeof file.arrayBuffer === 'function') {
    return new TextDecoder().decode(await file.arrayBuffer());
  }
  return null;
}

async function validateP8File(file: any): Promise<{ content: string; filename: string }> {
  const filename = fileName(file) || 'key.p8';
  if (!filename.endsWith('.p8')) throw new Error('File must be a .p8 file');
  const content = (await fileText(file)) || '';
  if (!content.trim().startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('File must be a valid PKCS#8 private key (.p8)');
  }
  return { content, filename };
}

async function validateServiceAccountJson(file: any): Promise<{ content: string; filename: string; parsed: Record<string, any> }> {
  const filename = fileName(file) || 'service-account.json';
  if (!filename.endsWith('.json')) throw new Error('File must be a JSON file (.json)');
  const content = (await fileText(file)) || '';
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('File must contain valid JSON');
  }
  if (!parsed || parsed.type !== 'service_account') {
    throw new Error('File must be a valid Google service account JSON file');
  }
  return { content, filename, parsed };
}

async function getOrCreateApplication(db: D1Database, instanceId: number, platform: string, enabled = true): Promise<number> {
  const existing = await db.prepare(
    'SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1'
  ).bind(instanceId, platform).first<{ id: number }>();
  if (existing) {
    await db.prepare('UPDATE applications SET enabled = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(enabled ? 1 : 0, existing.id).run();
    return existing.id;
  }
  const created = await db.prepare(
    'INSERT INTO applications (platform, instance_id, enabled) VALUES (?, ?, 1) RETURNING id'
  ).bind(platform, instanceId).first<{ id: number }>();
  if (!created) throw new Error('Unable to create application');
  return created.id;
}

async function loadApplicationConfig(db: D1Database, instanceId: number, platform: string) {
  if (platform === 'ios') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled,
             ic.id AS config_id, ic.bundle_id, ic.app_prefix, ic.app_apple_id, ic.tablet_enabled,
             ipc.id AS push_id, ipc.name AS push_name, ipc.certificate_password,
             isak.id AS server_key_id, isak.key_id, isak.issuer_id, isak.filename, isak.created_at AS server_key_created_at
      FROM applications a
      LEFT JOIN ios_configurations ic ON ic.application_id = a.id
      LEFT JOIN ios_push_configurations ipc ON ipc.ios_configuration_id = ic.id OR ipc.application_id = a.id
      LEFT JOIN ios_server_api_keys isak ON isak.ios_configuration_id = ic.id OR isak.instance_id = a.instance_id
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
        app_apple_id: row.app_apple_id,
        tablet_enabled: row.tablet_enabled === 1,
        push_configuration: row.push_id ? {
          id: String(row.push_id),
          certificate: row.push_name,
          key_id: row.certificate_password,
        } : null,
        server_api_key: row.server_key_id ? {
          id: String(row.server_key_id),
          key_id: row.key_id,
          issuer_id: row.issuer_id,
          filename: row.filename,
          created_at: row.server_key_created_at,
          configured: true,
        } : null,
      } : null,
    };
  }

  if (platform === 'android') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled,
             ac.id AS config_id, ac.identifier, ac.sha256s, ac.tablet_enabled,
             apc.id AS push_id, apc.name AS push_name, apc.firebase_project_id,
             asak.id AS server_key_id, asak.name AS server_key_name, asak.client_email, asak.project_id
      FROM applications a
      LEFT JOIN android_configurations ac ON ac.application_id = a.id
      LEFT JOIN android_push_configurations apc ON apc.android_configuration_id = ac.id OR apc.application_id = a.id
      LEFT JOIN android_server_api_keys asak ON asak.android_configuration_id = ac.id OR asak.instance_id = a.instance_id
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
        push_configuration: row.push_id ? {
          id: String(row.push_id),
          firebase_project_id: row.firebase_project_id,
          certificate: row.push_name,
        } : null,
        server_api_key: row.server_key_id ? {
          id: String(row.server_key_id),
          file: row.server_key_name,
          client_email: row.client_email,
          project_id: row.project_id,
        } : null,
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

  if (platform === 'web') {
    const row = await db.prepare(`
      SELECT a.id, a.instance_id, a.platform, a.enabled, wc.id AS config_id
      FROM applications a
      LEFT JOIN web_configurations wc ON wc.application_id = a.id
      WHERE a.instance_id = ? AND a.platform = 'web'
      LIMIT 1
    `).bind(instanceId).first<any>();
    if (!row) return null;
    const domainRows = row.config_id ? await db.prepare(
      'SELECT domain FROM web_configuration_linked_domains WHERE web_configuration_id = ? ORDER BY created_at ASC'
    ).bind(row.config_id).all<{ domain: string }>() : { results: [] };
    const domains = (domainRows.results || []).map((item) => item.domain).filter(Boolean);
    return {
      id: String(row.id),
      instance_id: row.instance_id,
      platform: 'web',
      enabled: row.enabled !== 0,
      domains,
      configuration: row.config_id ? {
        id: String(row.config_id),
        domains,
      } : null,
    };
  }

  return null;
}

async function loadConfigurations(db: D1Database, instanceId: number) {
  const configs = await Promise.all(['ios', 'android', 'desktop', 'web'].map((platform) => loadApplicationConfig(db, instanceId, platform)));
  return configs.filter(Boolean);
}

function configPayload(config: any) {
  return { config, configuration: config };
}

async function findConfigId(db: D1Database, table: string, applicationId: number): Promise<string | number | null> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE application_id = ? LIMIT 1`).bind(applicationId).first<{ id: string | number }>();
  return row?.id ?? null;
}

instances.get('/:id/configurations', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  return c.json({ configurations: await loadConfigurations(c.env.DB, instanceId) });
});

instances.get('/:id/configurations/ios', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'ios');
  if (!config) return c.json({ error: 'Configuration not set' }, 404);
  return c.json(configPayload(config));
});

instances.put('/:id/configurations/ios', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'ios', toBool(body.enabled));
  const bundleId = body.bundle_id || body.identifier || body['configuration[bundle_id]'] || null;
  const appPrefix = body.team_id || body.app_prefix || body['configuration[app_prefix]'] || '';
  const tabletEnabled = toBool(pick(body, 'tablet_enabled'), false);
  if (!bundleId || !appPrefix) {
    return c.json({ error: 'bundle_id and app_prefix are required' }, 422);
  }
  await c.env.DB.prepare(`
    INSERT INTO ios_configurations (application_id, bundle_id, app_prefix, app_apple_id, tablet_enabled)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(application_id) DO UPDATE SET
      bundle_id = excluded.bundle_id,
      app_prefix = excluded.app_prefix,
      app_apple_id = excluded.app_apple_id,
      tablet_enabled = excluded.tablet_enabled,
      updated_at = datetime('now')
  `).bind(appId, bundleId, appPrefix, body.app_apple_id || body.app_store_id || null, tabletEnabled ? 1 : 0).run();
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'ios')));
});

instances.delete('/:id/configurations/ios', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const app = await c.env.DB.prepare('SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1')
    .bind(instanceId, 'ios').first<{ id: number }>();
  if (app) {
    await c.env.DB.prepare('DELETE FROM ios_server_api_keys WHERE ios_configuration_id IN (SELECT id FROM ios_configurations WHERE application_id = ?) OR instance_id = ?')
      .bind(app.id, instanceId).run();
    await c.env.DB.prepare('DELETE FROM ios_push_configurations WHERE ios_configuration_id IN (SELECT id FROM ios_configurations WHERE application_id = ?) OR application_id = ?')
      .bind(app.id, app.id).run();
    await c.env.DB.prepare('DELETE FROM ios_configurations WHERE application_id = ?').bind(app.id).run();
    await c.env.DB.prepare('DELETE FROM setup_progress_steps WHERE instance_id = ? AND category = ?').bind(instanceId, 'ios_setup').run();
  }
  return c.json({ config: null, configuration: null });
});

instances.get('/:id/configurations/ios/push', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'ios');
  if (!config?.configuration?.push_configuration) return c.json({ error: 'Configuration not set' }, 404);
  return c.json({ configuration: config.configuration.push_configuration });
});

instances.put('/:id/configurations/ios/push', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'ios', true);
  let iosConfigId = await findConfigId(c.env.DB, 'ios_configurations', appId);
  if (!iosConfigId) {
    await c.env.DB.prepare('INSERT INTO ios_configurations (application_id, bundle_id, app_prefix) VALUES (?, ?, ?)')
      .bind(appId, null, '').run();
    iosConfigId = await findConfigId(c.env.DB, 'ios_configurations', appId);
  }
  const file = pick(body, 'push_certificate');
  const password = pick(body, 'push_certificate_password');
  if (!file || !password) return c.json({ error: 'push_certificate and push_certificate_password are required' }, 422);
  const { content, filename } = await validateP8File(file).catch((error) => { throw error; });
  const encryptedP8Key = await encryptCredential(c.env, content);

  await c.env.DB.prepare('DELETE FROM ios_push_configurations WHERE ios_configuration_id = ? OR application_id = ?')
    .bind(iosConfigId, appId).run();
  await c.env.DB.prepare(`
    INSERT INTO ios_push_configurations (
      name, p8_key, encrypted_p8_key, key_id, team_id, bundle_id, certificate_password,
      ios_configuration_id, application_id, environment
    )
    SELECT ?, NULL, ?, ?, ic.app_prefix, ic.bundle_id, ?, ic.id, ?, 'production'
    FROM ios_configurations ic
    WHERE ic.id = ?
  `).bind(filename, encryptedP8Key, password, password, appId, iosConfigId).run();
  await syncIosRpushApps(c.env.DB, iosConfigId!);

  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'ios')));
});

instances.get('/:id/configurations/android', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'android');
  if (!config) return c.json({ error: 'Configuration not set' }, 404);
  return c.json(configPayload(config));
});

instances.put('/:id/configurations/android', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'android', toBool(body.enabled));
  const identifier = body.package_name || body.identifier || body['configuration[identifier]'];
  const sha256s = body.sha256_cert_fingerprints || body.sha256s || body['configuration[sha256s]'] || [];
  if (!identifier || parseJsonArray(jsonArray(sha256s)).length === 0) {
    return c.json({ error: 'identifier and sha256s are required' }, 422);
  }
  const tabletEnabled = toBool(pick(body, 'tablet_enabled'), false);
  const shaJson = jsonArray(sha256s);
  await c.env.DB.prepare(`
    INSERT INTO android_configurations (application_id, identifier, sha256s, tablet_enabled)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(application_id) DO UPDATE SET
      identifier = excluded.identifier,
      sha256s = excluded.sha256s,
      tablet_enabled = excluded.tablet_enabled,
      updated_at = datetime('now')
  `).bind(appId, identifier, shaJson, tabletEnabled ? 1 : 0).run();
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'android')));
});

instances.delete('/:id/configurations/android', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const app = await c.env.DB.prepare('SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1')
    .bind(instanceId, 'android').first<{ id: number }>();
  if (app) {
    await c.env.DB.prepare('DELETE FROM android_server_api_keys WHERE android_configuration_id IN (SELECT id FROM android_configurations WHERE application_id = ?) OR instance_id = ?')
      .bind(app.id, instanceId).run();
    await c.env.DB.prepare('DELETE FROM android_push_configurations WHERE android_configuration_id IN (SELECT id FROM android_configurations WHERE application_id = ?) OR application_id = ?')
      .bind(app.id, app.id).run();
    await c.env.DB.prepare('DELETE FROM android_configurations WHERE application_id = ?').bind(app.id).run();
    await c.env.DB.prepare('DELETE FROM setup_progress_steps WHERE instance_id = ? AND category = ?').bind(instanceId, 'android_setup').run();
  }
  return c.json({ config: null, configuration: null });
});

instances.get('/:id/configurations/android/push', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'android');
  if (!config?.configuration?.push_configuration) return c.json({ error: 'Configuration not set' }, 404);
  return c.json({ configuration: config.configuration.push_configuration });
});

instances.put('/:id/configurations/android/push', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const firebaseProjectId = pick(body, 'firebase_project_id');
  const file = pick(body, 'push_certificate');
  if (!firebaseProjectId || !file) return c.json({ error: 'firebase_project_id and push_certificate are required' }, 422);
  const { content, filename, parsed } = await validateServiceAccountJson(file);
  const encryptedFcmServerKey = await encryptCredential(c.env, content);

  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'android', true);
  let androidConfigId = await findConfigId(c.env.DB, 'android_configurations', appId);
  if (!androidConfigId) {
    await c.env.DB.prepare('INSERT INTO android_configurations (application_id, identifier, sha256s) VALUES (?, ?, ?)')
      .bind(appId, parsed.client_email || 'unconfigured.android', '[]').run();
    androidConfigId = await findConfigId(c.env.DB, 'android_configurations', appId);
  }

  await c.env.DB.prepare('DELETE FROM android_push_configurations WHERE android_configuration_id = ? OR application_id = ?')
    .bind(androidConfigId, appId).run();
  await c.env.DB.prepare(`
    INSERT INTO android_push_configurations (
      name, fcm_server_key, encrypted_fcm_server_key, fcm_sender_id,
      firebase_project_id, android_configuration_id, application_id
    ) VALUES (?, NULL, ?, ?, ?, ?, ?)
  `).bind(filename, encryptedFcmServerKey, parsed.project_id || null, firebaseProjectId, androidConfigId, appId).run();
  await syncAndroidRpushApp(c.env.DB, androidConfigId!);

  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'android')));
});

instances.put('/:id/configurations/android/api_access_key', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const file = pick(body, 'file');
  if (!file) return c.json({ error: 'file is required' }, 422);
  const { content, filename, parsed } = await validateServiceAccountJson(file);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'android', true);
  const androidConfigId = await findConfigId(c.env.DB, 'android_configurations', appId);
  if (!androidConfigId) return c.json({ error: 'Android configuration must be set up first' }, 422);
  const encrypted = await encryptCredential(c.env, content);
  await c.env.DB.prepare('DELETE FROM android_server_api_keys WHERE android_configuration_id = ? OR instance_id = ?')
    .bind(androidConfigId, instanceId).run();
  await c.env.DB.prepare(`
    INSERT INTO android_server_api_keys (
      android_configuration_id, instance_id, name, encrypted_key, key_id, project_id, client_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(androidConfigId, instanceId, filename, encrypted, parsed.private_key_id || null, parsed.project_id || null, parsed.client_email || null).run();
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'android')));
});

instances.put('/:id/configurations/ios/api_access_key', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const file = pick(body, 'file') || pick(body, 'private_key') || pick(body, 'key');
  if (!file) return c.json({ error: 'file is required' }, 422);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'ios', true);
  let iosConfigId = await findConfigId(c.env.DB, 'ios_configurations', appId);
  if (!iosConfigId) {
    await c.env.DB.prepare('INSERT INTO ios_configurations (application_id, bundle_id, app_prefix) VALUES (?, ?, ?)')
      .bind(appId, pick(body, 'bundle_id') || '', pick(body, 'team_id') || pick(body, 'app_prefix') || '').run();
    iosConfigId = await findConfigId(c.env.DB, 'ios_configurations', appId);
  }
  const content = typeof file === 'string' ? file : await (file as File).text();
  if (!/-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----/.test(content)) {
    return c.json({ error: 'file must be a valid App Store Connect .p8 private key' }, 422);
  }
  const keyId = String(pick(body, 'key_id') || '').trim();
  const issuerId = String(pick(body, 'issuer_id') || '').trim();
  const appleAppId = String(pick(body, 'app_apple_id') || '').trim();
  if (!keyId || !issuerId || !appleAppId) {
    return c.json({ error: 'key_id, issuer_id and app_apple_id are required' }, 422);
  }
  const encrypted = await encryptCredential(c.env, content);
  await c.env.DB.prepare(`
    UPDATE ios_configurations
    SET app_apple_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(appleAppId, iosConfigId).run();
  await c.env.DB.prepare('DELETE FROM ios_server_api_keys WHERE ios_configuration_id = ? OR instance_id = ?')
    .bind(iosConfigId, instanceId).run();
  await c.env.DB.prepare(`
    INSERT INTO ios_server_api_keys (
      instance_id, ios_configuration_id, name, encrypted_key, private_key, key_id, issuer_id, bundle_id, filename
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    instanceId,
    iosConfigId,
    pick(body, 'name') || pick(body, 'filename') || 'App Store Connect API Key',
    encrypted,
    null,
    keyId,
    issuerId,
    pick(body, 'bundle_id') || null,
    pick(body, 'filename') || (typeof file === 'string' ? 'AuthKey.p8' : (file as File).name),
  ).run();
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'ios')));
});

export function buildGoogleConfigurationScript(params: {
  instanceId: number;
  apiDomain: string;
  projectId: string;
  serviceAccountEmail: string;
}) {
  const endpoint = `https://${params.apiDomain}/api/v1/iap/google/${params.instanceId}`;
  return `#!/bin/bash
set -e

CONFIGURED_PROJECT_ID="${params.projectId}"
SA_EMAIL="${params.serviceAccountEmail}"
PROJECT_ID="$CONFIGURED_PROJECT_ID"
TOPIC_NAME="$1"
SUBSCRIPTION_NAME="\${2:-opengrow-play-rtdn-subscription}"

if [ -z "$TOPIC_NAME" ]; then
  echo "Usage: ./opengrow_android_gcloud_setup.sh <existing-play-rtdn-topic-name> [subscription-name]"
  exit 1
fi

PUSH_ENDPOINT="${endpoint}"
PUSH_AUDIENCE="${endpoint}"

gcloud services enable cloudresourcemanager.googleapis.com iam.googleapis.com pubsub.googleapis.com androidpublisher.googleapis.com --project="$PROJECT_ID"
gcloud beta services identity create --service=pubsub.googleapis.com --project="$PROJECT_ID"
gcloud pubsub topics describe "$TOPIC_NAME" --project="$PROJECT_ID" >/dev/null

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_SERVICE_AGENT="service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:$PUBSUB_SERVICE_AGENT" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID"

if gcloud pubsub subscriptions describe "$SUBSCRIPTION_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$SUBSCRIPTION_NAME" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --push-auth-service-account="$SA_EMAIL" \
    --push-auth-token-audience="$PUSH_AUDIENCE" \
    --project="$PROJECT_ID"
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
    --topic="$TOPIC_NAME" \
    --push-endpoint="$PUSH_ENDPOINT" \
    --push-auth-service-account="$SA_EMAIL" \
    --push-auth-token-audience="$PUSH_AUDIENCE" \
    --project="$PROJECT_ID"
fi
echo "SuperBoard Google Play RTDN authenticated push configured: $PUSH_ENDPOINT"
`;
}

instances.get('/:id/configurations/android/google_configuration_script', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'android') as any;
  const projectId = String(config?.configuration?.server_api_key?.project_id || '').trim();
  const serviceAccountEmail = String(config?.configuration?.server_api_key?.client_email || '').trim();
  const validProjectId = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId);
  const validServiceAccount = /^[a-z0-9-]{1,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)
    && serviceAccountEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`);
  if (!validProjectId || !validServiceAccount) {
    return c.json({ error: 'Upload and test the Google Play service-account key before generating the RTDN setup script' }, 409);
  }
  return c.text(buildGoogleConfigurationScript({
    instanceId,
    apiDomain: c.env.API_DOMAIN,
    projectId,
    serviceAccountEmail,
  }), 200, { 'Content-Type': 'application/x-sh; charset=utf-8' });
});

instances.get('/:id/configurations/desktop', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'desktop');
  if (!config) return c.json({ error: 'Configuration not set' }, 404);
  return c.json(configPayload(config));
});

instances.put('/:id/configurations/desktop', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'desktop', toBool(body.enabled));
  const values = [
    pick(body, 'fallback_url') || null,
    toBool(pick(body, 'generated_page'), true) ? 1 : 0,
    toBool(pick(body, 'mac_enabled'), false) ? 1 : 0,
    pick(body, 'mac_uri') || null,
    toBool(pick(body, 'windows_enabled'), false) ? 1 : 0,
    pick(body, 'windows_uri') || null,
  ];
  const existing = await findConfigId(c.env.DB, 'desktop_configurations', appId);
  if (existing) {
    await c.env.DB.prepare(`
      UPDATE desktop_configurations
      SET fallback_url = ?, generated_page = ?, mac_enabled = ?, mac_uri = ?,
          windows_enabled = ?, windows_uri = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(...values, existing).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO desktop_configurations (
        application_id, platform, fallback_url, generated_page, mac_enabled, mac_uri, windows_enabled, windows_uri
      ) VALUES (?, 'desktop', ?, ?, ?, ?, ?, ?)
    `).bind(appId, ...values).run();
  }
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'desktop')));
});

instances.delete('/:id/configurations/desktop', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const app = await c.env.DB.prepare('SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1')
    .bind(instanceId, 'desktop').first<{ id: number }>();
  if (app) {
    await c.env.DB.prepare('DELETE FROM desktop_configurations WHERE application_id = ?').bind(app.id).run();
    await c.env.DB.prepare('DELETE FROM setup_progress_steps WHERE instance_id = ? AND category = ?').bind(instanceId, 'desktop_setup').run();
  }
  return c.json({ config: null, configuration: null });
});

instances.get('/:id/configurations/web', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const config = await loadApplicationConfig(c.env.DB, instanceId, 'web');
  if (!config) return c.json({ error: 'Configuration not set' }, 404);
  return c.json(configPayload(config));
});

instances.put('/:id/configurations/web', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readBody(c);
  const appId = await getOrCreateApplication(c.env.DB, instanceId, 'web', toBool(body.enabled));
  let webConfigId = await findConfigId(c.env.DB, 'web_configurations', appId);
  if (!webConfigId) {
    await c.env.DB.prepare('INSERT INTO web_configurations (application_id) VALUES (?)').bind(appId).run();
    webConfigId = await findConfigId(c.env.DB, 'web_configurations', appId);
  }
  const domains = parseJsonArray(jsonArray(pick(body, 'domains') || []));
  await c.env.DB.prepare('DELETE FROM web_configuration_linked_domains WHERE web_configuration_id = ?')
    .bind(webConfigId).run();
  for (const domain of domains) {
    await c.env.DB.prepare(
      'INSERT INTO web_configuration_linked_domains (web_configuration_id, domain) VALUES (?, ?)'
    ).bind(webConfigId, domain).run();
  }
  return c.json(configPayload(await loadApplicationConfig(c.env.DB, instanceId, 'web')));
});

instances.delete('/:id/configurations/web', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const app = await c.env.DB.prepare('SELECT id FROM applications WHERE instance_id = ? AND platform = ? LIMIT 1')
    .bind(instanceId, 'web').first<{ id: number }>();
  if (app) {
    await c.env.DB.prepare('DELETE FROM web_configuration_linked_domains WHERE web_configuration_id IN (SELECT id FROM web_configurations WHERE application_id = ?)')
      .bind(app.id).run();
    await c.env.DB.prepare('DELETE FROM web_configurations WHERE application_id = ?').bind(app.id).run();
    await c.env.DB.prepare('DELETE FROM setup_progress_steps WHERE instance_id = ? AND category = ?').bind(instanceId, 'web_setup').run();
  }
  return c.json({ config: null, configuration: null });
});

// =================== REVENUE COLLECTION ===================

instances.put('/:id/revenue_collection', async (c) => {
  const instanceId = Number(c.req.param('id'));
  const access = await requireInstanceRole(c, instanceId, true);
  if ('error' in access) return access.error;
  const body = await readApiJson(c.req.raw);
  const enabled = body.revenue_collection_enabled === true || body.revenue_collection_enabled === 1 || body.revenue_collection_enabled === 'true';
  await c.env.DB.prepare('UPDATE instances SET revenue_collection_enabled = ?, updated_at = datetime("now") WHERE id = ?')
    .bind(enabled ? 1 : 0, instanceId).run();
  const instance = await buildInstance(c.env.DB, instanceId, access.userId, c.env.SHORTLINK_DOMAIN);
  return c.json({ instance, message: 'Revenue collection updated' });
});

// =================== SETUP & MISC ===================

instances.post('/:id/dismiss_get_started', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  await c.env.DB.prepare('UPDATE instances SET get_started_dismissed = 1 WHERE id = ?')
    .bind(instanceId).run();
  return c.json({ message: 'Dismissed' });
});

instances.get('/:id/setup_progress', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const rows = await c.env.DB.prepare(
    'SELECT step, completed, completed_at FROM setup_progress_steps WHERE instance_id = ? ORDER BY created_at ASC'
  ).bind(instanceId).all<any>();
  return c.json({
    steps: (rows.results || []).map((row: any) => ({
      step: row.step,
      completed: row.completed === 1,
      completed_at: row.completed_at,
    })),
  });
});

instances.post('/:id/setup_progress/complete', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const body = await readApiJson(c.req.raw);
  const step = body.step || body.name;
  if (!step) return c.json({ error: 'step required' }, 422);

  await c.env.DB.prepare(`
    INSERT INTO setup_progress_steps (instance_id, step, completed, completed_at)
    VALUES (?, ?, 1, datetime("now"))
    ON CONFLICT(instance_id, step) DO UPDATE SET completed = 1, completed_at = datetime("now"), updated_at = datetime("now")
  `).bind(instanceId, step).run();

  const rows = await c.env.DB.prepare(
    'SELECT step, completed, completed_at FROM setup_progress_steps WHERE instance_id = ? ORDER BY created_at ASC'
  ).bind(instanceId).all<any>();
  return c.json({
    steps: (rows.results || []).map((row: any) => ({
      step: row.step,
      completed: row.completed === 1,
      completed_at: row.completed_at,
    })),
  });
});

instances.post('/:id/exports/usage', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const role = await c.env.DB.prepare(
    'SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1'
  ).bind(userId, instanceId).first();
  if (!role) return c.json({ error: 'Forbidden' }, 403);
  const body = await readApiJson(c.req.raw) as { start_date?: string; end_date?: string };
  const startDate = (body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date))
    ? body.start_date
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDate = (body.end_date && /^\d{4}-\d{2}-\d{2}$/.test(body.end_date))
    ? body.end_date
    : new Date().toISOString().slice(0, 10);
  const production = await getOrCreateProject(c.env.DB, instanceId, 'production');
  const test = await getOrCreateProject(c.env.DB, instanceId, 'test');
  const projectIds = [String(production.id), String(test.id)];
  const rows = await c.env.DB.prepare(`
    SELECT metric_date, SUM(active_users) AS active_users
    FROM (
      SELECT date(COALESCE(event_date, date)) AS metric_date, SUM(active_users) AS active_users
      FROM project_daily_active_users
      WHERE project_id IN (?, ?)
        AND date(COALESCE(event_date, date)) BETWEEN ? AND ?
      GROUP BY date(COALESCE(event_date, date))
      UNION ALL
      SELECT date(created_at) AS metric_date, COUNT(DISTINCT device_id) AS active_users
      FROM events
      WHERE project_id IN (?, ?)
        AND date(created_at) BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM project_daily_active_users
          WHERE project_id IN (?, ?)
            AND date(COALESCE(event_date, date)) BETWEEN ? AND ?
        )
      GROUP BY date(created_at)
    )
    GROUP BY metric_date
    ORDER BY metric_date ASC
  `).bind(
    ...projectIds, startDate, endDate,
    ...projectIds, startDate, endDate,
    ...projectIds, startDate, endDate,
  ).all<any>();
  const csv = [
    csvLine(['date', 'active_users']),
    ...(rows.results || []).map((row: any) => csvLine([row.metric_date, row.active_users])),
  ].join('\n');
  const file = await storeCsvDownload(c, { prefix: 'activity_data', csv });
  const user = await c.env.DB.prepare('SELECT email FROM users WHERE id = ? LIMIT 1')
    .bind(userId).first<{ email: string }>();
  if (user?.email) {
    await sendMail(c.env, downloadFileMessage(c.env, user.email, file.name, file.url));
  }
  return c.json({ message: "Export job has been queued. You will be notified when it's ready.", url: file.url }, 202);
});

instances.post('/:id/events/billing', async (c) => {
  const userId = await getAuthUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const instanceId = Number(c.req.param('id'));
  const role = await c.env.DB.prepare(
    'SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1'
  ).bind(userId, instanceId).first();
  if (!role) return c.json({ error: 'Forbidden' }, 403);

  const body = await readApiJson(c.req.raw) as { start_date?: string; end_date?: string };
  const startDate = (body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date))
    ? body.start_date
    : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const endDate = (body.end_date && /^\d{4}-\d{2}-\d{2}$/.test(body.end_date))
    ? body.end_date
    : new Date().toISOString().slice(0, 10);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const metrics: Record<string, number> = {};

  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    metrics[date.toISOString().slice(0, 10)] = 0;
  }

  const production = await getOrCreateProject(c.env.DB, instanceId, 'production');
  const test = await getOrCreateProject(c.env.DB, instanceId, 'test');
  const projectIds = [String(production.id), String(test.id)];
  const daily = await c.env.DB.prepare(`
    SELECT COALESCE(event_date, date) AS metric_date, SUM(active_users) AS active_users
    FROM project_daily_active_users
    WHERE project_id IN (?, ?)
      AND date(COALESCE(event_date, date)) BETWEEN ? AND ?
    GROUP BY metric_date
  `).bind(...projectIds, startDate, endDate).all<any>();

  for (const row of daily.results || []) {
    const key = String(row.metric_date).slice(0, 10);
    if (key in metrics) metrics[key] = Number(row.active_users || 0);
  }

  const hasDailyValues = Object.values(metrics).some((value) => value > 0);
  if (!hasDailyValues) {
    const events = await c.env.DB.prepare(`
      SELECT date(created_at) AS metric_date, COUNT(DISTINCT device_id) AS active_users
      FROM events
      WHERE project_id IN (?, ?)
        AND date(created_at) BETWEEN ? AND ?
      GROUP BY date(created_at)
    `).bind(...projectIds, startDate, endDate).all<any>();
    for (const row of events.results || []) {
      const key = String(row.metric_date).slice(0, 10);
      if (key in metrics) metrics[key] = Number(row.active_users || 0);
    }
  }

  return c.json({ metrics_values: metrics });
});

export default instances;
