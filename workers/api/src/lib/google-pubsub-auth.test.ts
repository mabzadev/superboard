import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import {
  authenticateGooglePubSub,
  googlePubSubAudience,
  persistGooglePubSubAuthentication,
} from './google-pubsub-auth';

afterEach(() => vi.unstubAllGlobals());

describe('Google Pub/Sub authenticated push', () => {
  it('verifies the Google signature, issuer, audience, email, and email verification claim', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'google-key-1';
    const audience = googlePubSubAudience('api.example.test', 10);
    const token = await new SignJWT({
      email: 'push@example.iam.gserviceaccount.com',
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('https://accounts.google.com')
      .setAudience(audience)
      .setSubject('service-account-subject')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const cache = new Map<string, string>();
    const env = environment(cache);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=1800' },
    })));

    await expect(authenticateGooglePubSub(env, new Request(`${audience}?token=legacy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }), {
      instanceId: 10,
      expectedEmail: 'push@example.iam.gserviceaccount.com',
      body: {},
    })).resolves.toEqual({
      mode: 'oidc',
      email: 'push@example.iam.gserviceaccount.com',
      audience,
      subject: 'service-account-subject',
    });
    expect(cache.size).toBe(1);
  });

  it('rejects an otherwise valid token with the wrong audience', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'google-key-2';
    const token = await new SignJWT({ email: 'push@example.iam.gserviceaccount.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('accounts.google.com')
      .setAudience('https://api.example.test/wrong')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })));

    await expect(authenticateGooglePubSub(environment(new Map()), new Request('https://api.example.test/api/v1/iap/google/10', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    }), {
      instanceId: 10,
      expectedEmail: 'push@example.iam.gserviceaccount.com',
      body: {},
    })).rejects.toMatchObject({ code: 'google_pubsub_oidc_invalid', status: 401 });
  });

  it('keeps the URL token as a migration-only compatibility path', async () => {
    const env = environment(new Map(), { GOOGLE_PUBSUB_VERIFICATION_TOKEN: 'migration-token' });
    await expect(authenticateGooglePubSub(env, new Request(
      'https://api.example.test/api/v1/iap/google/10?token=migration-token',
      { method: 'POST' },
    ), {
      instanceId: 10,
      expectedEmail: null,
      body: {},
    })).resolves.toMatchObject({ mode: 'legacy_token', email: null });
  });

  it('records release readiness only after OIDC authentication', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.includes('billing_store_notification_configurations')) return true;
      return undefined;
    });
    await persistGooglePubSubAuthentication(db, '101', {
      mode: 'legacy_token', email: null, audience: 'https://api.example.test/api/v1/iap/google/10', subject: null,
    });
    expect(db.calls).toHaveLength(0);
    await persistGooglePubSubAuthentication(db, '101', {
      mode: 'oidc', email: 'push@example.iam.gserviceaccount.com',
      audience: 'https://api.example.test/api/v1/iap/google/10', subject: 'subject',
    });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].args).toContain('101');
  });
});

function environment(cache: Map<string, string>, overrides: Partial<Env> = {}) {
  return {
    ENVIRONMENT: 'production',
    API_DOMAIN: 'api.example.test',
    KV: {
      get: async (key: string, type?: string) => {
        const value = cache.get(key) || null;
        return type === 'json' && value ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => { cache.set(key, value); },
    },
    ...overrides,
  } as unknown as Env;
}
