import { describe, expect, it } from 'vitest';
import { createFakeD1 } from '../test/fake-d1';
import { configuredGoogleProductType } from './store-verification';

describe('Google Play server product contract', () => {
  it('resolves product type from the project and environment catalog', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_products')) {
        expect(call.args).toEqual(['project-1', 'sandbox', 'weekly-plan']);
        return { product_type: 'subscription' };
      }
      return undefined;
    });

    await expect(configuredGoogleProductType(db, {
      projectId: 'project-1', environment: 'sandbox', storeProductId: 'weekly-plan',
    })).resolves.toBe('subscription');
  });

  it('rejects a product that is absent from the trusted server catalog', async () => {
    const db = createFakeD1((call) => call.op === 'first' && call.sql.includes('FROM billing_products')
      ? null
      : undefined);

    await expect(configuredGoogleProductType(db, {
      projectId: 'project-1', environment: 'production', storeProductId: 'unknown-plan',
    })).rejects.toMatchObject({
      code: 'google_product_not_configured', status: 409, retryable: false,
    });
  });
});
