import { exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { billingSigningAuthorityReady, billingStoreReadiness } from './billing-worker-readiness';

describe('Billing signing authority readiness', () => {
  it('proves that the active private key signs data verifiable by the public JWKS', async () => {
    const { privateKey } = await generateKeyPair('ES256', { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    const env = {
      PURCHASES_SIGNING_KEYSET: JSON.stringify({
        active_kid: 'billing-key-1',
        keys: [{ ...privateJwk, kid: 'billing-key-1', alg: 'ES256', use: 'sig' }],
      }),
    } as BillingEnv;

    await expect(billingSigningAuthorityReady(env)).resolves.toBe(true);
  });

  it('fails closed for an invalid or public-only active keyset', async () => {
    const env = {
      PURCHASES_SIGNING_KEYSET: JSON.stringify({
        active_kid: 'billing-key-1',
        keys: [{ kty: 'EC', crv: 'P-256', kid: 'billing-key-1', x: 'x', y: 'y' }],
      }),
    } as BillingEnv;

    await expect(billingSigningAuthorityReady(env)).resolves.toBe(false);
  });
});

describe('billing store readiness', () => {
  it('reports native platform credentials through one contract', async () => {
    const expected = [
      {
        provider: 'apple',
        environment: 'production',
        credential_source: 'platform_configuration',
        connections: 1,
        configured: 1,
        billing_credentials_ready: 1,
      },
    ];
    const db = createFakeD1((call) => {
      if (call.op !== 'all') return undefined;
      expect(call.sql).toContain('FROM ios_server_api_keys credential');
      expect(call.sql).toContain('FROM android_server_api_keys credential');
      expect(call.sql).not.toContain('connection.billing_configuration_encrypted IS NOT NULL');
      expect(call.sql).toContain('SUM(credentials_ready) AS billing_credentials_ready');
      return expected;
    });

    await expect(billingStoreReadiness(db)).resolves.toEqual(expected);
  });
});
