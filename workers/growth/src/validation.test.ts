import { describe, expect, it } from 'vitest';
import { automationAction, automationTrigger, device, locale, platform } from './validation';
import { AUTOMATION_ACTIONS } from './types';

describe('growth contracts', () => {
  it('prevents automation actions from representing financial mutations', () => {
    expect(AUTOMATION_ACTIONS).toEqual(['chat', 'push', 'in_app']);
    expect(() => automationAction('entitlement')).toThrow(/unsupported/i);
    expect(() => automationAction('refund')).toThrow(/unsupported/i);
  });

  it('accepts only supported marketing triggers', () => {
    expect(automationTrigger('payment_failed')).toBe('payment_failed');
    expect(automationTrigger('review_negative')).toBe('review_negative');
    expect(() => automationTrigger('grant_premium')).toThrow(/unsupported/i);
  });

  it('keeps platform and device pairs consistent', () => {
    expect(platform('apple')).toBe('apple');
    expect(device(undefined, 'apple')).toBe('iphone');
    expect(device(undefined, 'google')).toBe('android');
    expect(() => device('android', 'apple')).toThrow(/apple device/i);
    expect(locale('EN-us', 'language', 'en')).toBe('en-us');
  });
});
