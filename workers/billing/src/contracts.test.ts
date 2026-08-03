import { describe, expect, it } from 'vitest';
import { billingSecretReadiness, parseReceiptRequest } from './contracts';

describe('Billing service contracts', () => {
  it('accepts a complete Apple receipt request', () => {
    expect(parseReceiptRequest({
      project_id: '11', customer_id: 'customer', store: 'apple',
      environment: 'production', signed_transaction: 'signed',
    }).store).toBe('apple');
  });

  it('requires Google token, product and product type', () => {
    expect(() => parseReceiptRequest({
      project_id: '11', customer_id: 'customer', store: 'google', environment: 'production',
    })).toThrow(/purchase_token/);
  });

  it('rejects unsupported providers and environments', () => {
    expect(() => parseReceiptRequest({ project_id: '11', customer_id: 'c', store: 'stripe', environment: 'production' })).toThrow(/apple or google/);
    expect(() => parseReceiptRequest({ project_id: '11', customer_id: 'c', store: 'apple', environment: 'live', signed_transaction: 'x' })).toThrow(/sandbox or production/);
  });

  it('keeps traffic disabled until every financial key is present', () => {
    const bindings = {};
    expect(billingSecretReadiness(bindings)).toEqual({
      ready: false,
      missing: [
        'STORE_CREDENTIALS_ENCRYPTION_KEYS',
        'PURCHASES_SIGNING_KEYSET',
        'APPLE_ROOT_CERTIFICATES_B64',
        'OPENGROW_ENTITLEMENT_WEBHOOK_SECRET',
      ],
    });
  });
});
