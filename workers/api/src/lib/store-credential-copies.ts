import type { Env } from '../types';
import { callBillingServiceBinding } from './billing-service';
import { encryptCredential } from './secrets';

export type StoreCredentialCopies = {
  sourceCiphertext: string;
  billingCiphertext: string;
};

export async function encryptStoreCredentialCopies(
  env: Env,
  clearCredential: string,
): Promise<StoreCredentialCopies> {
  if (env.CREDENTIAL_KEY_SCOPE === 'billing') {
    const [sourceCiphertext, billingCiphertext] = await Promise.all([
      encryptCredential(env, clearCredential),
      encryptCredential(env, clearCredential),
    ]);
    return { sourceCiphertext, billingCiphertext };
  }

  const [sourceCiphertext, billingResult] = await Promise.all([
    encryptCredential(env, clearCredential),
    callBillingServiceBinding<{ data: { ciphertext: string } }>(env, '/internal/v1/credentials/encrypt', {
      credential: clearCredential,
    }),
  ]);
  const billingCiphertext = String(billingResult.data?.ciphertext || '');
  if (!billingCiphertext) {
    throw Object.assign(new Error('Billing credential encryption failed'), {
      code: 'billing_credential_copy_failed',
      status: 503,
      retryable: true,
    });
  }
  return { sourceCiphertext, billingCiphertext };
}
