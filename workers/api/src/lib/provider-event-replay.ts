import { isBillingQueueJob, type BillingQueueJob } from './billing-dispatch';

function replayError(message: string) {
  return Object.assign(new Error(message), {
    code: 'provider_event_replay_unavailable', status: 409, retryable: false,
  });
}

function required(value: unknown, maxLength = 1_048_576) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function providerEventReplayJob(params: {
  eventId: string;
  projectId: string;
  store: string;
  environment: string;
  jobPayload: unknown;
}): BillingQueueJob {
  let stored: unknown = params.jobPayload;
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored); }
    catch { throw replayError('Provider event replay data is unavailable'); }
  }
  if (!isBillingQueueJob(stored)) throw replayError('Provider event replay data is invalid');
  const expectedType = `billing.${params.store}.notification`;
  if (stored.type !== expectedType) throw replayError('Provider event replay data does not match its provider');
  if (stored.type === 'billing.apple.notification') {
    if (stored.projectId !== params.projectId || stored.environment !== params.environment
      || !required(stored.signedPayload)) {
      throw replayError('Apple provider event replay data is invalid');
    }
  } else if (stored.type === 'billing.google.notification') {
    const environment = stored.environment === undefined ? params.environment : stored.environment;
    if (stored.projectId !== params.projectId || !required(stored.purchaseToken, 4096)
      || !required(stored.productId, 512) || !required(stored.eventType, 255)
      || !required(stored.eventOccurredAt, 100)
      || environment !== params.environment
      || !['subscription', 'non_consumable', 'consumable'].includes(stored.productType)) {
      throw replayError('Google provider event replay data is invalid');
    }
    Object.assign(stored, { environment });
  } else if (stored.type === 'billing.stripe.notification') {
    if (!required(stored.connectionId, 255)) throw replayError('Stripe provider event replay data is invalid');
  } else {
    throw replayError('Provider event replay type is unsupported');
  }
  return { ...stored, eventId: params.eventId } as BillingQueueJob;
}
