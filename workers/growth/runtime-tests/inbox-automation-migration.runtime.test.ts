import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { refreshRecommendations } from '../src/sync';
import type { Env as GrowthEnv } from '../src/types';

type TestEnv = {
  DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

describe('Growth migrations in the Workers runtime', () => {
  it('preserves existing automation runs and accepts the Inbox action', async () => {
    const testEnv = env as unknown as TestEnv;
    expect(testEnv.TEST_MIGRATIONS).toHaveLength(6);
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS.slice(0, 2));
    await seedExistingRun(testEnv.DB);

    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS.slice(2));

    await expect(testEnv.DB.prepare(`
      SELECT r.automation_id, r.event_id, r.attempt_count, r.claim_token, r.claim_expires_at,
        e.processed_at
      FROM growth_automation_runs r JOIN growth_events e ON e.id = r.event_id
      WHERE r.id = 'run-before-inbox'
    `).first()).resolves.toMatchObject({
      automation_id: 'automation-before-inbox',
      event_id: 'event-before-inbox',
      attempt_count: 2,
      claim_token: null,
      claim_expires_at: null,
      processed_at: expect.any(String),
    });
    await expect(testEnv.DB.prepare(`
      SELECT source, title, version FROM growth_app_snapshots WHERE id = 'snapshot-before-official-sources'
    `).first()).resolves.toEqual({ source: 'apple_lookup', title: 'Existing app', version: '1.0' });

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

  it('accepts official owned-app snapshots and rejects platform/source mismatches', async () => {
    const testEnv = env as unknown as TestEnv;
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.prepare(`
      INSERT INTO growth_apps (
        id, project_id, platform, app_identifier, display_name, country, language, device, is_primary, enabled
      ) VALUES ('owned-google', 91, 'google', 'com.example.android', NULL, 'us', 'en', 'android', 1, 1)
    `).run();

    const projects = await internalGet('/internal/official-metadata/projects');
    expect(projects.status).toBe(200);
    await expect(projects.json()).resolves.toMatchObject({ data: expect.arrayContaining([{ project_id: 91 }]) });

    const targets = await internalGet('/internal/official-metadata/targets?project_id=91');
    expect(targets.status).toBe(200);
    await expect(targets.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'owned-google', platform: 'google', official_synced_at: null })],
    });

    const accepted = await internalRequest('/internal/projects/91/official-metadata/snapshots', {
      entity_id: 'owned-google',
      app_identifier: 'com.example.android',
      source: 'google_play',
      title: 'Example',
      version: '2.1',
      metadata: { track: 'production' },
    });
    expect(accepted.status).toBe(201);
    await expect(testEnv.DB.prepare(`
      SELECT source, title, version FROM growth_app_snapshots WHERE entity_id = 'owned-google'
    `).first()).resolves.toMatchObject({ source: 'google_play', title: 'Example', version: '2.1' });

    const mismatch = await internalRequest('/internal/projects/91/official-metadata/snapshots', {
      entity_id: 'owned-google',
      app_identifier: 'com.example.android',
      source: 'app_store_connect',
      metadata: {},
    });
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({ code: 'official_metadata_source_mismatch', retryable: false });
  });

  it('rejects event identity collisions and requires exact lease ownership', async () => {
    const testEnv = env as unknown as TestEnv;
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await seedLeaseRun(testEnv.DB);

    await testEnv.DB.prepare(`
      UPDATE growth_automations SET action_config_json = '{"entitlement_id":"forbidden"}'
      WHERE id = 'automation-lease-test'
    `).run();
    const interruptedEvent = await internalRequest('/internal/projects/11/events', {
      event_id: 'provider-event-stable', event_type: 'payment_failed', subject_id: 'customer-1',
      payload: { store: 'apple', retry_count: 1 },
    });
    expect(interruptedEvent.status).toBe(422);
    await expect(testEnv.DB.prepare(`
      SELECT processed_at FROM growth_events WHERE provider_event_id = 'provider-event-stable'
    `).first()).resolves.toMatchObject({ processed_at: null });

    await testEnv.DB.prepare(`
      UPDATE growth_automations SET action_config_json = '{"title":"Payment update","body":"Please update your payment method."}'
      WHERE id = 'automation-lease-test'
    `).run();

    const duplicateEvent = await internalRequest('/internal/projects/11/events', {
      event_id: 'provider-event-stable', event_type: 'payment_failed', subject_id: 'customer-1',
      payload: { retry_count: 1, store: 'apple' },
    });
    expect(duplicateEvent.status).toBe(202);
    await expect(duplicateEvent.json()).resolves.toMatchObject({
      data: { duplicate: true, actions: expect.arrayContaining([expect.objectContaining({ status: 'pending' })]) },
    });
    await expect(testEnv.DB.prepare(`
      SELECT processed_at FROM growth_events WHERE provider_event_id = 'provider-event-stable'
    `).first()).resolves.toMatchObject({ processed_at: expect.any(String) });

    const conflictingEvent = await internalRequest('/internal/projects/11/events', {
      event_id: 'provider-event-stable', event_type: 'refund_granted', subject_id: 'customer-1',
      payload: { store: 'apple', retry_count: 1 },
    });
    expect(conflictingEvent.status).toBe(409);
    await expect(conflictingEvent.json()).resolves.toMatchObject({
      code: 'growth_event_identity_conflict', retryable: false,
    });

    const firstClaim = await internalRequest('/internal/projects/11/automation-runs/run-lease-test/claim', {});
    expect(firstClaim.status).toBe(200);
    const firstClaimPayload = await firstClaim.json() as { data: { claim_token: string } };
    expect(firstClaimPayload.data.claim_token).toMatch(/^[0-9a-f-]{36}$/);

    const staleRelease = await internalRequest('/internal/projects/11/automation-runs/run-lease-test/release', {
      claim_token: '00000000-0000-4000-8000-000000000000', last_error: 'Temporary delivery error', retry_after_seconds: 30,
    });
    expect(staleRelease.status).toBe(409);
    await expect(staleRelease.json()).resolves.toMatchObject({ code: 'automation_run_claim_lost' });

    const released = await internalRequest('/internal/projects/11/automation-runs/run-lease-test/release', {
      claim_token: firstClaimPayload.data.claim_token, last_error: 'Temporary delivery error', retry_after_seconds: 30,
    });
    expect(released.status).toBe(200);
    await testEnv.DB.prepare(`
      UPDATE growth_automation_runs SET next_attempt_at = datetime('now', '-1 second')
      WHERE id = 'run-lease-test'
    `).run();

    const secondClaim = await internalRequest('/internal/projects/11/automation-runs/run-lease-test/claim', {});
    expect(secondClaim.status).toBe(200);
    const secondClaimPayload = await secondClaim.json() as { data: { claim_token: string } };
    expect(secondClaimPayload.data.claim_token).not.toBe(firstClaimPayload.data.claim_token);

    const staleCompletion = await internalRequest('/internal/projects/11/automation-runs/run-lease-test', {
      status: 'delivered', claim_token: firstClaimPayload.data.claim_token,
    }, 'PATCH');
    expect(staleCompletion.status).toBe(409);

    const completed = await internalRequest('/internal/projects/11/automation-runs/run-lease-test', {
      status: 'delivered', claim_token: secondClaimPayload.data.claim_token,
    }, 'PATCH');
    expect(completed.status).toBe(200);
    await expect(testEnv.DB.prepare(`
      SELECT status, claim_token, claim_expires_at FROM growth_automation_runs WHERE id = 'run-lease-test'
    `).first()).resolves.toMatchObject({ status: 'delivered', claim_token: null, claim_expires_at: null });
  });

  it('reconciles keyword, rating, and competitor recommendations from current snapshots', async () => {
    const testEnv = env as unknown as TestEnv;
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await seedRecommendationFixtures(testEnv.DB);

    await refreshRecommendations(testEnv as unknown as GrowthEnv, 90);
    const active = await testEnv.DB.prepare(`
      SELECT recommendation_key, kind, status FROM growth_recommendations
      WHERE project_id = 90 ORDER BY recommendation_key
    `).all();
    expect(active.results).toEqual([
      { recommendation_key: 'app:owned-app:rating', kind: 'rating_risk', status: 'open' },
      { recommendation_key: 'competitor:competitor-app:apple_lookup:change', kind: 'competitor_change', status: 'open' },
      { recommendation_key: 'keyword:keyword-1:rank', kind: 'keyword_opportunity', status: 'open' },
    ]);

    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT INTO growth_app_snapshots (
          id, project_id, entity_type, entity_id, source, observed_date, title, version, rating, rating_count
        ) VALUES ('owned-day-3', 90, 'app', 'owned-app', 'apple_lookup', '2026-08-03', 'Owned app', '1.0', 4.8, 120)
      `),
      testEnv.DB.prepare(`
        INSERT INTO growth_app_snapshots (
          id, project_id, entity_type, entity_id, source, observed_date, title, version, rating, rating_count
        ) VALUES ('competitor-day-3', 90, 'competitor', 'competitor-app', 'apple_lookup', '2026-08-03', 'Competitor', '2.0', 4.3, 220)
      `),
      testEnv.DB.prepare(`
        INSERT INTO growth_keyword_snapshots (
          id, project_id, keyword_id, source, observed_date, rank, volume
        ) VALUES ('keyword-day-3', 90, 'keyword-1', 'manual', '2026-08-03', 5, 80)
      `),
    ]);
    await refreshRecommendations(testEnv as unknown as GrowthEnv, 90);
    const resolved = await testEnv.DB.prepare(`
      SELECT recommendation_key, status, auto_resolved_at FROM growth_recommendations
      WHERE project_id = 90 ORDER BY recommendation_key
    `).all<Record<string, unknown>>();
    expect(resolved.results.every((row) => row.status === 'completed' && typeof row.auto_resolved_at === 'string')).toBe(true);

    await testEnv.DB.prepare(`
      INSERT INTO growth_keyword_snapshots (
        id, project_id, keyword_id, source, observed_date, rank, volume
      ) VALUES ('keyword-day-4', 90, 'keyword-1', 'manual', '2026-08-04', 45, 90)
    `).run();
    await refreshRecommendations(testEnv as unknown as GrowthEnv, 90);
    await expect(testEnv.DB.prepare(`
      SELECT status, auto_resolved_at FROM growth_recommendations
      WHERE project_id = 90 AND recommendation_key = 'keyword:keyword-1:rank'
    `).first()).resolves.toEqual({ status: 'open', auto_resolved_at: null });
  });
});

function internalRequest(path: string, body: Record<string, unknown>, method = 'POST') {
  return SELF.fetch(`https://growth.internal${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-OpenGrow-Internal-Token': 'runtime-test-internal-token',
      'X-OpenGrow-Internal-Actor': 'runtime-test',
    },
    body: JSON.stringify(body),
  });
}

