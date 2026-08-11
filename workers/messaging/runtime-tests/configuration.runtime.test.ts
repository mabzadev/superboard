import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const headers = {
  'X-OpenGrow-Internal-Token': 'runtime-test-internal-token',
  'X-OpenGrow-Agent-Id': 'operator-1',
  'Content-Type': 'application/json',
};

describe('Messaging configuration in the Workers runtime', () => {
  it('persists project settings, typed entities, and immutable audit events', async () => {
    const update = await SELF.fetch('https://messaging.internal/internal/projects/11/settings', {
      method: 'PATCH', headers,
      body: JSON.stringify({
        business_name: 'Support', locale: 'en', timezone: 'Europe/Zurich',
        date_format: 'DD/MM/YYYY', auto_resolve_minutes: 1440,
        attachment_max_bytes: 5 * 1024 * 1024,
        allowed_content_types: ['image/png', 'application/pdf'],
        features: { csat: true, campaigns: true },
      }),
    });
    expect(update.status).toBe(200);

    const create = await SELF.fetch('https://messaging.internal/internal/projects/11/settings/entities', {
      method: 'POST', headers,
      body: JSON.stringify({
        entity_type: 'inbox', name: 'Mobile support', enabled: true,
        configuration: {
          channel_type: 'mobile', identifier: 'mobile-support', greeting_enabled: true,
          welcome_title: 'How can we help?', pre_chat_form_enabled: true,
          pre_chat_fields: [{ key: 'email', label: 'Email', required: false }],
          email_collection: 'optional', conversation_continuity: true, csat_enabled: true,
        },
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string } };

    const settings = await SELF.fetch('https://messaging.internal/internal/projects/11/settings', { headers });
    expect(settings.status).toBe(200);
    await expect(settings.json()).resolves.toMatchObject({
      data: {
        settings: { locale: 'en', timezone: 'Europe/Zurich', auto_resolve_minutes: 1440 },
        entities: [{ id: created.data.id, entity_type: 'inbox', name: 'Mobile support' }],
        catalog: { inbox: { label: 'Inbox' }, automation_rule: { label: 'Automation rule' } },
      },
    });

    const auditRows = await (env as unknown as { DB: D1Database }).DB.prepare(`
      SELECT action, entity_type FROM messaging_configuration_audit_events
      WHERE project_id = 11 ORDER BY created_at
    `).all<{ action: string; entity_type: string }>();
    expect(auditRows.results).toEqual([
      { action: 'updated', entity_type: 'project_settings' },
      { action: 'created', entity_type: 'inbox' },
    ]);

    await expect((env as unknown as { DB: D1Database }).DB.prepare(`
      DELETE FROM messaging_configuration_audit_events WHERE project_id = 11
    `).run()).rejects.toThrow('immutable');
  });
});
