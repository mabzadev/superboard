import { describe, expect, it } from 'vitest';
import { dispatchQueueJob } from './jobs';
import { Env } from '../types';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

function envWithDb(db: D1Database): Env {
  return {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'unit-test-secret',
  };
}

function jobsDb() {
  return createFakeD1((call: FakeD1Call) => {
    const { op, sql } = call;
    if (op === 'all' && sql.includes('FROM rpush_notifications rn JOIN rpush_apps ra')) return [];
    if (op === 'run' && sql.includes('DELETE FROM mcp_authorization_codes')) return { meta: { changes: 2 } };
    if (op === 'run' && sql.includes('UPDATE mcp_tokens')) return { meta: { changes: 3 } };
    if (op === 'run' && sql.includes('DELETE FROM mcp_clients')) return { meta: { changes: 4 } };
    if (op === 'run' && sql.includes('DELETE FROM actions')) return { meta: { changes: 5 } };
    if (op === 'all' && sql === 'SELECT id, uri_scheme, quota_exceeded, last_quota_warning_sent_at, last_quota_exceeded_sent_at FROM instances') return [];
    return undefined;
  });
}

describe('queue job dispatch', () => {
  it('rejects unsupported jobs so Cloudflare Queues can retry/dead-letter them', async () => {
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'unknown.job' })).rejects.toThrow('Unsupported queue job');
  });

  it('recognizes growth delivery jobs as isolated queue work', async () => {
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'growth.automation.deliver', projectId: '11', runId: 'run-1' }))
      .rejects.toMatchObject({ code: 'growth_unavailable', retryable: true });
  });

  it('dispatches push processing jobs', async () => {
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'push.process', limit: 10 }))
      .resolves.toEqual({ processed: 0, results: [] });
  });

  it('dispatches MCP cleanup jobs and returns deleted/revoked counts', async () => {
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'mcp.cleanup' }))
      .resolves.toEqual({ authorizationCodes: 2, tokens: 3, clients: 4 });
  });

  it('dispatches quota and orphan action maintenance jobs', async () => {
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'quota.update' }))
      .resolves.toMatchObject({ checked: 0, exceeded: 0, warnings: 0 });
    await expect(dispatchQueueJob(envWithDb(jobsDb()), { type: 'actions.cleanup' }))
      .resolves.toEqual({ deleted: 5 });
  });
});
