import { describe, expect, it } from 'vitest';
import { providerEventReplayJob } from './provider-event-replay';

describe('Provider event replay jobs', () => {
  it('restores the immutable event ID without trusting the stored value', () => {
    expect(providerEventReplayJob({
      eventId: 'event-1', projectId: '11', store: 'stripe', environment: 'sandbox',
      jobPayload: JSON.stringify({
        type: 'billing.stripe.notification', eventId: 'untrusted', connectionId: 'connection-1',
      }),
    })).toEqual({ type: 'billing.stripe.notification', eventId: 'event-1', connectionId: 'connection-1' });
  });

  it('rejects provider and project mismatches', () => {
    expect(() => providerEventReplayJob({
      eventId: 'event-1', projectId: '11', store: 'google', environment: 'production',
      jobPayload: JSON.stringify({ type: 'billing.stripe.notification', connectionId: 'connection-1' }),
    })).toThrow('does not match');
    expect(() => providerEventReplayJob({
      eventId: 'event-1', projectId: '11', store: 'apple', environment: 'sandbox',
      jobPayload: JSON.stringify({
        type: 'billing.apple.notification', projectId: '12', environment: 'sandbox', signedPayload: 'signed',
      }),
    })).toThrow('Apple provider event replay data is invalid');
  });

  it('requires complete Google verification data', () => {
    expect(() => providerEventReplayJob({
      eventId: 'event-1', projectId: '11', store: 'google', environment: 'production',
      jobPayload: JSON.stringify({
        type: 'billing.google.notification', projectId: '11', purchaseToken: '',
        productId: 'yearly', productType: 'subscription', eventType: 'RENEWED',
        eventOccurredAt: '2026-08-04T00:00:00.000Z', environment: 'production',
      }),
    })).toThrow('Google provider event replay data is invalid');
  });

  it('preserves production routing for Google jobs stored before environment classification', () => {
    expect(providerEventReplayJob({
      eventId: 'event-1', projectId: '11', store: 'google', environment: 'production',
      jobPayload: JSON.stringify({
        type: 'billing.google.notification', projectId: '11', purchaseToken: 'purchase-token',
        productId: 'yearly', productType: 'subscription', eventType: 'RENEWED',
        eventOccurredAt: '2026-08-04T00:00:00.000Z',
      }),
    })).toMatchObject({ eventId: 'event-1', environment: 'production' });
  });
});
