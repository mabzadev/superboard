import { exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import type { BillingEnv } from '../types';
import { billingSigningAuthorityReady } from './billing-worker-readiness';

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
