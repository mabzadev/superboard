import { describe, expect, it } from 'vitest';
import { scopedStoreCredential } from './secrets';

describe('scoped Store credentials', () => {
  const connection = {
    configuration_encrypted: 'api-v1.ciphertext',
    billing_configuration_encrypted: 'billing-v1.ciphertext',
  };

  it('selects only the API copy in the public API execution domain', () => {
    expect(scopedStoreCredential(connection, { CREDENTIAL_KEY_SCOPE: 'api' } as any)).toBe('api-v1.ciphertext');
    expect(scopedStoreCredential(connection, {} as any)).toBe('api-v1.ciphertext');
  });

  it('fails closed when the Billing copy is absent', () => {
    expect(scopedStoreCredential(connection, { CREDENTIAL_KEY_SCOPE: 'billing' } as any)).toBe('billing-v1.ciphertext');
    expect(scopedStoreCredential({ configuration_encrypted: 'api-only' }, { CREDENTIAL_KEY_SCOPE: 'billing' } as any)).toBeNull();
  });
});
