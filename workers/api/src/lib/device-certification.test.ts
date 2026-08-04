import { describe, expect, it } from 'vitest';
import { createFakeD1 } from '../test/fake-d1';
import {
  issueCertificationDeviceChallenge,
  recordDeviceCertificationResult,
  requiredDeviceCertificationAssertions,
} from './device-certification';

const now = new Date('2026-08-04T12:00:00.000Z');

describe('authenticated device certification evidence', () => {
  it('issues only a hashed, expiring challenge in storage', async () => {
    const db = createFakeD1((call) => call.op === 'run' ? true : undefined);
    const result = await issueCertificationDeviceChallenge(db, 'run-device-1', now);

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(result.expires_at).toBe('2026-08-04T16:00:00.000Z');
    expect(db.calls[0].args[0]).toBe('run-device-1');
    expect(db.calls[0].args[1]).toMatch(/^[a-f0-9]{64}$/u);
    expect(db.calls[0].args[1]).not.toBe(result.token);
  });

  it('stores a verified identity result with structured assertions and a digest', async () => {
    const challenge = 'challenge-device-result-1';
    const challengeHash = await sha256(challenge);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_certification_device_results')) return null;
      if (call.op === 'first' && call.sql.includes('FROM billing_certification_runs')) return {
        id: 'run-device-1', release_project_id: '10', target_project_id: '11',
        environment: 'sandbox', platform: 'cross_platform', build_number: '104',
        app_version: '1.4.0', sdk_version: '2.1.3', device_model: 'iPhone 16',
        os_version: '19.0', status: 'running', started_at: '2026-08-04T11:55:00.000Z',
        challenge_hash: challengeHash, challenge_expires_at: '2026-08-04T16:00:00.000Z',
        claimed_customer_id: null,
      };
      if (call.op === 'run') return true;
      return undefined;
    });

    const result = await recordDeviceCertificationResult(db, {
      id: 'device-result-104',
      runId: 'run-device-1',
      challenge,
      checkKey: 'cross_platform.identity_sync',
      outcome: 'passed',
      customerId: 'customer-1',
      projectId: '11',
      sourcePlatform: 'ios',
      applicationIdentifier: 'com.example.app',
      buildNumber: '104',
      appVersion: '1.4.0',
      sdkVersion: '2.1.3',
      deviceModel: 'iPhone 16',
      osVersion: '19.0',
      assertions: {
        authenticated_identity_verified: true,
        purchase_blocked_without_identity: true,
      },
      observedAt: '2026-08-04T11:59:00.000Z',
    }, now);

    expect(result).toMatchObject({
      id: 'device-result-104', check_key: 'cross_platform.identity_sync',
      outcome: 'passed', duplicate: false,
    });
    expect(result.evidence_sha256).toMatch(/^[a-f0-9]{64}$/u);
    const insert = db.calls.find((call) => call.op === 'run' && call.sql.includes('INSERT INTO billing_certification_device_results'))!;
    const evidence = JSON.parse(String(insert.args[13]));
    expect(evidence).toMatchObject({
      source: 'authenticated_sdk', identity_verified: true,
      assertions: { authenticated_identity_verified: true, purchase_blocked_without_identity: true },
    });
  });

  it('fails closed when a passed result omits a required assertion', async () => {
    const db = createFakeD1(() => undefined);
    await expect(recordDeviceCertificationResult(db, {
      id: 'device-result-104', runId: 'run-device-1', challenge: 'challenge',
      checkKey: 'cross_platform.signed_customer_info', outcome: 'passed',
      customerId: 'customer-1', projectId: '11', sourcePlatform: 'ios',
      applicationIdentifier: 'com.example.app', buildNumber: '104',
      assertions: { valid_signature_accepted: true, tampered_signature_rejected: true },
    }, now)).rejects.toMatchObject({ code: 'device_certification_assertions_incomplete' });
    expect(db.calls).toHaveLength(0);
  });

  it('rejects evidence from the wrong provider platform', async () => {
    const challenge = 'challenge-device-result-2';
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM billing_certification_device_results')) return null;
      if (call.op === 'first' && call.sql.includes('FROM billing_certification_runs')) return {
        id: 'run-device-2', release_project_id: '10', target_project_id: '11',
        environment: 'sandbox', platform: 'ios', build_number: '104', app_version: null,
        sdk_version: null, device_model: null, os_version: null, status: 'running',
        started_at: '2026-08-04T11:55:00.000Z', challenge_hash: 'ignored',
        challenge_expires_at: '2026-08-04T16:00:00.000Z', claimed_customer_id: null,
      };
      return undefined;
    });
    await expect(recordDeviceCertificationResult(db, {
      id: 'device-result-105', runId: 'run-device-2', challenge,
      checkKey: 'apple.restore', outcome: 'failed', customerId: 'customer-1',
      projectId: '11', sourcePlatform: 'android', applicationIdentifier: 'com.example.app',
      buildNumber: '104', assertions: { restore_completed: false },
    }, now)).rejects.toMatchObject({ code: 'device_certification_platform_mismatch' });
  });

  it('defines an assertion schema for every check that accepts SDK evidence', () => {
    expect(requiredDeviceCertificationAssertions('apple.network_loss')).toContain('outbox_retained');
    expect(requiredDeviceCertificationAssertions('stripe.portal')).toEqual([
      'portal_session_created', 'return_url_verified',
    ]);
    expect(() => requiredDeviceCertificationAssertions('apple.weekly_purchase'))
      .toThrowError(/No device evidence schema/u);
  });
});

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
