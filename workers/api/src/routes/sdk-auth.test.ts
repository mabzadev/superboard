import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sdkMiddleware } from '../middleware/auth';
import { AppVariables, Env } from '../types';
import sdkRoutes from './sdk';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

function sdkFixture() {
  const state = {
    instances: [{ id: 10, api_key: 'server-api-key', uri_scheme: 'prodapp' }],
    projects: [
      { id: 101, instance_id: 10, identifier: 'mobile-prod-key', is_test: 0, name: 'Production' },
      { id: 102, instance_id: 10, identifier: 'mobile-test-key', is_test: 1, name: 'Test' },
      { id: 201, instance_id: 11, identifier: 'other-prod-key', is_test: 0, name: 'Other' },
    ],
    applications: [
      { id: 1, instance_id: 10, platform: 'ios', identifier: 'com.opengrow.ios' },
      { id: 2, instance_id: 10, platform: 'android', identifier: 'com.opengrow.android' },
      { id: 3, instance_id: 10, platform: 'web', identifier: 'app.opengrow.test' },
      { id: 4, instance_id: 10, platform: 'desktop', identifier: 'io.opengrow.desktop' },
    ],
    visitors: [
      { id: 'visitor-101', uuid: 'uuid-101', project_id: 101, device_id: 500, platform: 'ios', push_token: null, sdk_identifier: 'user-101', sdk_attributes: JSON.stringify({ tier: 'gold' }) },
      { id: 'visitor-201', uuid: 'uuid-201', project_id: 201, device_id: 600, platform: 'ios', push_token: null, sdk_identifier: null, sdk_attributes: null },
    ],
    devices: [{ id: 500, push_token: null }],
    redirectConfigs: [{ id: 301, project_id: 101, default_fallback: '' }],
    domains: [{ id: 401, project_id: 101, domain: 'go.test' }],
    links: [
      { id: 701, path: 'existing', title: 'Existing', name: 'Existing', subtitle: null, image_url: null, data: '{}', tags: '[]', redirect_config_id: 301, domain_id: 401, active: 1, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
    ] as any[],
    notificationMessages: [
      { message_id: 901, notification_id: 801, visitor_id: 'visitor-101', read: 0, updated_at: '2026-01-01T00:00:00.000Z', title: 'Welcome', subtitle: 'Hello', auto_display: 1, notification_updated_at: '2026-01-01T00:00:00.000Z' },
      { message_id: 902, notification_id: 802, visitor_id: 'visitor-101', read: 1, updated_at: '2026-01-01T00:00:00.000Z', title: 'Read', subtitle: 'Done', auto_display: 0, notification_updated_at: '2026-01-01T00:00:00.000Z' },
    ],
    events: [] as any[],
  };
  const db = createFakeD1((call) => sdkD1Handler(call, state));
  const env = {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'sdk-secret',
  } satisfies Env;
  return { env, state };
}

function sdkD1Handler(call: FakeD1Call, state: ReturnType<typeof sdkFixture>['state']) {
  const { op, sql, args } = call;

  if (op === 'first' && sql.includes('FROM projects WHERE identifier = ?')) {
    return state.projects.find((project) => project.identifier === args[0]) || null;
  }

  if (op === 'first' && sql.includes('FROM instances WHERE api_key = ?')) {
    return state.instances.find((instance) => instance.api_key === args[0]) || null;
  }

  if (op === 'first' && sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) {
    return state.projects.find((project) => project.instance_id === Number(args[0]) && project.is_test === Number(args[1])) || null;
  }

  if (op === 'first' && sql.includes('FROM instances WHERE id = ? LIMIT 1')) {
    return state.instances.find((instance) => instance.id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.includes("JOIN ios_configurations")) {
    const [instanceId, identifier] = args;
    return state.applications.find((app) => app.instance_id === Number(instanceId) && app.platform === 'ios' && app.identifier === identifier) || null;
  }

  if (op === 'first' && sql.includes("JOIN android_configurations")) {
    const [instanceId, identifier] = args;
    return state.applications.find((app) => app.instance_id === Number(instanceId) && app.platform === 'android' && app.identifier === identifier) || null;
  }

  if (op === 'first' && sql.includes("JOIN web_configurations")) {
    const [instanceId, identifier] = args;
    return state.applications.find((app) => app.instance_id === Number(instanceId) && app.platform === 'web' && app.identifier === identifier) || null;
  }

  if (op === 'first' && sql.includes("JOIN desktop_configurations")) {
    const [instanceId, identifier] = args;
    return state.applications.find((app) => app.instance_id === Number(instanceId) && app.platform === 'desktop' && app.identifier === identifier) || null;
  }

  if (op === 'first' && sql.includes('FROM projects WHERE id = ? AND instance_id = ?')) {
    return state.projects.find((project) => project.id === Number(args[0]) && project.instance_id === Number(args[1])) || null;
  }

  if (op === 'first' && sql.includes('FROM visitors v JOIN devices d ON d.id = v.device_id')) {
    const linksquared = String(args[0]);
    const projectId = Number(args[2]);
    return state.visitors.find((visitor) => (visitor.id === linksquared || visitor.uuid === linksquared) && visitor.project_id === projectId) || null;
  }

  if (op === 'first' && sql.includes('SELECT id FROM redirect_configs WHERE project_id = ?')) {
    return state.redirectConfigs.find((config) => config.project_id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.startsWith('SELECT id FROM domains WHERE project_id = ?')) {
    return state.domains.find((domain) => domain.project_id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.startsWith('SELECT id FROM links WHERE path = ?')) {
    return state.links.find((link) => link.path === args[0]) || null;
  }

  if (op === 'first' && sql.startsWith('INSERT INTO links')) {
    const link = {
      id: state.links.length + 701,
      path: String(args[0]),
      title: args[1],
      subtitle: args[2],
      image_url: args[3],
      data: args[4],
      tags: args[5],
      redirect_config_id: args[6],
      domain_id: args[7],
      visitor_id: sql.includes('visitor_id') ? args[8] : null,
      tracking_source: sql.includes('visitor_id') ? args[9] : args[8],
      tracking_medium: sql.includes('visitor_id') ? args[10] : args[9],
      tracking_campaign: sql.includes('visitor_id') ? args[11] : args[10],
      generated_from_platform: 'sdk',
      sdk_generated: 1,
      active: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.links.push(link);
    return link;
  }

  if (op === 'first' && sql.includes('FROM links l LEFT JOIN domains d ON d.id = l.domain_id')) {
    const path = String(args[0]);
    const projectId = Number(args[1]);
    return state.links.find((link) => {
      const domain = state.domains.find((candidate) => candidate.id === Number(link.domain_id));
      const config = state.redirectConfigs.find((candidate) => candidate.id === Number(link.redirect_config_id));
      return link.path === path && (domain?.project_id === projectId || config?.project_id === projectId);
    }) || null;
  }

  if (op === 'run' && sql.startsWith('UPDATE visitors')) {
    const visitor = state.visitors.find((candidate) => candidate.id === args[2]);
    if (visitor) {
      if (args[0]) visitor.sdk_identifier = String(args[0]);
      if (args[1]) visitor.sdk_attributes = String(args[1]);
    }
    return true;
  }

  if (op === 'run' && sql.startsWith('UPDATE devices SET push_token')) {
    const device = state.devices.find((candidate) => candidate.id === Number(args[1]));
    if (device) device.push_token = args[0];
    return true;
  }

  if (op === 'first' && sql.startsWith('SELECT * FROM visitors WHERE id = ?')) {
    return state.visitors.find((visitor) => visitor.id === args[0]) || null;
  }

  if (op === 'first' && sql.startsWith('SELECT id FROM visitors WHERE project_id = ? AND device_id = ?')) {
    const visitor = state.visitors.find((candidate) => candidate.project_id === Number(args[0]) && candidate.device_id === Number(args[1]));
    return visitor ? { id: visitor.id } : null;
  }

  if (op === 'all' && sql.includes('FROM notification_messages nm JOIN notifications n')) {
    const visitorId = String(args[0]);
    return state.notificationMessages.filter((message) => {
      if (message.visitor_id !== visitorId) return false;
      if (sql.includes('COALESCE(nm.read, 0) = 0') && message.read !== 0) return false;
      if (sql.includes('COALESCE(n.auto_display, 0) = 1') && message.auto_display !== 1) return false;
      return true;
    });
  }

  if (op === 'first' && sql.includes('SELECT COUNT(*) AS total FROM notification_messages')) {
    return { total: state.notificationMessages.filter((message) => message.visitor_id === args[0] && message.read === 0).length };
  }

  if (op === 'first' && sql.startsWith('UPDATE notification_messages')) {
    const message = state.notificationMessages.find((candidate) => candidate.message_id === Number(args[0]) && candidate.visitor_id === args[1]);
    if (!message) return null;
    message.read = 1;
    return { id: message.message_id };
  }

  if (op === 'run' && sql.startsWith('INSERT INTO events')) {
    state.events.push({
      device_id: args[0],
      project_id: args[1],
      link_id: args[2],
      event: args[3],
      platform: args[4],
      engagement_time: args[5],
    });
    return true;
  }

  return undefined;
}

function probeApp() {
  const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
  app.use('*', sdkMiddleware);
  app.post('/authenticate', (c) => c.json({
    mode: c.get('sdkAuthMode'),
    instanceId: c.get('instanceId'),
    projectId: c.get('projectId'),
    platform: c.get('sdkPlatform'),
    identifier: c.get('sdkIdentifier'),
  }));
  app.post('/generate_link', (c) => c.json({
    mode: c.get('sdkAuthMode'),
    instanceId: c.get('instanceId'),
    projectId: c.get('projectId'),
  }));
  return app;
}

describe('SDK auth contract', () => {
  it('accepts the dashboard access key for the production mobile project', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/authenticate', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'server-api-key',
        PLATFORM: 'android',
        IDENTIFIER: 'com.opengrow.android',
      },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'mobile',
      instanceId: 10,
      projectId: 101,
      platform: 'android',
      identifier: 'com.opengrow.android',
    });
  });

  it('accepts the test-prefixed dashboard access key for the test mobile project', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/authenticate', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'test_server-api-key',
        PLATFORM: 'android',
        IDENTIFIER: 'com.opengrow.android',
      },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'mobile',
      instanceId: 10,
      projectId: 102,
      platform: 'android',
      identifier: 'com.opengrow.android',
    });
  });

  it('accepts mobile SDK auth only when project key, platform and configured identifier match', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/authenticate', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'mobile-prod-key',
        PLATFORM: 'ios',
        IDENTIFIER: 'com.opengrow.ios',
      },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'mobile',
      instanceId: 10,
      projectId: 101,
      platform: 'ios',
      identifier: 'com.opengrow.ios',
    });
  });

  it('rejects mobile SDK auth for the wrong Android package', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/authenticate', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'mobile-prod-key',
        PLATFORM: 'android',
        IDENTIFIER: 'com.attacker.app',
      },
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid platform configuration' });
  });

  it('rejects mobile SDK auth for the wrong web linked domain', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/authenticate', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'mobile-prod-key',
        PLATFORM: 'web',
        IDENTIFIER: 'evil.example',
      },
    }, env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid platform configuration' });
  });

  it('accepts server SDK auth only with instance api key and production/test environment', async () => {
    const { env } = sdkFixture();
    const response = await probeApp().request('/generate_link', {
      method: 'POST',
      headers: {
        'PROJECT-KEY': 'server-api-key',
        ENVIRONMENT: 'test',
      },
    }, env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: 'server',
      instanceId: 10,
      projectId: 102,
    });
  });

  it('rejects server SDK auth when ENVIRONMENT is absent or invalid', async () => {
    const { env } = sdkFixture();
    expect((await probeApp().request('/generate_link', {
      method: 'POST',
      headers: { 'PROJECT-KEY': 'server-api-key' },
    }, env)).status).toBe(401);

    expect((await probeApp().request('/generate_link', {
      method: 'POST',
      headers: { 'PROJECT-KEY': 'server-api-key', ENVIRONMENT: 'staging' },
    }, env)).status).toBe(401);
  });

  it('rejects LINKSQUARED visitors from another project', async () => {
    const { env, state } = sdkFixture();
    const response = await sdkRoutes.request('/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PROJECT-KEY': 'mobile-prod-key',
        PLATFORM: 'ios',
        IDENTIFIER: 'com.opengrow.ios',
        LINKSQUARED: 'visitor-201',
      },
      body: JSON.stringify({ event: 'app_open' }),
    }, env);

    expect(response.status).toBe(403);
    expect(state.events).toHaveLength(0);
  });

  it('ingests SDK events for the current project visitor', async () => {
    const { env, state } = sdkFixture();
    const response = await sdkRoutes.request('/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PROJECT-KEY': 'mobile-prod-key',
        PLATFORM: 'ios',
        IDENTIFIER: 'com.opengrow.ios',
        LINKSQUARED: 'visitor-101',
      },
      body: JSON.stringify({ event: 'purchase', engagement_time: 42 }),
    }, env);

    expect(response.status).toBe(200);
    expect(state.events).toMatchObject([{ device_id: 500, project_id: 101, event: 'purchase', platform: 'ios', engagement_time: 42 }]);
  });

  it('creates SDK links and reads them back scoped to the server SDK project', async () => {
    const { env, state } = sdkFixture();
    const create = await sdkRoutes.request('/generate_link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PROJECT-KEY': 'server-api-key',
        ENVIRONMENT: 'production',
      },
      body: JSON.stringify({ path: 'server-link', title: 'Server Link', data: { campaign: 'spring' } }),
    }, env);
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toEqual({ link: '/server-link' });
    expect(state.links.some((link) => link.path === 'server-link')).toBe(true);

    const read = await sdkRoutes.request('/link/server-link', {
      headers: {
        'PROJECT-KEY': 'server-api-key',
        ENVIRONMENT: 'production',
      },
    }, env);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ link: { path: 'server-link', title: 'Server Link', data: { campaign: 'spring' } } });
  });

  it('reads and updates visitor attributes including push token', async () => {
    const { env, state } = sdkFixture();
    const headers = {
      'Content-Type': 'application/json',
      'PROJECT-KEY': 'mobile-prod-key',
      PLATFORM: 'ios',
      IDENTIFIER: 'com.opengrow.ios',
      LINKSQUARED: 'visitor-101',
    };

    const current = await sdkRoutes.request('/visitor_attributes', { headers }, env);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({ visitor: { id: 'visitor-101', sdk_identifier: 'user-101', sdk_attributes: { tier: 'gold' } } });

    const update = await sdkRoutes.request('/visitor_attributes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ sdk_identifier: 'user-updated', sdk_attributes: { tier: 'platinum' }, push_token: 'push-token-1' }),
    }, env);

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ visitor: { id: 'visitor-101', sdk_identifier: 'user-updated', sdk_attributes: { tier: 'platinum' } } });
    expect(state.devices[0].push_token).toBe('push-token-1');
  });

  it('lists unread notifications and marks them as read', async () => {
    const { env } = sdkFixture();
    const headers = {
      'Content-Type': 'application/json',
      'PROJECT-KEY': 'mobile-prod-key',
      PLATFORM: 'ios',
      IDENTIFIER: 'com.opengrow.ios',
    };

    const unread = await sdkRoutes.request('/notifications?device_id=500&project_id=101', { headers }, env);
    expect(unread.status).toBe(200);
    await expect(unread.json()).resolves.toMatchObject({ notifications: [{ id: '901', read: false, title: 'Welcome' }] });

    const count = await sdkRoutes.request('/number_of_unread_notifications?device_id=500&project_id=101', { headers }, env);
    expect(count.status).toBe(200);
    await expect(count.json()).resolves.toEqual({ number_of_unread_notifications: 1 });

    const mark = await sdkRoutes.request('/mark_notification_as_read', {
      method: 'POST',
      headers,
      body: JSON.stringify({ device_id: 500, project_id: 101, id: 901 }),
    }, env);
    expect(mark.status).toBe(200);

    const after = await sdkRoutes.request('/number_of_unread_notifications?device_id=500&project_id=101', { headers }, env);
    await expect(after.json()).resolves.toEqual({ number_of_unread_notifications: 0 });
  });
});
