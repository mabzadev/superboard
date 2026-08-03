import { describe, expect, it } from 'vitest';
import { matchesAutomation } from './automations';

describe('growth automation conditions', () => {
  it('matches safe equality and numeric boundaries', () => {
    const config = {
      equals: { platform: 'apple', country: 'us' },
      minimum: { days_inactive: 7 },
      maximum: { rating: 2 },
    };
    expect(matchesAutomation(config, { platform: 'apple', country: 'us', days_inactive: 9, rating: 1 })).toBe(true);
    expect(matchesAutomation(config, { platform: 'apple', country: 'us', days_inactive: 2, rating: 1 })).toBe(false);
  });

  it('rejects nested or unsafe condition keys', () => {
    expect(matchesAutomation({ equals: { 'profile.role': 'admin' } }, { 'profile.role': 'admin' })).toBe(false);
    expect(matchesAutomation({ minimum: { amount: 10 } }, { amount: 'not-a-number' })).toBe(false);
  });
});
