import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleMessagingQueue } from '../src/webhooks';
import type { Env } from '../src/types';

describe('legacy Messaging dead-letter compatibility', () => {
  it('durably quarantines a terminal message before acknowledging it', async () => {
    const testEnv = env as unknown as Env;
    const batch = createMessageBatch(testEnv.DLQ_NAME, [{
      id: 'messaging-dead-letter-1', timestamp: new Date(), attempts: 9,
      body: {
        type: 'messaging.webhook.dispatch', projectId: 12, eventId: 'messaging-event-1',
        eventName: 'conversation.created', payload: { conversation_id: 'conversation-1' },
      },
    }]);
    const execution = createExecutionContext();
    await handleMessagingQueue(batch, testEnv);
    const result = await getQueueResult(batch, execution);
    expect(result.explicitAcks).toEqual(['messaging-dead-letter-1']);
    await expect(testEnv.DB.prepare(`
      SELECT source_queue, message_id, job_type, replayable, status FROM messaging_dead_letters
      WHERE message_id = 'messaging-dead-letter-1'
    `).first()).resolves.toMatchObject({
      source_queue: testEnv.DLQ_NAME, message_id: 'messaging-dead-letter-1',
      job_type: 'messaging.webhook.dispatch', replayable: 1, status: 'quarantined',
    });
  });
});
