import { describe, expect, it } from 'vitest';
import { nextReviewListCursor, parseReviewListCursor } from './store-reviews-admin';

describe('store review admin pagination', () => {
  it('round-trips a stable ordered cursor only when another page exists', () => {
    const rows = [{ id: 'review-2', ordered_at: '2026-08-04T08:30:00.000Z' }];
    const cursor = nextReviewListCursor(rows, true);

    expect(cursor).toBeTruthy();
    expect(parseReviewListCursor(cursor)).toEqual({
      orderedAt: '2026-08-04T08:30:00.000Z',
      id: 'review-2',
    });
    expect(nextReviewListCursor(rows, false)).toBeNull();
  });

  it('rejects malformed and incomplete cursors', () => {
    expect(() => parseReviewListCursor('not-base64!')).toThrowError('Review cursor is invalid');
    expect(() => parseReviewListCursor(btoa('missing-timestamp|review-1'))).toThrowError('Review cursor is invalid');
  });

  it('preserves the database timestamp representation for exact keyset comparisons', () => {
    const cursor = btoa('2026-08-04 08:30:00|review-3');
    expect(parseReviewListCursor(cursor)).toEqual({
      orderedAt: '2026-08-04 08:30:00',
      id: 'review-3',
    });
  });
});
