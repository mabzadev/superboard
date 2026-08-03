import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types';
import { createFakeD1 } from '../test/fake-d1';
import {
  analyzeStoreReview,
  publishApprovedReviewDraft,
  publishStoreReviewResponse,
  storeReviewResponseLimit,
  upsertReview,
} from './store-reviews';

afterEach(() => vi.unstubAllGlobals());

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
      if (call.op === 'first' && call.sql.includes('SELECT id FROM store_reviews')) return { id: 'review-1' };
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
