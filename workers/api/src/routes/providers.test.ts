import { afterEach, describe, expect, it, vi } from 'vitest';
import { importPKCS8, SignJWT } from 'jose';
import iapRoutes from './iap';
import { processPushNotifications } from './push';
import webhooksRoutes from './webhooks';
import { Env } from '../types';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function stripeSignature(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return `t=${timestamp},v1=${hex(digest)}`;
}

function pemFromPkcs8(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) || [];
  return ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----'].join('\n'); // gitleaks:allow -- generated in memory
}

async function googleServiceAccountJson() {
  const key = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  return JSON.stringify({
    client_email: 'play-verifier@example.iam.gserviceaccount.com',
    private_key: pemFromPkcs8(await crypto.subtle.exportKey('pkcs8', key.privateKey)),
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

const APPLE_TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgUYK/s2lykibsPHRx
t5O+q5mPac40KS7w70sceiJpkqahRANCAASn9fQNVFY7zCgEmgBHa5K/usJvv2uF
KkdCuMjGCLv9opM4FtfHh7B12Lda2kSkkb0MmR0ApE+xynsuyibIyJ6Q
-----END PRIVATE KEY-----`;

const APPLE_TEST_CERT_B64 = 'MIIBhzCCAS2gAwIBAgIUOTNPxqaK2FoU8rnGnPg01L1sgDUwCgYIKoZIzj0EAwIwGTEXMBUGA1UEAwwOQXBwbGUgVGVzdCBJQVAwHhcNMjYwNTI3MTgzNjUyWhcNMjcwNTI3MTgzNjUyWjAZMRcwFQYDVQQDDA5BcHBsZSBUZXN0IElBUDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKf19A1UVjvMKASaAEdrkr+6wm+/a4UqR0K4yMYIu/2ikzgW18eHsHXYt1raRKSRvQyZHQCkT7HKey7KJsjInpCjUzBRMB0GA1UdDgQWBBR2ysPxUxgCzl9KrFIlUjPvK+xSuzAfBgNVHSMEGDAWgBR2ysPxUxgCzl9KrFIlUjPvK+xSuzAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQCuXAaaLJPhOprXQjJQoeOliVN64wqfPqb9dCjB9p0VqgIgZsvRe8FIHy20Ixz7cgsJPF+N0BfEddXfydjTltt0H0k=';

async function signedAppleJws(payload: Record<string, unknown>) {
  const key = await importPKCS8(APPLE_TEST_PRIVATE_KEY, 'ES256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', x5c: [APPLE_TEST_CERT_B64] })
    .sign(key);
}

function baseEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'providers-secret',
    ...overrides,
  };
}

function projectDb(state: { webhooks: any[]; purchases: any[]; subscriptions: any[] }) {
  return createFakeD1((call: FakeD1Call) => {
    const { op, sql, args } = call;
    if (op === 'first' && sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) {
      return { id: Number(args[1]) === 1 ? 102 : 101, instance_id: Number(args[0]), is_test: Number(args[1]), name: 'Production', identifier: 'prod' };
    }
    if (op === 'run' && sql.startsWith('INSERT INTO iap_webhook_messages')) {
      state.webhooks.push({ source: args[0], notification_type: args[2], instance_id: args[5], project_id: args[6] });
      return true;
    }
    if (op === 'run' && sql.startsWith('INSERT INTO purchase_events')) {
      state.purchases.push({ project_id: args[0], product_id: args[1], transaction_id: args[2], event_type: args[5], purchase_type: args[6] });
      return true;
    }
    if (op === 'run' && sql.startsWith('INSERT INTO subscription_states')) {
      state.subscriptions.push({ project_id: args[0], product_id: args[1], transaction_id: args[2], status: args[7] });
      return true;
    }
    return undefined;
  });
}

function queuedAppleDb(state: { event: { id: string; status: string } | null; queueFailures: number }) {
  return createFakeD1((call: FakeD1Call) => {
    const { op, sql, args } = call;
    if (op === 'first' && sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) {
      return { id: 101, instance_id: Number(args[0]), is_test: Number(args[1]), name: 'Production', identifier: 'prod' };
    }
    if (op === 'run' && sql.startsWith('INSERT OR IGNORE INTO billing_webhook_events')) {
      if (state.event) return { success: true, meta: { changes: 0 } };
      state.event = { id: String(args[0]), status: 'received' };
      return true;
    }
    if (op === 'first' && sql.includes("store = 'apple'") && sql.includes('external_event_id = ?')) {
      return state.event;
    }
    if (op === 'run' && sql.startsWith('UPDATE billing_webhook_events') && sql.includes("status = 'failed'")) {
      if (state.event) state.event.status = 'failed';
      state.queueFailures += 1;
      return true;
    }
    return undefined;
  });
}

function stripeDb(state: { messages: Map<string, { processed: number }> }) {
  return createFakeD1((call: FakeD1Call) => {
    const { op, sql, args } = call;
    if (op === 'first' && sql.includes('FROM stripe_webhook_messages WHERE stripe_event_id = ?')) {
      return state.messages.get(String(args[0])) || null;
    }
    if (op === 'run' && sql.startsWith('INSERT INTO stripe_webhook_messages')) {
      state.messages.set(String(args[0]), { processed: 0 });
      return true;
    }
    if (op === 'run' && sql.startsWith('UPDATE stripe_webhook_messages SET processed = 1')) {
      const row = state.messages.get(String(args[0]));
      if (row) row.processed = 1;
      return true;
    }
    return undefined;
  });
}

function pushDb(rows: any[], state: { updates: any[] }) {
  return createFakeD1((call: FakeD1Call) => {
    const { op, sql, args } = call;
    if (op === 'all' && sql.includes('FROM rpush_notifications rn JOIN rpush_apps ra')) {
      return rows;
    }
    if (op === 'run' && sql.startsWith('UPDATE rpush_notifications SET processing = 1')) {
      state.updates.push({ type: 'processing', id: args[0] });
      return true;
    }
    if (op === 'run' && sql.includes('SET delivered = 1')) {
      state.updates.push({ type: 'delivered', id: args[0] });
      return true;
    }
    if (op === 'run' && sql.includes('SET failed = ?')) {
      state.updates.push({
        type: 'failed',
        failed: args[0],
        message: args[2],
        retries: args[3],
        id: args[6],
      });
      return true;
    }
    return undefined;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Stripe webhooks', () => {
  it('rejects invalid Stripe signatures', async () => {
    const env = baseEnv(stripeDb({ messages: new Map() }), { STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const response = await webhooksRoutes.request('/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=1,v1=bad' },
      body: JSON.stringify({ id: 'evt_bad', type: 'noop.event' }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('accepts signed Stripe webhooks once and treats replay as idempotent', async () => {
    const state = { messages: new Map<string, { processed: number }>() };
    const env = baseEnv(stripeDb(state), { STRIPE_WEBHOOK_SECRET: 'whsec_test' });
    const payload = JSON.stringify({ id: 'evt_1', type: 'noop.event', data: { object: {} } });
    const signature = await stripeSignature('whsec_test', payload);

    const first = await webhooksRoutes.request('/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': signature },
      body: payload,
    }, env);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ message: 'Stripe webhook processed' });

    const replay = await webhooksRoutes.request('/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': signature },
      body: payload,
    }, env);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ message: 'Stripe webhook already processed' });
  });
});

describe('IAP webhooks', () => {
  it('returns a retryable failure when a persisted Apple notification cannot enter the queue', async () => {
    const state = { event: null as { id: string; status: string } | null, queueFailures: 0 };
    const send = vi.fn(async () => { throw new Error('queue unavailable'); });
    const env = baseEnv(queuedAppleDb(state), {
      ENVIRONMENT: 'production',
      BILLING_QUEUE: { send } as unknown as Queue,
    });

    const response = await iapRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'header.payload.signature' }),
    }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ retryable: true });
    expect(state.event?.status).toBe('failed');
    expect(state.queueFailures).toBe(1);
  });

  it('requeues an Apple notification replay while its durable event is not processed', async () => {
    const state = { event: null as { id: string; status: string } | null, queueFailures: 0 };
    const send = vi.fn(async () => undefined);
    const env = baseEnv(queuedAppleDb(state), {
      ENVIRONMENT: 'production',
      BILLING_QUEUE: { send } as unknown as Queue,
    });
    const request = () => iapRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'header.payload.signature' }),
    }, env);

    expect((await request()).status).toBe(202);
    const replay = await request();

    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ duplicate: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map(([job]) => (job as { eventId: string }).eventId)).size).toBe(1);
  });

  it('accepts signed Apple JWS fixtures and persists subscription state', async () => {
    const state = { webhooks: [] as any[], purchases: [] as any[], subscriptions: [] as any[] };
    const transaction = await signedAppleJws({
      transactionId: 'apple-tx-1',
      originalTransactionId: 'apple-original-1',
      productId: 'premium_monthly',
      type: 'Auto-Renewable Subscription',
      price: 9990000,
      currency: 'USD',
      purchaseDate: Date.now(),
      expiresDate: Date.now() + 30 * 86400_000,
    });
    const signedPayload = await signedAppleJws({
      notificationType: 'DID_RENEW',
      data: { signedTransactionInfo: transaction },
    });

    const response = await iapRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedPayload }),
    }, baseEnv(projectDb(state), { ENVIRONMENT: 'production', IAP_ALLOW_UNSIGNED_FIXTURES: 'true' }));

    expect(response.status).toBe(200);
    expect(state.webhooks).toHaveLength(1);
    expect(state.purchases).toMatchObject([{ product_id: 'premium_monthly', transaction_id: 'apple-tx-1', event_type: 'buy', purchase_type: 'subscription' }]);
    expect(state.subscriptions).toHaveLength(1);
  });

  it('rejects unsigned Apple production payloads', async () => {
    const state = { webhooks: [] as any[], purchases: [] as any[], subscriptions: [] as any[] };
    const env = baseEnv(projectDb(state), { ENVIRONMENT: 'production' });
    const response = await iapRoutes.request('/apple/production/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notificationType: 'DID_RENEW', transactionInfo: { transactionId: 'tx_1' } }),
    }, env);

    expect(response.status).toBe(400);
    expect(state.webhooks).toHaveLength(0);
  });

  it('rejects Google RTDN without the configured production token', async () => {
    const env = baseEnv(projectDb({ webhooks: [], purchases: [], subscriptions: [] }), {
      ENVIRONMENT: 'production',
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: 'expected-token',
    });
    const response = await iapRoutes.request('/google/10?token=wrong-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionNotification: { purchaseToken: 'gpa-token', subscriptionId: 'premium' } }),
    }, env);

    expect(response.status).toBe(400);
  });

  it('persists Google signed-fixture-equivalent subscription events when test fixtures are explicitly enabled', async () => {
    const state = { webhooks: [] as any[], purchases: [] as any[], subscriptions: [] as any[] };
    const env = baseEnv(projectDb(state), { IAP_ALLOW_UNSIGNED_FIXTURES: 'true' });
    const response = await iapRoutes.request('/google/10', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriptionNotification: {
          notificationType: 'SUBSCRIPTION_PURCHASED',
          purchaseToken: 'purchase-token',
          subscriptionId: 'premium_monthly',
        },
        eventTimeMillis: String(Date.now()),
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(state.webhooks).toHaveLength(1);
    expect(state.purchases).toMatchObject([{ product_id: 'premium_monthly', transaction_id: 'purchase-token', event_type: 'buy', purchase_type: 'subscription' }]);
    expect(state.subscriptions).toHaveLength(1);
  });

  it('requires Google Play purchase verification credentials in production after RTDN token validation', async () => {
    const env = baseEnv(projectDb({ webhooks: [], purchases: [], subscriptions: [] }), {
      ENVIRONMENT: 'production',
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: 'expected-token',
    });
    const response = await iapRoutes.request('/google/10?token=expected-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageName: 'com.opengrow.android',
        subscriptionNotification: { notificationType: 'SUBSCRIPTION_PURCHASED', purchaseToken: 'purchase-token', subscriptionId: 'premium_monthly' },
      }),
    }, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Google Play verification is not configured' });
  });

  it('verifies Google subscription purchases with the Android Publisher API when credentials are configured', async () => {
    const state = { webhooks: [] as any[], purchases: [] as any[], subscriptions: [] as any[] };
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'google-access-token', expires_in: 3600 }), { status: 200 });
      }
      if (url.includes('/androidpublisher/v3/applications/com.opengrow.android/purchases/subscriptionsv2/tokens/purchase-token')) {
        return new Response(JSON.stringify({
          latestOrderId: 'GPA.1234-5678-9012-34567',
          startTime: '2026-05-01T00:00:00Z',
          lineItems: [{ productId: 'premium_monthly', expiryTime: '2026-06-01T00:00:00Z' }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: `unexpected ${url}` } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const env = baseEnv(projectDb(state), {
      ENVIRONMENT: 'production',
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: 'expected-token',
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: await googleServiceAccountJson(),
    });
    const response = await iapRoutes.request('/google/10?token=expected-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageName: 'com.opengrow.android',
        subscriptionNotification: { notificationType: 'SUBSCRIPTION_PURCHASED', purchaseToken: 'purchase-token', subscriptionId: 'premium_monthly' },
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(state.purchases).toMatchObject([{ product_id: 'premium_monthly', transaction_id: 'purchase-token', event_type: 'buy', purchase_type: 'subscription' }]);
    expect(state.subscriptions).toHaveLength(1);
  });
});

describe('push processing', () => {
  it('marks FCM notifications delivered when provider send succeeds', async () => {
    const state = { updates: [] as any[] };
    const row = {
      id: 1,
      type: 'Rpush::Fcm::Notification',
      device_token: 'device-token',
      notification: JSON.stringify({ title: 'Hello', body: 'World' }),
      data: JSON.stringify({ linksquared: 'true' }),
      firebase_project_id: 'firebase-project',
      access_token: 'cached-fcm-token',
      access_token_expiration: new Date(Date.now() + 3600_000).toISOString(),
      retries: 0,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'messages/1' }), { status: 200 })));

    const result = await processPushNotifications(baseEnv(pushDb([row], state)));

    expect(result).toMatchObject({ processed: 1, results: [{ id: 1, delivered: true }] });
    expect(state.updates).toEqual([{ type: 'processing', id: 1 }, { type: 'delivered', id: 1 }]);
  });

  it('marks push notifications failed after the final retry', async () => {
    const state = { updates: [] as any[] };
    const row = {
      id: 2,
      type: 'Rpush::Fcm::Notification',
      device_token: 'device-token',
      notification: '{}',
      data: '{}',
      firebase_project_id: 'firebase-project',
      access_token: 'cached-fcm-token',
      access_token_expiration: new Date(Date.now() + 3600_000).toISOString(),
      retries: 4,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 400 })));

    const result = await processPushNotifications(baseEnv(pushDb([row], state)));

    expect(result).toMatchObject({ processed: 1, results: [{ id: 2, delivered: false, retry: false, retries: 5 }] });
    expect(state.updates.at(-1)).toMatchObject({ type: 'failed', failed: 1, message: 'Invalid token', retries: 5, id: 2 });
  });
});
