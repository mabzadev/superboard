import { describe, expect, it } from 'vitest';
import {
  googleBasePlanReadiness,
  parseAppleSubscriptionAvailability,
} from './store-catalog-readiness';

describe('Store catalog readiness', () => {
  it('counts only included Apple territories as current availability', () => {
    expect(parseAppleSubscriptionAvailability({
      data: [{
        type: 'subscriptionPlanAvailabilities',
        attributes: { availableInNewTerritories: true },
      }],
      included: [
        { type: 'territories', id: 'USA' },
        { type: 'subscriptionPlanAvailabilities', id: 'ignored' },
      ],
    })).toEqual({
      planCount: 1,
      availableTerritoryCount: 1,
      availableInNewTerritories: true,
    });
  });

  it('does not treat future Apple territory availability as currently purchasable', () => {
    expect(parseAppleSubscriptionAvailability({
      data: [{ attributes: { availableInNewTerritories: true } }],
    })).toMatchObject({
      availableTerritoryCount: 0,
      availableInNewTerritories: true,
    });
  });

  it('extracts Google cadence and regional new-subscriber availability', () => {
    expect(googleBasePlanReadiness({
      basePlanId: 'weekly',
      state: 'ACTIVE',
      autoRenewingBasePlanType: { billingPeriodDuration: 'P1W' },
      regionalConfigs: [
        { regionCode: 'US', newSubscriberAvailability: true },
        { regionCode: 'CH', newSubscriberAvailability: false },
      ],
    })).toEqual({
      basePlanId: 'weekly',
      state: 'ACTIVE',
      billingPeriod: 'P1W',
      availableRegionCount: 1,
      availableInOtherRegions: false,
      newSubscriberAvailable: true,
    });
  });

  it('fails closed when Google omits regional availability', () => {
    expect(googleBasePlanReadiness({
      basePlanId: 'annual',
      state: 'ACTIVE',
      prepaidBasePlanType: { billingPeriodDuration: 'P1Y' },
    })).toMatchObject({
      billingPeriod: 'P1Y',
      newSubscriberAvailable: false,
    });
  });
});
