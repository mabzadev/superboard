import { describe, expect, it } from 'vitest';
import redirectRoutes from './redirect';
import { Env } from '../types';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

function redirectFixture(overrides: Record<string, unknown> = {}) {
  const state = {
    devices: [] as any[],
    actions: [] as any[],
    events: [] as any[],
    quickLinks: [] as any[],
    domains: [{ id: 1, domain: 'go.test' }],
    notifications: [{ id: 'message-1', html: '<h1 onclick="alert(1)">Hello</h1><script>alert(1)</script><a href="javascript:bad()">bad</a>' }],
    link: {
      id: 77,
      path: 'promo',
      redirect_config_id: 12,
      title: 'Promo',
      subtitle: 'Install the app',
      image_url: null,
      data: JSON.stringify({ deeplink: 'opengrow://promo' }),
      default_fallback: 'https://fallback.test/promo',
      project_id: 101,
      instance_id: 10,
      project_name: 'Production',
      uri_scheme: 'opengrow',
      show_preview_ios: null,
      show_preview_android: null,
      config_show_preview_ios: 0,
      config_show_preview_android: 0,
      quota_exceeded: 0,
      generic_title: null,
      generic_subtitle: null,
      generic_image_url: null,
      active: 1,
      ...overrides,
    },
  };
  const db = createFakeD1((call) => redirectD1Handler(call, state));
  const env = {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    APP_URL: 'https://dashboard.test',
    JWT_SECRET: 'redirect-secret',
  } satisfies Env;
  return { env, state };
}

function redirectD1Handler(call: FakeD1Call, state: ReturnType<typeof redirectFixture>['state']) {
  const { op, sql, args } = call;

  if (op === 'first' && sql.includes('FROM quick_links WHERE path = ?')) {
    return state.quickLinks.find((link) => link.path === args[0]) || null;
  }

  if (op === 'first' && sql.includes('SELECT html FROM notifications')) {
    return state.notifications.find((notification) => notification.id === args[0]) || null;
  }

  if (op === 'first' && sql.includes('SELECT id FROM domains')) {
    return state.domains[0] || null;
  }

  if (op === 'first' && sql.startsWith('INSERT INTO quick_links')) {
    const link = {
      id: args[0],
      domain_id: args[1],
      path: args[2],
      title: args[3],
      subtitle: args[4],
      image_url: args[5],
      ios_phone: args[6],
      ios_tablet: args[7],
      android_phone: args[8],
      android_tablet: args[9],
      desktop: args[10],
      desktop_linux: args[11],
      desktop_mac: args[12],
      desktop_windows: args[13],
      name: args[14],
      url: args[15],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.quickLinks.push(link);
    return link;
  }

  if (op === 'first' && sql.includes('FROM links l JOIN redirect_configs')) {
    return state.link.path === args[0] && state.link.active === 1 ? state.link : null;
  }

  if (op === 'first' && sql.includes('SELECT id FROM devices WHERE ip = ? AND user_agent = ?')) {
    return state.devices.find((device) => device.ip === args[0] && device.user_agent === args[1]) || null;
  }

  if (op === 'first' && sql.startsWith('INSERT INTO devices')) {
    const device = { id: state.devices.length + 1, ip: args[0], remote_ip: args[1], user_agent: args[2], platform: args[3] };
    state.devices.push(device);
    return { id: device.id };
  }

  if (op === 'run' && sql.startsWith('UPDATE devices SET remote_ip')) return true;

  if (op === 'run' && sql.startsWith('INSERT INTO actions')) {
    state.actions.push({ device_id: args[0], link_id: args[1] });
    return true;
  }

  if (op === 'run' && sql.startsWith('INSERT INTO events')) {
    state.events.push({ device_id: args[0], project_id: args[1], link_id: args[2], platform: args[3], ip: args[4] });
    return true;
  }

  if (op === 'first' && sql.includes('FROM custom_redirects')) return null;

  if (op === 'first' && sql.includes('FROM redirects')) {
    const platform = String(args[1]);
    if (platform === 'ios') return { fallback_url: 'https://apps.apple.test/opengrow', appstore: 0 };
    if (platform === 'android') return { fallback_url: 'https://play.test/opengrow', appstore: 0 };
    return { fallback_url: 'https://desktop.test/promo', appstore: 0 };
  }

  return undefined;
}

describe('public redirects', () => {
  it('redirects the short-link root and unknown links to the dashboard', async () => {
    const { env } = redirectFixture();
    const root = await redirectRoutes.request('/', { redirect: 'manual' }, env);
    const unknown = await redirectRoutes.request(
      '/unknown',
      { redirect: 'manual' },
      env,
    );

    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('https://dashboard.test');
    expect(unknown.status).toBe(302);
    expect(unknown.headers.get('location')).toBe('https://dashboard.test');
  });

  it('stops before side effects when quota is exceeded', async () => {
    const { env, state } = redirectFixture({ quota_exceeded: 1 });
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(402);
    expect(await response.text()).toContain('Link temporarily unavailable');
    expect(state.devices).toHaveLength(0);
    expect(state.actions).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it('creates an action but suppresses view events for bots', async () => {
    const { env, state } = redirectFixture();
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Googlebot/2.1', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(200);
    expect(state.actions).toHaveLength(1);
    expect(state.events).toHaveLength(0);
  });

  it('forces fallback redirects without recording a view event', async () => {
    const { env, state } = redirectFixture();
    const response = await redirectRoutes.request('/promo?go_to_fallback=true', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'CF-Connecting-IP': '203.0.113.10' },
      redirect: 'manual',
    }, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://desktop.test/promo');
    expect(state.actions).toHaveLength(1);
    expect(state.events).toHaveLength(0);
  });

  it('renders iOS preview HTML when preview is enabled', async () => {
    const { env, state } = redirectFixture({ show_preview_ios: 1 });
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Open the App Store');
    expect(state.events).toHaveLength(1);
  });

  it('renders iOS app-link handling HTML with deeplink and fallback', async () => {
    const { env } = redirectFixture();
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('opengrow://promo');
    expect(html).toContain('https://apps.apple.test/opengrow');
  });

  it('renders Android app-link handling HTML with deeplink and fallback', async () => {
    const { env } = redirectFixture();
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel)', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('opengrow://promo');
    expect(html).toContain('https://play.test/opengrow');
  });

  it('renders desktop fallback HTML for desktop users', async () => {
    const { env } = redirectFixture();
    const response = await redirectRoutes.request('/promo', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'CF-Connecting-IP': '203.0.113.10' },
    }, env);

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('https://desktop.test/promo');
    expect(html).toContain('Continue');
  });

  it('stores uploaded quick-link images in R2 and returns an asset URL', async () => {
    const { env, state } = redirectFixture();
    const puts: any[] = [];
    env.R2 = {
      put: async (key: string, value: unknown, options: unknown) => {
        puts.push({ key, value, options });
        return null as any;
      },
    } as any;

    const form = new FormData();
    form.set('title', 'Quick Link');
    form.set('desktop', 'https://desktop.test/quick');
    form.set('image', new File(['fake image'], 'image.png', { type: 'image/png' }));

    const response = await redirectRoutes.request('/create', { method: 'POST', body: form }, env);
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toMatch(/^quick-links\/.+-image\.png$/);
    expect(body.link.image_url).toContain('/quick-link-assets/');
    expect(state.quickLinks[0].image_url).toBe(body.link.image_url);
  });

  it('sanitizes marketing message HTML before rendering', async () => {
    const { env } = redirectFixture();
    const response = await redirectRoutes.request('/mm/message-1', {}, env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
  });
});
