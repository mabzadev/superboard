import { describe, expect, it } from 'vitest';
import { configurationCatalog, validateEntity, validateProjectSettings } from './configuration';

describe('Messaging configuration validation', () => {
  it('exposes every supported OpenChat operations setting family', () => {
    expect(Object.keys(configurationCatalog)).toEqual(expect.arrayContaining([
      'inbox', 'agent', 'team', 'label', 'canned_response', 'macro',
      'custom_attribute', 'automation_rule', 'assignment_policy', 'sla_policy',
      'webhook', 'working_hours', 'notification_preference', 'saved_filter',
      'campaign', 'integration', 'agent_bot', 'capacity_policy', 'leave_schedule',
      'dashboard_app', 'email_template',
    ]));
  });

  it('normalizes a widget Inbox without accepting unknown fields', () => {
    expect(validateEntity({
      entity_type: 'inbox',
      name: 'Mobile support',
      configuration: {
        channel_type: 'mobile',
        identifier: 'mobile-support',
        greeting_enabled: true,
        pre_chat_fields: [{ key: 'email', required: false }],
      },
    })).toMatchObject({
      entity_type: 'inbox',
      enabled: true,
      configuration: { channel_type: 'mobile', identifier: 'mobile-support', greeting_enabled: true },
    });

    expect(() => validateEntity({
      entity_type: 'inbox', name: 'Invalid',
      configuration: { channel_type: 'mobile', identifier: 'mobile', undocumented_option: true },
    })).toThrow('Unknown configuration field');
  });

  it('stores only references to secrets and requires HTTPS callback URLs', () => {
    expect(() => validateEntity({
      entity_type: 'webhook', name: 'Unsafe',
      configuration: { url: 'https://example.test/hook', events: ['message.created'], secret: 'plain-text' },
    })).toThrow('Unknown configuration field');

    expect(() => validateEntity({
      entity_type: 'webhook', name: 'Insecure URL',
      configuration: { url: 'http://example.test/hook', events: ['message.created'], secret_reference: 'WEBHOOK_SECRET' },
    })).toThrow('must use public HTTPS');
  });

  it('validates project limits and feature flags', () => {
    expect(validateProjectSettings({
      locale: 'en-US', timezone: 'Europe/Zurich', attachment_max_bytes: 1024,
      allowed_content_types: ['image/png'], features: { csat: true, campaigns: false },
    })).toMatchObject({ locale: 'en-US', timezone: 'Europe/Zurich', attachment_max_bytes: 1024 });

    expect(() => validateProjectSettings({ features: { 'Invalid Flag': true } })).toThrow('Feature flags');
    expect(() => validateProjectSettings({ attachment_max_bytes: 20 * 1024 * 1024 })).toThrow('attachment_max_bytes');
  });

  it('allows only Messaging workflow actions and rejects entitlement mutation', () => {
    expect(validateEntity({
      entity_type: 'automation_rule', name: 'Urgent assignment',
      configuration: {
        event_name: 'conversation_created',
        conditions: [{ field: 'priority', operator: 'equals', value: 'urgent' }],
        actions: [{ type: 'assign_team', value: 'team-1' }, { type: 'add_label', value: 'urgent' }],
      },
    })).toMatchObject({ entity_type: 'automation_rule' });

    expect(() => validateEntity({
      entity_type: 'automation_rule', name: 'Forbidden',
      configuration: {
        event_name: 'conversation_updated', conditions: [],
        actions: [{ type: 'grant_entitlement', value: 'premium' }],
      },
    })).toThrow('action type is not supported');
  });
});
