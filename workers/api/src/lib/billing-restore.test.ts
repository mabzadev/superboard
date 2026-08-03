import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BillingEnv } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import { restoreVerifiedPurchases } from './billing-restore';

const providerMocks = vi.hoisted(() => ({
  apple: vi.fn(),
  google: vi.fn(),
  finalizeGoogle: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('./store-verification', () => ({
  verifyAppleTransaction: providerMocks.apple,
  verifyGooglePurchase: providerMocks.google,
  finalizeGooglePurchase: providerMocks.finalizeGoogle,
}));

vi.mock('./billing', async (loadOriginal) => ({
  ...await loadOriginal<typeof import('./billing')>(),
  applyVerifiedPurchase: providerMocks.apply,
}));

afterEach(() => {
  for (const mock of Object.values(providerMocks)) mock.mockReset();
});

describe('verified purchase restoration', () => {
  it('restores Apple and Google through provider verification and finalizes Google last', async () => {
    const order: string[] = [];
    providerMocks.apple.mockResolvedValue({ purchase: { store: 'apple' } });
    providerMocks.google.mockResolvedValue({ purchase: { store: 'google' }, finalize: 'context' });
    providerMocks.apply.mockImplementation(async (_env, purchase) => {
      order.push(`apply:${purchase.store}`);
      return { transactionId: `${purchase.store}-transaction`, duplicate: false };
    });
    providerMocks.finalizeGoogle.mockImplementation(async () => { order.push('finalize:google'); });
    const env = restoreEnvironment('transfer');

    await expect(restoreVerifiedPurchases(env, {
      projectId: '11',
      customerId: 'customer-1',
      environment: 'sandbox',
      appleTransactions: ['signed-apple-transaction'],
      googlePurchases: [{
        purchase_token: 'google-token', product_id: 'weekly-plan', product_type: 'subscription',
      }],
    })).resolves.toEqual([
      { store: 'apple', transaction_id: 'apple-transaction', duplicate: false },
      { store: 'google', transaction_id: 'google-transaction', duplicate: false },
    ]);
    expect(order).toEqual(['apply:apple', 'apply:google', 'finalize:google']);
    expect(providerMocks.apple).toHaveBeenCalledWith(env, expect.objectContaining({ allowTransfer: true }));
    expect(providerMocks.google).toHaveBeenCalledWith(env, expect.objectContaining({ allowTransfer: true }));
  });

  it('honors blocked transfer policy and rejects incomplete provider entries', async () => {
    const env = restoreEnvironment('block');
    providerMocks.apple.mockResolvedValue({ purchase: { store: 'apple' } });
    providerMocks.apply.mockResolvedValue({ transactionId: 'apple-transaction', duplicate: true });

    await restoreVerifiedPurchases(env, {
      projectId: '11', customerId: 'customer-1', environment: 'production',
      appleTransactions: ['signed-apple-transaction'], googlePurchases: [],
    });
    expect(providerMocks.apple).toHaveBeenCalledWith(env, expect.objectContaining({ allowTransfer: false }));

    await expect(restoreVerifiedPurchases(env, {
      projectId: '11', customerId: 'customer-1', environment: 'production',
      appleTransactions: [], googlePurchases: [{ product_id: 'weekly-plan' }],
    })).rejects.toMatchObject({ code: 'restore_google_purchase_invalid', retryable: false });
    expect(providerMocks.google).not.toHaveBeenCalled();
  });

  it('bounds restore batches before contacting a provider', async () => {
    const env = restoreEnvironment('transfer');
    await expect(restoreVerifiedPurchases(env, {
      projectId: '11', customerId: 'customer-1', environment: 'sandbox',
      appleTransactions: Array.from({ length: 101 }, () => 'signed'), googlePurchases: [],
    })).rejects.toMatchObject({ code: 'restore_payload_too_large', status: 413 });
    expect(providerMocks.apple).not.toHaveBeenCalled();
  });
});

function restoreEnvironment(restoreBehavior: string) {
  return {
    DB: createFakeD1((call) => call.op === 'first' && call.sql.includes('restore_behavior')
      ? { restore_behavior: restoreBehavior }
      : undefined),
  } as BillingEnv;
}
