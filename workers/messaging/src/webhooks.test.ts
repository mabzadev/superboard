import { describe, expect, it } from 'vitest';
import { isMessagingQueueJob } from './webhooks';

describe('Messaging webhook Queue jobs', () => {
  it('accepts bounded dispatch jobs', () => {
    expect(isMessagingQueueJob({
      type: 'messaging.webhook.dispatch', projectId: 11,
      eventId: 'message-1', eventName: 'message.created', payload: { conversation_id: 'conversation-1' },
    })).toBe(true);
  });

  it('rejects malformed or oversized identifiers', () => {
    expect(isMessagingQueueJob({ type: 'messaging.webhook.dispatch', projectId: 0, eventId: 'x', eventName: 'x', payload: {} })).toBe(false);
    expect(isMessagingQueueJob({ type: 'messaging.webhook.dispatch', projectId: 11, eventId: 'x'.repeat(256), eventName: 'x', payload: {} })).toBe(false);
    expect(isMessagingQueueJob({ type: 'other', projectId: 11, eventId: 'x', eventName: 'x', payload: {} })).toBe(false);
  });
});
