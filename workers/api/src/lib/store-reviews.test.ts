import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import {
  analyzeStoreReview,
  parseReviewSyncCursor,
  publishApprovedReviewDraft,
  publishStoreReviewResponse,
  storeReviewProjectionVersion,
  storeReviewResponseLimit,
  syncAppleStoreReviews,
  syncGooglePlayReviews,
  syncStoreReviews,
  upsertReview,
} from './store-reviews';

const accessMocks = vi.hoisted(() => ({
  apple: vi.fn(),
  google: vi.fn(),
}));

vi.mock('./store-verification', () => ({
  appStoreConnectAccess: accessMocks.apple,
  googlePlayAccess: accessMocks.google,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  accessMocks.apple.mockReset();
  accessMocks.google.mockReset();
});

describe('store review reliability', () => {
  it('classifies sentiment from rating and assigns a deterministic category', () => {
    expect(analyzeStoreReview(1, 'The subscription charged me twice')).toEqual({
      sentiment: 'negative',
      category: 'billing',
    });
    expect(analyzeStoreReview(5, 'Please add a landscape feature')).toEqual({
      sentiment: 'positive',
      category: 'feature_request',
    });
  });

  it('enforces the provider response limit before loading credentials', async () => {
    expect(storeReviewResponseLimit('google')).toBe(350);
    expect(storeReviewResponseLimit('apple')).toBe(3500);
    await expect(publishStoreReviewResponse({} as Env, '11', {
      provider: 'google', provider_review_id: 'review-1',
    }, 'x'.repeat(351))).rejects.toMatchObject({
      code: 'store_review_response_invalid',
      retryable: false,
    });
  });

  it('queues a newly persisted negative revision exactly once', async () => {
    const jobs: unknown[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT INTO store_reviews')) return { meta: { changes: 1 } };
      if (call.op === 'first' && call.sql.includes('SELECT id, projection_version FROM store_reviews')) return { id: 'review-1' };
      if (call.op === 'run' && call.sql.includes('INSERT OR IGNORE INTO store_review_revisions')) return { meta: { changes: 1 } };
      return undefined;
    });
    const env = {
      DB: db,
      EVENT_QUEUE: { send: async (job: unknown) => { jobs.push(job); } },
      GROWTH: { fetch: async () => Response.json({}) },
      GROWTH_INTERNAL_TOKEN: 'growth-token',
    } as unknown as Env;
    await upsertReview(env, '11', {
      provider: 'apple', providerReviewId: 'provider-review-1', rating: 1,
      title: 'Needs work', body: 'The app closes unexpectedly.', rawPayload: { id: 'provider-review-1' },
    });
    expect(jobs).toEqual([expect.objectContaining({
      type: 'growth.review-negative.evaluate', projectId: '11',
    })]);
    expect(String((jobs[0] as Record<string, unknown>).revisionId)).toBeTruthy();
  });

  it('orders review snapshots by provider observation time', async () => {
    const older = await storeReviewProjectionVersion({
      provider: 'google', providerReviewId: 'review-1', rating: 1,
      body: 'Older text', providerUpdatedAt: '2026-08-03T10:00:00.000Z',
      observedAt: '2026-08-04T10:00:00.000Z', rawPayload: {},
    });
    const newer = await storeReviewProjectionVersion({
      provider: 'google', providerReviewId: 'review-1', rating: 5,
      body: 'Newer text', providerUpdatedAt: '2026-08-03T09:00:00.000Z',
      observedAt: '2026-08-04T10:00:01.000Z', rawPayload: {},
    });

    expect(newer > older).toBe(true);
  });

  it('captures a stale revision without sending a stale negative-review alert', async () => {
    const jobs: unknown[] = [];
    const currentProjection = await storeReviewProjectionVersion({
      provider: 'apple', providerReviewId: 'review-1', rating: 5,
      body: 'Current review', observedAt: '2026-08-04T10:00:02.000Z', rawPayload: {},
    });
    const db = createFakeD1((call) => {
      if (call.op === 'run' && call.sql.startsWith('INSERT INTO store_reviews')) return true;
      if (call.op === 'first' && call.sql.includes('SELECT id, projection_version FROM store_reviews')) {
        return { id: 'review-1', projection_version: currentProjection };
      }
      if (call.op === 'run' && call.sql.includes('INSERT OR IGNORE INTO store_review_revisions')) return true;
      return undefined;
    });
    await upsertReview({
      DB: db,
      EVENT_QUEUE: { send: async (job: unknown) => { jobs.push(job); } },
      GROWTH: { fetch: async () => Response.json({}) },
      GROWTH_INTERNAL_TOKEN: 'growth-token',
    } as unknown as Env, '11', {
      provider: 'apple', providerReviewId: 'review-1', rating: 1,
      body: 'Stale negative review', observedAt: '2026-08-04T10:00:01.000Z', rawPayload: {},
    });

    expect(jobs).toEqual([]);
    expect(db.calls.some((call) => call.sql.includes('INSERT OR IGNORE INTO store_review_revisions'))).toBe(true);
  });

  it('never publishes a response without an explicit publish request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM store_review_response_drafts')) {
        return draftRow({ status: 'approved', publish_requested_at: null });
      }
      return undefined;
    });

    await expect(publishApprovedReviewDraft({ DB: db } as Env, 'draft-1'))
      .rejects.toMatchObject({ code: 'store_review_publish_not_requested', retryable: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not publish when another worker holds the response lease', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM store_review_response_drafts')) {
        return draftRow({ status: 'publishing' });
      }
      if (call.op === 'run' && call.sql.includes('claim_expires_at')) {
        return { success: true, meta: { changes: 0 } };
      }
      return undefined;
    });

    await expect(publishApprovedReviewDraft({ DB: db } as Env, 'draft-1'))
      .resolves.toEqual({ published: false, claimed: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('publishes an approved response and stores the provider-confirmed state', async () => {
    accessMocks.google.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      result: {
        replyText: 'Provider-confirmed response.',
        lastEdited: { seconds: '1800000000', nanos: 0 },
      },
    })));
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM store_review_response_drafts')) return draftRow();
      if (call.op === 'run') {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      return undefined;
    });

    await expect(publishApprovedReviewDraft({ DB: db } as Env, 'draft-1')).resolves.toEqual({
      published: true,
      provider: 'google',
      response_state: 'published',
    });
    const reviewUpdate = writes.find(({ sql }) => sql.startsWith('UPDATE store_reviews'));
    expect(reviewUpdate?.args).toContain('Provider-confirmed response.');
    expect(reviewUpdate?.args).toContain(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('audits a provider result without overwriting state after the delivery lease is lost', async () => {
    accessMocks.google.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      result: { replyText: 'Approved response.' },
    })));
    const writes: string[] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'first' && call.sql.includes('FROM store_review_response_drafts')) return draftRow();
      if (call.op === 'run' && call.sql.includes("SET status = 'publishing'")) return true;
      if (call.op === 'run' && call.sql.includes("SET status = 'published'")) {
        return { success: true, meta: { changes: 0 } };
      }
      if (call.op === 'run') {
        writes.push(call.sql);
        return true;
      }
      return undefined;
    });

    await expect(publishApprovedReviewDraft({ DB: db } as Env, 'draft-1')).resolves.toEqual({
      published: false,
      claim_lost: true,
      provider: 'google',
    });
    expect(writes.some((sql) => sql.includes('response.result_after_lease_loss'))).toBe(true);
  });

  it('treats a malformed checkpoint as an empty safe checkpoint', () => {
    expect(parseReviewSyncCursor('{not-json')).toEqual({
      version: 1,
      watermark: null,
      full_synced_at: null,
    });
  });

  it('uses the Apple watermark to stop after the overlapping incremental page', async () => {
    accessMocks.apple.mockResolvedValue({ token: 'apple-token', appId: '123456' });
    const fetchSpy = vi.fn(async () => Response.json({
      data: [
        appleReview('new-review', '2026-08-03T20:00:00Z', 'Updated review'),
        appleReview('watermark-review', '2026-08-02T20:00:00Z', 'Edited at the boundary'),
      ],
      links: {
        next: 'https://api.appstoreconnect.apple.com/v1/apps/123456/customerReviews?cursor=next',
      },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const cursor = JSON.stringify({
      version: 1,
      watermark: '2026-08-02T20:00:00.000Z',
      full_synced_at: '2026-08-01T20:00:00.000Z',
    });

    const result = await syncAppleStoreReviews(
      reviewDatabaseEnv(),
      '11',
      cursor,
      new Date('2026-08-03T21:00:00.000Z'),
    );

    expect(result.imported).toBe(2);
    expect(result.full_sync).toBe(false);
    expect(parseReviewSyncCursor(result.cursor).watermark).toBe('2026-08-03T20:00:00.000Z');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('never forwards the Apple bearer token to an untrusted pagination URL', async () => {
    accessMocks.apple.mockResolvedValue({ token: 'apple-token', appId: '123456' });
    const fetchSpy = vi.fn(async () => Response.json({
      data: [appleReview('review-1', '2026-08-03T20:00:00Z', 'Helpful')],
      links: { next: 'https://example.invalid/collect-token' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(syncAppleStoreReviews(reviewDatabaseEnv(), '11'))
      .rejects.toMatchObject({ code: 'store_reviews_pagination_invalid', retryable: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows Google page tokens and records the newest provider update', async () => {
    accessMocks.google.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requested.push(url.toString());
      const token = url.searchParams.get('token');
      return Response.json(token
        ? { reviews: [googleReview('review-2', 1_800_000_100)] }
        : { reviews: [googleReview('review-1', 1_800_000_000)], tokenPagination: { nextPageToken: 'page-2' } });
    }));

    const result = await syncGooglePlayReviews(reviewDatabaseEnv(), '11');

    expect(result.imported).toBe(2);
    expect(requested).toHaveLength(2);
    expect(new URL(requested[1]).searchParams.get('token')).toBe('page-2');
    expect(parseReviewSyncCursor(result.cursor).watermark)
      .toBe(new Date(1_800_000_100 * 1000).toISOString());
  });

  it('persists provider checkpoints only after each provider sync succeeds', async () => {
    accessMocks.apple.mockResolvedValue({ token: 'apple-token', appId: '123456' });
    accessMocks.google.mockResolvedValue({ token: 'google-token', packageName: 'com.example.app' });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.hostname === 'api.appstoreconnect.apple.com'
        ? Response.json({ data: [appleReview('apple-review', '2026-08-03T20:00:00Z', 'Helpful')] })
        : Response.json({ reviews: [googleReview('google-review', 1_800_000_100)] });
    }));
    const persisted: unknown[][] = [];
    const db = createFakeD1((call) => {
      if (call.op === 'all' && call.sql.includes('FROM store_review_sync_state')) return [];
      if (call.op === 'run' && call.sql.startsWith('INSERT INTO store_reviews')) return { meta: { changes: 1 } };
      if (call.op === 'first' && call.sql.includes('SELECT id, projection_version FROM store_reviews')) {
        return { id: `review-${String(call.args[2])}` };
      }
      if (call.op === 'run' && call.sql.includes('INSERT OR IGNORE INTO store_review_revisions')) {
        return { meta: { changes: 1 } };
      }
      if (call.op === 'run' && call.sql.startsWith('INSERT INTO store_review_sync_state')) {
        persisted.push(call.args);
        return { meta: { changes: 1 } };
      }
      if (call.op === 'run' && call.sql.startsWith('UPDATE store_review_sync_state')) return true;
      return undefined;
    });

    const result = await syncStoreReviews({ DB: db } as Env, '11');

    expect(result).toEqual([
      expect.objectContaining({ ok: true, provider: 'apple', imported: 1 }),
      expect.objectContaining({ ok: true, provider: 'google', imported: 1 }),
    ]);
    expect(persisted).toHaveLength(2);
    expect(persisted.map((args) => args[1])).toEqual(['apple', 'google']);
    for (const args of persisted) {
      const cursor = parseReviewSyncCursor(String(args[2]));
      expect(cursor.watermark).toBeTruthy();
      expect(args[3]).toBe(cursor.watermark);
      expect(args[4]).toBe(cursor.full_synced_at);
      expect(args[5]).toBeNull();
      expect(args[6]).toBeNull();
    }
  });
});

function draftRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'draft-1',
    review_id: 'review-1',
    body: 'Thank you for your feedback.',
    status: 'approved',
    attempts: 0,
    publish_requested_at: '2026-08-03T18:00:00.000Z',
    project_id: '11',
    provider: 'google',
    provider_review_id: 'provider-review-1',
    ...overrides,
  };
}

function reviewDatabaseEnv() {
  const db = createFakeD1((call) => {
    if (call.op === 'run' && call.sql.startsWith('INSERT INTO store_reviews')) {
      return { success: true, meta: { changes: 1 } };
    }
    if (call.op === 'first' && call.sql.includes('SELECT id, projection_version FROM store_reviews')) {
      return { id: `review-${String(call.args[2])}` };
    }
    if (call.op === 'run' && call.sql.includes('INSERT OR IGNORE INTO store_review_revisions')) {
      return { success: true, meta: { changes: 1 } };
    }
    return undefined;
  });
  return { DB: db } as Env;
}

function appleReview(id: string, createdDate: string, body: string) {
  return {
    type: 'customerReviews',
    id,
    attributes: { rating: 4, title: 'Review', body, reviewerNickname: 'Reviewer', createdDate, territory: 'USA' },
  };
}

function googleReview(reviewId: string, seconds: number) {
  return {
    reviewId,
    authorName: 'Reviewer',
    comments: [{ userComment: {
      text: 'Review text',
      starRating: 4,
      reviewerLanguage: 'en',
      lastModified: { seconds: String(seconds), nanos: 0 },
    } }],
  };
}
