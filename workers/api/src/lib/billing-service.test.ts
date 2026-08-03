import { describe, expect, it, vi } from 'vitest';
import {
  callBillingService,
  callBillingServiceBinding,
  customerInfoFromBillingAuthority,
  identifyCustomerFromBillingAuthority,
  purchasesJwksFromBillingAuthority,
  resolveCustomerFromBillingAuthority,
} from './billing-service';

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

  it('uses Billing as the sole CustomerInfo signing authority in service mode', async () => {
    const customerInfo = {
      customer_id: 'customer-1',
      original_app_user_id: 'user-1',
      entitlements: {},
      subscriptions: [],
      signature: 'signed-by-billing',
      signature_algorithm: 'ES256',
      signature_key_id: 'billing-key-1',
    };
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: customerInfo }));
    const env = { BILLING_EXECUTION_MODE: 'service', BILLING: { fetch } } as any;

    await expect(customerInfoFromBillingAuthority(env, '11', 'customer-1')).resolves.toEqual(customerInfo);
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0][0] as Request;
    expect(request.url).toBe('https://billing.internal/internal/v1/customer-info');
    await expect(request.json()).resolves.toEqual({ project_id: '11', customer_id: 'customer-1' });
  });

  it('loads only public ES256 verification keys from Billing in service mode', async () => {
    const jwks = {
      keys: [{
        kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: 'billing-key-1',
        x: 'public-x', y: 'public-y', key_ops: ['verify'],
      }],
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(jwks));
    const env = { BILLING_EXECUTION_MODE: 'service', BILLING: { fetch } } as any;

    await expect(purchasesJwksFromBillingAuthority(env)).resolves.toEqual(jwks);
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch.mock.calls[0][0] as Request).url).toBe('https://billing.internal/internal/v1/jwks');
  });

  it('fails closed when Billing returns unsigned customer data or private key material', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { customer_id: 'customer-1' } }))
      .mockResolvedValueOnce(Response.json({
        keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: 'key-1', x: 'x', y: 'y', d: 'private' }],
      }));
    const env = { BILLING_EXECUTION_MODE: 'service', BILLING: { fetch } } as any;

    await expect(customerInfoFromBillingAuthority(env, '11', 'customer-1'))
      .rejects.toMatchObject({ code: 'billing_authority_invalid_response', retryable: true });
    await expect(purchasesJwksFromBillingAuthority(env))
      .rejects.toMatchObject({ code: 'billing_authority_invalid_response', retryable: true });
  });

  it('resolves and identifies SDK customers only through Billing in service mode', async () => {
    const customerInfo = {
      customer_id: 'customer-1', original_app_user_id: 'user-1', entitlements: {}, subscriptions: [],
      signature: 'signed-by-billing', signature_algorithm: 'ES256', signature_key_id: 'billing-key-1',
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: {
        customer: { id: 'customer-1', project_id: '11' }, appUserId: 'user-1', identified: true,
      } }))
      .mockResolvedValueOnce(Response.json({ data: customerInfo }));
    const env = { BILLING_EXECUTION_MODE: 'service', BILLING: { fetch } } as any;

    await expect(resolveCustomerFromBillingAuthority(env, {
      projectId: '11', authorization: 'Bearer identity-token', anonymousId: '$opengrow_anon_device',
    })).resolves.toMatchObject({ customer: { id: 'customer-1' }, appUserId: 'user-1', identified: true });
    await expect(identifyCustomerFromBillingAuthority(env, {
      projectId: '11', authorization: 'Bearer identity-token', currentAppUserId: '$opengrow_anon_device',
    })).resolves.toEqual(customerInfo);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[0][0] as Request).url.endsWith('/internal/v1/customers/resolve')).toBe(true);
    await expect((fetch.mock.calls[0][0] as Request).json()).resolves.toMatchObject({
      project_id: '11', authorization: 'Bearer identity-token', anonymous_id: '$opengrow_anon_device',
    });
    expect((fetch.mock.calls[1][0] as Request).url.endsWith('/internal/v1/customers/identify')).toBe(true);
  });
});
