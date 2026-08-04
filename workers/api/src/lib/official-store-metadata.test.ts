import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./store-verification', () => ({
  appStoreConnectAccess: vi.fn(async () => ({
    token: 'apple-token', appId: '123456789', bundleId: 'com.example.ios', name: 'Example', primaryLocale: 'en-US',
  })),
  googlePlayAccess: vi.fn(async () => ({ token: 'google-token', packageName: 'com.example.android' })),
}));

import {
  enqueueOfficialMetadataProjects,
  queueOfficialMetadataSyncIfDue,
  selectAppleVersion,
  selectGoogleListing,
  selectGoogleRelease,
  syncOfficialMetadataProject,
} from './official-store-metadata';
import type { Env } from '../types';

afterEach(() => vi.unstubAllGlobals());

describe('official Store metadata', () => {
  it('selects a released Apple version and the requested Google locale', () => {
    const apple = selectAppleVersion([
      { id: 'draft', attributes: { platform: 'IOS', versionString: '3.0', appStoreState: 'PREPARE_FOR_SUBMISSION', createdDate: '2026-08-03' } },
      { id: 'live', attributes: { platform: 'IOS', versionString: '2.0', appStoreState: 'READY_FOR_SALE', createdDate: '2026-07-01' } },
    ], 'iphone');
    expect(apple?.id).toBe('live');
    expect(selectGoogleListing([
      { language: 'fr-FR', title: 'French' },
      { language: 'en-US', title: 'English' },
    ], 'en', 'us').title).toBe('English');
  });

  it('prefers the highest production release', () => {
    const selected = selectGoogleRelease([
      { track: 'beta', releases: [{ name: '9.0-beta', versionCodes: ['900'], status: 'completed' }] },
      { track: 'production', releases: [
        { name: '2.0', versionCodes: ['200'], status: 'completed' },
        { name: '2.1', versionCodes: ['210'], status: 'completed' },
      ] },
    ]);
    expect(selected.track.track).toBe('production');
    expect(selected.release.name).toBe('2.1');
  });

  it('uses a disposable Google edit and persists only normalized metadata', async () => {
    const providerCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      providerCalls.push(`${init?.method || 'GET'} ${url}`);
      if (init?.method === 'POST' && url.endsWith('/edits')) return Response.json({ id: 'temporary-edit' });
      if (url.endsWith('/listings')) return Response.json({ listings: [{ language: 'en-US', title: 'Example', shortDescription: 'Short' }] });
      if (url.endsWith('/tracks')) return Response.json({ tracks: [{ track: 'production', releases: [{ name: '2.1', versionCodes: ['210'], status: 'completed' }] }] });
      if (init?.method === 'DELETE' && url.endsWith('/temporary-edit')) return Response.json({});
      return Response.json({}, { status: 404 });
    }));
    const persisted: Record<string, unknown>[] = [];
    const growth = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === '/internal/official-metadata/targets') {
        return Response.json({ data: [{
          id: 'app-google', project_id: 11, platform: 'google', app_identifier: 'com.example.android',
          country: 'us', language: 'en', device: 'android', official_synced_at: null,
        }] });
      }
      if (url.pathname.endsWith('/official-metadata/snapshots')) {
        persisted.push(JSON.parse(await request.text()));
        return Response.json({ data: { id: 'snapshot' } }, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    });

    await expect(syncOfficialMetadataProject(baseEnv({ GROWTH: { fetch: growth } as Fetcher }), 11))
      .resolves.toMatchObject({ targets: 1, snapshots: 1, failures: [] });
    expect(persisted).toEqual([expect.objectContaining({
      entity_id: 'app-google', source: 'google_play', title: 'Example', version: '2.1',
      metadata: expect.objectContaining({ package_name: 'com.example.android', track: 'production' }),
    })]);
    expect(providerCalls.some((call) => call.startsWith('DELETE ') && call.endsWith('/temporary-edit'))).toBe(true);
    expect(providerCalls.some((call) => call.includes(':commit'))).toBe(false);
  });

  it('queues the daily synchronization once per UTC date', async () => {
    const values = new Map<string, string>();
    const sent: unknown[] = [];
    const testEnv = baseEnv({
      KV: {
        get: async (key: string) => values.get(key) || null,
        put: async (key: string, value: string) => { values.set(key, value); },
      } as unknown as KVNamespace,
      EVENT_QUEUE: { send: async (message: unknown) => { sent.push(message); } } as unknown as Queue,
    });
    await expect(queueOfficialMetadataSyncIfDue(testEnv, new Date('2026-08-04T00:05:00Z')))
      .resolves.toEqual({ queued: true });
    await expect(queueOfficialMetadataSyncIfDue(testEnv, new Date('2026-08-04T23:55:00Z')))
      .resolves.toEqual({ queued: false, reason: 'already_queued' });
    expect(sent).toEqual([{ type: 'growth.official-metadata.sync-all' }]);
  });

  it('fans out project synchronization with queue batches', async () => {
    const batches: unknown[][] = [];
    const testEnv = baseEnv({
      GROWTH: { fetch: async () => Response.json({ data: [{ project_id: 11 }, { project_id: 12 }] }) } as unknown as Fetcher,
      EVENT_QUEUE: { sendBatch: async (messages: unknown[]) => { batches.push(messages); } } as unknown as Queue,
    });
    await expect(enqueueOfficialMetadataProjects(testEnv)).resolves.toEqual({ enqueued: 2 });
    expect(batches).toEqual([[
      { body: { type: 'growth.official-metadata.sync-project', projectId: '11' } },
      { body: { type: 'growth.official-metadata.sync-project', projectId: '12' } },
    ]]);
  });
});

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    KV: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'test-secret',
    AUTH_GATEWAY_ISSUER: 'https://auth.test',
    AUTH_GATEWAY_AUDIENCE: 'opengrow',
    AUTH_GATEWAY_JWKS_URL: 'https://auth.test/.well-known/jwks.json',
    GROWTH_INTERNAL_TOKEN: 'internal-token',
    GROWTH: { fetch: async () => Response.json({ data: [] }) } as unknown as Fetcher,
    ...overrides,
  };
}
