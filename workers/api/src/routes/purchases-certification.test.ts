import { describe, expect, it } from 'vitest';
import { createFakeD1 } from '../test/fake-d1';
import {
  certificationReferenceSnapshot,
  type CertificationRunRow,
} from './purchases-v2-admin';

const run: CertificationRunRow = {
  id: 'run-1',
  release_project_id: '10',
  target_project_id: '11',
  environment: 'sandbox',
  platform: 'ios',
  build_number: '104',
  app_version: '1.4.0',
  sdk_version: '2.1.0',
  device_model: 'iPhone',
  os_version: '19.0',
  status: 'running',
  started_at: '2026-08-03T10:00:00.000Z',
};

describe('purchase certification references', () => {
  it('accepts only a verified provider transaction from the run project and time window', async () => {
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_transactions')) return {
        id: 'transaction-1', store: 'apple', environment: 'sandbox', status: 'active',
        event_type: 'initial_purchase', verified_at: '2026-08-03T10:01:10.000Z',
        event_occurred_at: '2026-08-03T10:01:00.000Z', store_product_id: 'weekly-plan',
        metadata: '{"subscription_period":"ONE_WEEK"}', package_types: 'weekly', period_type: 'normal',
      };
      return undefined;
    });
    await expect(certificationReferenceSnapshot(db, run, 'apple', 'billing_transaction', 'transaction-1', 'apple.weekly_purchase'))
      .resolves.toMatchObject({ id: 'transaction-1', provider: 'apple', environment: 'sandbox', status: 'active' });
    expect(db.calls[0].args).toEqual(['transaction-1', '11']);
  });

  it('rejects a valid provider record that does not prove the selected scenario', async () => {
    const wrongCadence = createFakeD1((call) => call.op === 'first' ? {
      id: 'transaction-1', store: 'apple', environment: 'sandbox', status: 'active',
      event_type: 'initial_purchase', verified_at: '2026-08-03T10:01:10.000Z',
      event_occurred_at: '2026-08-03T10:01:00.000Z', metadata: '{"subscription_period":"ONE_YEAR"}',
      package_types: 'annual', period_type: 'normal',
    } : undefined);
    await expect(certificationReferenceSnapshot(
      wrongCadence, run, 'apple', 'billing_transaction', 'transaction-1', 'apple.weekly_purchase',
    )).rejects.toMatchObject({ code: 'certification_reference_scenario_mismatch' });

    const wrongEvent = createFakeD1((call) => call.op === 'first' ? {
      id: 'event-1', provider: 'stripe', environment: 'sandbox', status: 'processed',
      event_type: 'invoice.payment_succeeded', occurred_at: '2026-08-03T10:01:00.000Z',
    } : undefined);
    await expect(certificationReferenceSnapshot(
      wrongEvent,
      { ...run, platform: 'web' },
      'stripe',
      'billing_event',
      'event-1',
      'stripe.payment_failed',
    )).rejects.toMatchObject({ code: 'certification_reference_scenario_mismatch' });
  });

  it('rejects provider mismatch and records outside the certification window', async () => {
    const providerMismatch = createFakeD1((call) => call.op === 'first' ? {
      id: 'transaction-1', store: 'google', environment: 'sandbox', status: 'active',
      event_type: 'purchase', verified_at: '2026-08-03T10:01:10.000Z',
      event_occurred_at: '2026-08-03T10:01:00.000Z',
    } : undefined);
    await expect(certificationReferenceSnapshot(providerMismatch, run, 'apple', 'billing_transaction', 'transaction-1'))
      .rejects.toMatchObject({ code: 'certification_reference_provider_mismatch' });

    const tooOld = createFakeD1((call) => call.op === 'first' ? {
      id: 'event-1', provider: 'apple', environment: 'sandbox', status: 'processed',
      event_type: 'DID_RENEW', occurred_at: '2026-08-03T09:00:00.000Z', received_at: '2026-08-03T09:00:01.000Z',
    } : undefined);
    await expect(certificationReferenceSnapshot(tooOld, run, 'apple', 'billing_event', 'event-1'))
      .rejects.toMatchObject({ code: 'certification_reference_outside_run' });
  });

  it('requires a completed legacy inventory with no unresolved subscription', async () => {
    const db = createFakeD1((call) => call.op === 'first' ? {
      id: 'inventory-1', status: 'completed', active_subscriptions: 2,
      matched_subscriptions: 1, unresolved_subscriptions: 1, unsupported_subscriptions: 0,
      completed_at: '2026-08-03T10:05:00.000Z',
    } : undefined);
    await expect(certificationReferenceSnapshot(
      db,
      { ...run, target_project_id: '10', environment: 'production', platform: 'cross_platform' },
      'cross_platform',
      'legacy_inventory',
      'inventory-1',
    )).rejects.toMatchObject({ code: 'certification_legacy_inventory_incomplete' });
  });

  it('keeps external test evidence inside the immutable certification snapshot contract', async () => {
    const db = createFakeD1(() => undefined);
    await expect(certificationReferenceSnapshot(db, run, 'cross_platform', 'test_run', 'device-lab-104'))
      .resolves.toEqual({ external_test_reference: 'device-lab-104' });
    expect(db.calls).toHaveLength(0);
  });

  it('interprets D1 UTC timestamps consistently when validating the run window', async () => {
    const db = createFakeD1((call) => call.op === 'first' ? {
      id: 'event-1', provider: 'apple', environment: 'sandbox', status: 'processed',
      event_type: 'DID_RENEW', occurred_at: '2026-08-03 10:01:00', received_at: '2026-08-03 10:01:01',
    } : undefined);
    await expect(certificationReferenceSnapshot(
      db,
      { ...run, started_at: '2026-08-03 10:00:00' },
      'apple',
      'billing_event',
      'event-1',
      'apple.renewal',
    )).resolves.toMatchObject({ id: 'event-1', event_type: 'DID_RENEW' });
  });
});
