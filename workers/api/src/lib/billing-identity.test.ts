import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../types';
import { verifiedAppUserId } from './billing-identity';

async function identityFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  Object.assign(publicJwk, { kid: 'key-1', alg: 'RS256', use: 'sig' });
  const issuer = 'https://identity.example.test/tenant';
  const audience = 'opengrow';
  const jwksUri = 'https://identity.example.test/jwks.json';
  const cache = new Map<string, unknown>();
  const env = {
    DB: {
      prepare() {
        return { bind() { return { first: async () => ({ issuer, audience, jwks_uri: jwksUri }) }; } };
      },
    } as unknown as D1Database,
    KV: {
      get: async (key: string) => cache.get(key) || null,
      put: async (key: string, value: string) => { cache.set(key, JSON.parse(value)); },
    } as unknown as KVNamespace,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test', API_DOMAIN: 'api.test', SDK_DOMAIN: 'sdk.test', CORS_ORIGIN: '*', JWT_SECRET: 'test',
  } as Env;
  const token = async (overrides: { audience?: string; expiration?: string | number; subject?: string } = {}) => new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .setIssuer(issuer)
    .setAudience(overrides.audience || audience)
    .setSubject(overrides.subject || 'opaque-user-42')
    .setIssuedAt()
    .setExpirationTime(overrides.expiration || '5m')
    .sign(privateKey);
  return { env, token, publicJwk, jwksUri, cache };
}

describe('billing OIDC identity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a correctly signed subject with strict issuer and audience', async () => {
    const fixture = await identityFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), { status: 200 })));
    await expect(verifiedAppUserId(fixture.env, 1, `Bearer ${await fixture.token()}`)).resolves.toBe('opaque-user-42');
  });

  it('rejects a wrong audience and an expired JWT', async () => {
    const fixture = await identityFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [fixture.publicJwk] }), { status: 200 })));
    await expect(verifiedAppUserId(fixture.env, 1, `Bearer ${await fixture.token({ audience: 'another-api' })}`)).rejects.toThrow();
    await expect(verifiedAppUserId(fixture.env, 1, `Bearer ${await fixture.token({ expiration: Math.floor(Date.now() / 1000) - 60 })}`)).rejects.toThrow();
  });

  it('refreshes JWKS once when a provider rotates its signing key', async () => {
    const fixture = await identityFixture();
    const rotated = await generateKeyPair('RS256');
    const rotatedJwk = await exportJWK(rotated.publicKey);
    Object.assign(rotatedJwk, { kid: 'key-2', alg: 'RS256', use: 'sig' });
    fixture.cache.set(`billing:jwks:${await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fixture.jwksUri)).then((buffer) => Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join(''))}`, { keys: [fixture.publicJwk] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [rotatedJwk] }), { status: 200 })));
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'key-2' })
      .setIssuer('https://identity.example.test/tenant').setAudience('opengrow').setSubject('rotated-user').setIssuedAt().setExpirationTime('5m').sign(rotated.privateKey);
    await expect(verifiedAppUserId(fixture.env, 1, `Bearer ${token}`)).resolves.toBe('rotated-user');
  });
});
