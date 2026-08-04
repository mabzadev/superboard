import { describe, expect, it } from 'vitest';
import { listProjectConversations, listUserConversations, upsertProjectConversation } from './index';

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

  it('derives participant-specific unread counts without duplicating messages', async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql.replace(/\s+/g, ' ').trim());
        return {
          bind() {
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    } as unknown as D1Database;

    await listUserConversations(db, 11, 'customer-1');
    await listProjectConversations(db, 11);

    expect(calls[0]).toContain("message.sender_kind IN ('agent', 'system')");
    expect(calls[0]).toContain('message.created_at > conversation.user_last_read_at');
    expect(calls[1]).toContain("unread.sender_kind = 'user'");
    expect(calls[1]).toContain('unread.created_at > c.agent_last_read_at');
  });
});
