import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth';

describe('Billing internal authentication', () => {
  it('accepts an API-authenticated actor only inside the private Billing execution domain', async () => {
    const app = new Hono<any>();
    app.use('*', authMiddleware as any);
    app.get('/actor', (c) => c.json({ actor: c.get('userId') }));
    const response = await app.request('/actor', {
      headers: { 'X-OpenGrow-Internal-Actor': '42' },
    }, {
      CREDENTIAL_KEY_SCOPE: 'billing',
      DB: { prepare: vi.fn(() => { throw new Error('DB authentication must not run'); }) },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: 42 });
  });

  it('rejects a forged internal actor header on the public API', async () => {
    const app = new Hono<any>();
    app.use('*', authMiddleware as any);
    app.get('/actor', (c) => c.json({ actor: c.get('userId') }));
    const response = await app.request('/actor', {
      headers: { 'X-OpenGrow-Internal-Actor': '42' },
    }, { CREDENTIAL_KEY_SCOPE: 'api', DB: {} });
    expect(response.status).toBe(401);
  });
});
