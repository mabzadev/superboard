import { describe, expect, it } from 'vitest';
import { validateStripeCredentials } from './stripe-credentials';

describe('Stripe credentials', () => {
  it('normalizes test credentials for the sandbox environment', () => {
    expect(validateStripeCredentials({
      secret_key: '  sk_test_example  ',
      webhook_secret: '  whsec_example  ',
      ignored: 'not persisted',
    }, 'sandbox')).toEqual({
      secret_key: 'sk_test_example',
      webhook_secret: 'whsec_example',
    });
  });

  it('normalizes live credentials for the production environment', () => {
    expect(validateStripeCredentials({
      secret_key: 'sk_live_example',
      webhook_secret: 'whsec_example',
    }, 'production')).toEqual({
      secret_key: 'sk_live_example',
      webhook_secret: 'whsec_example',
    });
  });

  it('rejects a live key in the sandbox environment', () => {
    expect(() => validateStripeCredentials({
      secret_key: 'sk_live_example',
      webhook_secret: 'whsec_example',
    }, 'sandbox')).toThrow('test Stripe secret key is required');
  });

  it('rejects a test key in the production environment', () => {
    expect(() => validateStripeCredentials({
      secret_key: 'sk_test_example',
      webhook_secret: 'whsec_example',
    }, 'production')).toThrow('live Stripe secret key is required');
  });

  it('requires the webhook signing secret', () => {
    expect(() => validateStripeCredentials({ secret_key: 'sk_test_example' }, 'sandbox'))
      .toThrow('webhook signing secret is invalid');
  });
});
