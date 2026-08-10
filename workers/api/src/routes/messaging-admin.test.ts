import { describe, expect, it } from 'vitest';
import {
  consumeMessagingRealtimeTicket,
  issueMessagingRealtimeTicket,
  requireMessagingAccess,
} from './messaging-admin';
import messaging from './messaging-admin';

type CapturedStatement = { sql: string; values: unknown[] };

function issuingDatabase(captured: CapturedStatement[]) {
  return {
    prepare(sql: string) {
      const statement: CapturedStatement = { sql, values: [] };
      captured.push(statement);
      return {
        bind(...values: unknown[]) {
          statement.values = values;
          return { run: async () => ({ meta: { changes: 1 } }) };
        },
      };
    },
  } as unknown as D1Database;
}

describe('Messaging realtime tickets', () => {
  it('stores only a SHA-256 hash and expires the ticket after 60 seconds', async () => {
    const captured: CapturedStatement[] = [];
    const now = Date.parse('2026-08-04T12:00:00.000Z');
    const issued = await issueMessagingRealtimeTicket(issuingDatabase(captured), {
      projectId: '42',
      projectExternalId: 'app_42',
      conversationId: 'conversation-1',
      userId: 'operator-1',
    }, now);

    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expires_at).toBe('2026-08-04T12:01:00.000Z');
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('INSERT INTO messaging_realtime_tickets');
    expect(captured[0].values).not.toContain(issued.ticket);
    expect(captured[0].values[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(captured[0].values.slice(1)).toEqual([
      '42', 'app_42', 'conversation-1', 'operator-1', '2026-08-04T12:01:00.000Z',
    ]);
  });

  it('atomically consumes an unexpired ticket within its project and conversation scope', async () => {
    const captured: CapturedStatement[] = [];
    let available = true;
    const db = {
      prepare(sql: string) {
        const statement: CapturedStatement = { sql, values: [] };
        captured.push(statement);
        return {
          bind(...values: unknown[]) {
            statement.values = values;
            return {
              first: async () => {
                if (!available) return null;
                available = false;
                return {
                  project_id: '42',
                  project_external_id: 'app_42',
                  conversation_id: 'conversation-1',
                  user_id: 'operator-1',
                  expires_at: '2026-08-04T12:01:00.000Z',
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const params = {
      ticket: 'A'.repeat(43),
      projectExternalId: 'app_42',
      conversationId: 'conversation-1',
    };
    const now = Date.parse('2026-08-04T12:00:30.000Z');

    await expect(consumeMessagingRealtimeTicket(db, params, now)).resolves.toMatchObject({ user_id: 'operator-1' });
    await expect(consumeMessagingRealtimeTicket(db, params, now)).resolves.toBeNull();
    expect(captured[0].sql).toContain('consumed_at IS NULL');
    expect(captured[0].sql).toContain('expires_at > ?');
    expect(captured[0].values).toEqual([
      '2026-08-04T12:00:30.000Z',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'app_42',
      'conversation-1',
      '2026-08-04T12:00:30.000Z',
    ]);
    expect(captured[0].values).not.toContain(params.ticket);
  });

  it('forwards an authorized upgrade without browser credentials or the ticket', async () => {
    let forwarded: Request | null = null;
    const ticket = 'A'.repeat(43);
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                first: async () => ({
                  project_id: '42',
                  project_external_id: 'app_42',
                  conversation_id: 'conversation-1',
                  user_id: 'operator-1',
                  expires_at: '2099-01-01T00:00:00.000Z',
                }),
              };
            },
          };
        },
      },
      MESSAGING_INTERNAL_TOKEN: 'internal-capability',
      MESSAGING: {
        fetch: async (request: Request) => {
          forwarded = request;
          return new Response(null, { status: 204 });
        },
      },
    };

    const response = await messaging.request(
      `/app_42/conversations/conversation-1/ws?ticket=${ticket}`,
      { headers: { Upgrade: 'websocket', Authorization: 'Bearer dashboard-token', Cookie: 'session=secret' } },
      env as never,
    );

    expect(response.status).toBe(204);
    expect(forwarded).not.toBeNull();
    expect((forwarded as Request).url).toBe(
      'https://messaging.internal/internal/projects/42/conversations/conversation-1/ws',
    );
    expect((forwarded as Request).headers.get('Authorization')).toBeNull();
    expect((forwarded as Request).headers.get('Cookie')).toBeNull();
    expect((forwarded as Request).headers.get('X-OpenGrow-Internal-Token')).toBe('internal-capability');
    expect((forwarded as Request).headers.get('X-OpenGrow-Agent-Id')).toBe('operator-1');
    expect((forwarded as Request).headers.get('Upgrade')).toBe('websocket');
  });
});

describe('Messaging administration permissions', () => {
  it('allows members to operate conversations and read configuration', () => {
    expect(() => requireMessagingAccess('POST', '/conversations/conversation-1/messages', 'member')).not.toThrow();
    expect(() => requireMessagingAccess('GET', '/settings', 'member')).not.toThrow();
  });

  it('requires an owner or admin for configuration mutations', () => {
    expect(() => requireMessagingAccess('PATCH', '/settings', 'member')).toThrow('Owner or admin access');
    expect(() => requireMessagingAccess('POST', '/settings/entities', 'member')).toThrow('Owner or admin access');
    expect(() => requireMessagingAccess('DELETE', '/settings/entities/entity-1', 'admin')).not.toThrow();
  });
});
