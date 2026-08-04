import { describe, expect, it } from 'vitest';
import { assertSyncComplete } from './sync';

describe('Growth synchronization retry contract', () => {
  it('allows completed and permanent provider outcomes to finish', () => {
    expect(() => assertSyncComplete([])).not.toThrow();
    expect(() => assertSyncComplete([
      { operation: 'metadata', error: 'Invalid app identifier', retryable: false },
    ])).not.toThrow();
  });

  it('propagates transient provider failures to the queue retry policy', () => {
    expect(() => assertSyncComplete([
      { operation: 'keywords', error: 'Provider unavailable', retryable: true },
    ])).toThrowError(expect.objectContaining({
      code: 'growth_sync_incomplete',
      status: 503,
      retryable: true,
      retryDelaySeconds: 300,
    }));
  });
});
