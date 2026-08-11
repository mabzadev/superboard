import { describe, expect, it } from 'vitest';
import { consumeRealtimeTicket, issueRealtimeTicket } from './realtime';
import type { Env } from './types';

describe('Support realtime secret overlap', () => {
  it('accepts a ticket signed by the previous internal token', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          run: async () => ({ success: true }),
          first: async () => ({
            project_id: 12,
            conversation_id: 'conversation-1',
            actor_id: 'actor-1',
            expires_at: '2026-08-09T10:01:00.000Z',
          }),
        }),
      }),
    } as unknown as D1Database;
    const issued = await issueRealtimeTicket(
      {
        DB: db,
        INTERNAL_API_TOKEN: 'previous-internal-token',
      } as Pick<Env, 'DB' | 'INTERNAL_API_TOKEN' | 'INTERNAL_API_TOKEN_PREVIOUS'>,
      12,
      'conversation-1',
      'actor-1',
      1_786_268_400,
    );
    await expect(consumeRealtimeTicket(
      {
        DB: db,
        INTERNAL_API_TOKEN: 'new-internal-token',
        INTERNAL_API_TOKEN_PREVIOUS: 'previous-internal-token',
      } as Pick<Env, 'DB' | 'INTERNAL_API_TOKEN' | 'INTERNAL_API_TOKEN_PREVIOUS'>,
      issued.ticket,
      1_786_268_410,
    )).resolves.toMatchObject({
      project_id: 12,
      conversation_id: 'conversation-1',
      actor_id: 'actor-1',
    });
  });
});
