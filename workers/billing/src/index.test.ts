import { describe, expect, it } from 'vitest';
import worker from './index';
import { decryptCredential } from '../../api/src/lib/secrets';

describe('Billing private credential preparation', () => {
  it('encrypts a Store credential with the Billing-only keyring', async () => {
    const env = {
      CREDENTIAL_KEY_SCOPE: 'billing',
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'billing-v1',
      STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ 'billing-v1': 'billing-test-key-material' }),
    } as any;
    const response = await worker.fetch(new Request('https://billing.internal/internal/v1/credentials/encrypt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: JSON.stringify({ secret_key: 'sk_test_example' }) }),
    }), env, {} as any);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { ciphertext: string } };
    expect(payload.data.ciphertext).toMatch(/^billing-v1\./);
    await expect(decryptCredential(env, payload.data.ciphertext))
      .resolves.toBe(JSON.stringify({ secret_key: 'sk_test_example' }));
  });
});
