import { describe, expect, it, vi } from 'vitest';
import { decryptCredential } from './secrets';
import { encryptStoreCredentialCopies } from './store-credential-copies';

const keyring = JSON.stringify({ v1: 'test-key-material' });

describe('Store credential copies', () => {
  it('creates two independently encrypted copies inside the Billing domain', async () => {
    const env = {
      CREDENTIAL_KEY_SCOPE: 'billing',
      STORE_CREDENTIALS_ENCRYPTION_KEYS: keyring,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
    } as any;
    const copies = await encryptStoreCredentialCopies(env, '{"secret":"value"}');
    expect(copies.sourceCiphertext).not.toBe(copies.billingCiphertext);
    await expect(decryptCredential(env, copies.sourceCiphertext)).resolves.toBe('{"secret":"value"}');
    await expect(decryptCredential(env, copies.billingCiphertext)).resolves.toBe('{"secret":"value"}');
  });

  it('requests the Billing copy through the private binding from the API domain', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ciphertext: 'v1.billing-copy' } })));
    const env = {
      CREDENTIAL_KEY_SCOPE: 'api',
      STORE_CREDENTIALS_ENCRYPTION_KEYS: keyring,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
      BILLING: { fetch },
    } as any;
    const copies = await encryptStoreCredentialCopies(env, '{"secret":"value"}');
    expect(copies.billingCiphertext).toBe('v1.billing-copy');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBeInstanceOf(Request);
  });

  it('fails closed when Billing does not return its credential copy', async () => {
    const env = {
      CREDENTIAL_KEY_SCOPE: 'api',
      STORE_CREDENTIALS_ENCRYPTION_KEYS: keyring,
      STORE_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
      BILLING: { fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))) },
    } as any;
    await expect(encryptStoreCredentialCopies(env, '{"secret":"value"}'))
      .rejects.toMatchObject({ code: 'billing_credential_copy_failed', status: 503, retryable: true });
  });
});
