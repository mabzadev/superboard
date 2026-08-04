import { describe, expect, it } from 'vitest';
import { assertAutomationCompatibility, automationAction, automationConfig, automationTrigger, device, locale, platform } from './validation';
import { AUTOMATION_ACTIONS } from './types';

describe('growth contracts', () => {
  it('prevents automation actions from representing financial mutations', () => {
    expect(AUTOMATION_ACTIONS).toEqual(['chat', 'push', 'in_app', 'inbox']);
    expect(() => automationAction('entitlement')).toThrow(/unsupported/i);
    expect(() => automationAction('refund')).toThrow(/unsupported/i);
  });

  it('keeps store reviewers isolated from app-user delivery channels', () => {
    expect(() => assertAutomationCompatibility('review_negative', 'inbox')).not.toThrow();
    expect(() => assertAutomationCompatibility('review_negative', 'push')).toThrow(/not supported/i);
    expect(() => assertAutomationCompatibility('payment_failed', 'inbox')).toThrow(/not supported/i);
  });

  it('accepts only supported marketing triggers', () => {
    expect(automationTrigger('payment_failed')).toBe('payment_failed');
    expect(automationTrigger('review_negative')).toBe('review_negative');
    expect(() => automationTrigger('grant_premium')).toThrow(/unsupported/i);
  });

  it('blocks entitlement mutation fields without rejecting neutral English message copy', () => {
    expect(automationConfig({ title: 'Plan update', body: 'Your premium plan was renewed.' }, 'action_config'))
      .toEqual({ title: 'Plan update', body: 'Your premium plan was renewed.' });
    expect(() => automationConfig({ nested: { entitlement_id: 'premium' } }, 'action_config'))
      .toThrow(/entitlement mutation/i);
    expect(() => automationConfig({ subscriptionStatus: 'active' }, 'action_config'))
      .toThrow(/entitlement mutation/i);
  });

  it('keeps platform and device pairs consistent', () => {
    expect(platform('apple')).toBe('apple');
    expect(device(undefined, 'apple')).toBe('iphone');
    expect(device(undefined, 'google')).toBe('android');
    expect(() => device('android', 'apple')).toThrow(/apple device/i);
    expect(locale('EN-us', 'language', 'en')).toBe('en-us');
  });
});
