import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

type TestEnv = {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

describe('Growth migrations in the Workers runtime', () => {
  it('preserves existing automation runs and accepts the Inbox action', async () => {
    const testEnv = env as unknown as TestEnv;
    expect(testEnv.TEST_MIGRATIONS).toHaveLength(3);
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS.slice(0, 2));
    await seedExistingRun(testEnv.DB);

    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS.slice(2));

    await expect(testEnv.DB.prepare(`
      SELECT automation_id, event_id, attempt_count FROM growth_automation_runs WHERE id = 'run-before-inbox'
    `).first()).resolves.toMatchObject({
      automation_id: 'automation-before-inbox',
      event_id: 'event-before-inbox',
      attempt_count: 2,
    });

    const response = await SELF.fetch('https://growth.internal/internal/projects/11/automations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OpenGrow-Internal-Token': 'runtime-test-internal-token',
        'X-OpenGrow-Internal-Actor': 'runtime-test',
      },
      body: JSON.stringify({
        name: 'Negative review Inbox alert',
        trigger_type: 'review_negative',
        action_type: 'inbox',
        trigger_config: {},
        action_config: { title: 'Review needs attention', body: 'Prepare a response draft.' },
        enabled: true,
      }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: { action_type: 'inbox', trigger_type: 'review_negative', enabled: true },
    });

    const integrity = await testEnv.DB.prepare('PRAGMA foreign_key_check').all();
    expect(integrity.results).toEqual([]);
  });
});

async function seedExistingRun(db: D1Database) {
  await db.prepare(`
    INSERT INTO growth_automations (
      id, project_id, name, trigger_type, action_type, trigger_config_json,
      action_config_json, enabled
    ) VALUES ('automation-before-inbox', 11, 'Existing automation', 'payment_failed', 'push', '{}', '{}', 1)
  `).run();
  await db.prepare(`
    INSERT INTO growth_events (
      id, project_id, provider_event_id, event_type, subject_id, occurred_at, payload_json
    ) VALUES ('event-before-inbox', 11, 'provider-event-before-inbox', 'payment_failed', 'customer-1', datetime('now'), '{}')
  `).run();
  await db.prepare(`
    INSERT INTO growth_automation_runs (
      id, project_id, automation_id, event_id, status, action_payload_json,
      attempt_count
    ) VALUES ('run-before-inbox', 11, 'automation-before-inbox', 'event-before-inbox', 'pending', '{}', 2)
  `).run();
}
