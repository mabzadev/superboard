import { describe, expect, it } from 'vitest';
import { upsertProjectConversation } from './index';

function database(existing: Record<string, unknown> | null = null) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
          return {
            first: async () => sql.includes('INSERT INTO conversations') ? null : existing,
          };
        },
      };
    },
  } as unknown as D1Database & { calls: Array<{ sql: string; args: unknown[] }> };
}

describe('internal conversation upsert', () => {
  it('reuses the lifecycle conversation for the same external user and deterministic client id', async () => {
    const existing = { id: 'conversation-1', external_user_id: 'customer-1', client_conversation_id: 'lifecycle' };
    const db = database(existing);
    const result = await upsertProjectConversation({ DB: db }, 11, 'customer-1', 'lifecycle', 'Lifecycle messages');

    expect(result).toEqual({ conversation: existing, duplicate: true });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[0].sql).toContain('ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING');
    expect(db.calls[1].args).toEqual([11, 'customer-1', 'lifecycle']);
  });
});
