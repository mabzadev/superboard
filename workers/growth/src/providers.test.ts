import { describe, expect, it } from 'vitest';
import { findMetric, findNumber, findText, scopeByKey } from './providers';

describe('growth provider normalization', () => {
  it('extracts AppTweak keyword and app metrics without depending on object order', () => {
    const payload = {
      result: {
        '123456789': {
          meditation: {
            rank: { value: 12, fetch_performed: true },
            chance: { value: 67 },
          },
        },
      },
    };
    expect(findMetric(payload, ['123456789', 'meditation'], 'rank')).toBe(12);
    expect(findMetric(payload, ['123456789', 'meditation'], 'chance')).toBe(67);
    expect(findMetric(payload, ['other', 'meditation'], 'rank')).toBeNull();
  });

  it('uses effective values only when the provider value is absent', () => {
    expect(findMetric({ keyword: { rank: { value: null, effective_value: 501 } } }, ['keyword'], 'rank')).toBe(501);
    expect(findMetric({ keyword: { rank: { value: 4, effective_value: 501 } } }, ['keyword'], 'rank')).toBe(4);
  });

  it('normalizes public store metadata fields', () => {
    const payload = { results: [{ trackName: 'Focus App', averageUserRating: 4.7, userRatingCount: 1234 }] };
    expect(findText(payload, ['trackName', 'title'])).toBe('Focus App');
    expect(findNumber(payload, ['averageUserRating', 'rating'])).toBe(4.7);
    expect(findNumber(payload, ['userRatingCount'])).toBe(1234);
  });

  it('scopes batched metadata to the requested app', () => {
    const payload = { result: { first: { title: 'First' }, second: { title: 'Second' } } };
    expect(findText(scopeByKey(payload, 'second'), ['title'])).toBe('Second');
  });
});