function internalGet(path: string) {
  return SELF.fetch(`https://growth.internal${path}`, {
    headers: { 'X-OpenGrow-Internal-Token': 'runtime-test-internal-token' },
  });
}

async function seedExistingRun(db: D1Database) {
  await db.prepare(`
    INSERT INTO growth_apps (
      id, project_id, platform, app_identifier, display_name, country, language, device
    ) VALUES ('app-before-official-sources', 12, 'apple', '123456789', 'Existing app', 'us', 'en', 'iphone')
  `).run();
  await db.prepare(`
    INSERT INTO growth_app_snapshots (
      id, project_id, entity_type, entity_id, source, observed_date, title, version
    ) VALUES (
      'snapshot-before-official-sources', 12, 'app', 'app-before-official-sources',
      'apple_lookup', '2026-08-01', 'Existing app', '1.0'
    )
  `).run();
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

async function seedLeaseRun(db: D1Database) {
  await db.prepare(`
    INSERT INTO growth_automations (
      id, project_id, name, trigger_type, action_type, trigger_config_json,
      action_config_json, enabled
    ) VALUES ('automation-lease-test', 11, 'Lease test automation', 'payment_failed', 'push', '{}', '{}', 1)
  `).run();
  await db.prepare(`
    INSERT INTO growth_events (
      id, project_id, provider_event_id, event_type, subject_id, occurred_at, payload_json
    ) VALUES ('event-lease-test', 11, 'provider-event-lease-test', 'payment_failed', 'customer-1', datetime('now'), '{}')
  `).run();
  await db.prepare(`
    INSERT INTO growth_automation_runs (
      id, project_id, automation_id, event_id, status, action_payload_json
    ) VALUES ('run-lease-test', 11, 'automation-lease-test', 'event-lease-test', 'pending', '{}')
  `).run();
}

async function seedRecommendationFixtures(db: D1Database) {
  await db.batch([
    db.prepare(`
      INSERT INTO growth_apps (
        id, project_id, platform, app_identifier, display_name, country, language, device
      ) VALUES ('owned-app', 90, 'apple', '123456789', 'Owned app', 'us', 'en', 'iphone')
    `),
    db.prepare(`
      INSERT INTO growth_competitors (
        id, project_id, platform, app_identifier, display_name, country, language, device
      ) VALUES ('competitor-app', 90, 'apple', '987654321', 'Competitor', 'us', 'en', 'iphone')
    `),
    db.prepare(`
      INSERT INTO growth_keywords (
        id, project_id, app_id, keyword, country, language
      ) VALUES ('keyword-1', 90, 'owned-app', 'voice training', 'us', 'en')
    `),
    db.prepare(`
      INSERT INTO growth_app_snapshots (
        id, project_id, entity_type, entity_id, source, observed_date, title, version, rating, rating_count
      ) VALUES ('owned-day-2', 90, 'app', 'owned-app', 'apple_lookup', '2026-08-02', 'Owned app', '1.0', 3.5, 100)
    `),
    db.prepare(`
      INSERT INTO growth_app_snapshots (
        id, project_id, entity_type, entity_id, source, observed_date, title, version, rating, rating_count
      ) VALUES ('competitor-day-1', 90, 'competitor', 'competitor-app', 'apple_lookup', '2026-08-01', 'Competitor', '1.0', 4.0, 180)
    `),
    db.prepare(`
      INSERT INTO growth_app_snapshots (
        id, project_id, entity_type, entity_id, source, observed_date, title, version, rating, rating_count
      ) VALUES ('competitor-day-2', 90, 'competitor', 'competitor-app', 'apple_lookup', '2026-08-02', 'Competitor', '2.0', 4.3, 210)
    `),
    db.prepare(`
      INSERT INTO growth_keyword_snapshots (
        id, project_id, keyword_id, source, observed_date, rank, volume
      ) VALUES ('keyword-day-2', 90, 'keyword-1', 'manual', '2026-08-02', 35, 75)
    `),
  ]);
}
