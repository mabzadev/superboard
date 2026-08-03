import { describe, expect, it, vi } from 'vitest';
import { callBillingService, callBillingServiceBinding } from './billing-service';

describe('Billing service binding', () => {
  it('allows credential preparation through the private binding before traffic cutover', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ciphertext: 'billing-v1.value' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const env = { BILLING_EXECUTION_MODE: 'local', BILLING: { fetch } } as any;
    await expect(callBillingServiceBinding(env, '/internal/v1/credentials/encrypt', { credential: 'secret' }))
      .resolves.toEqual({ data: { ciphertext: 'billing-v1.value' } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not route financial traffic through Billing before service mode is enabled', async () => {
    const env = { BILLING_EXECUTION_MODE: 'local', BILLING: { fetch: vi.fn() } } as any;
    await expect(callBillingService(env, '/internal/v1/receipts/verify', {}))
      .rejects.toMatchObject({ code: 'billing_service_unavailable', retryable: true });
    expect(env.BILLING.fetch).not.toHaveBeenCalled();
  });
});
