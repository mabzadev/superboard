import { env } from 'cloudflare:workers';
import { evictDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';

const capability = 'runtime-test-internal-token';

describe('ConversationRoom in the Workers runtime', () => {
  it('isolates sequence state per conversation and preserves concurrent message order', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'conversation-a', 11, 'user-a');
    await seedConversation(testEnv.DB, 'conversation-b', 12, 'user-b');
    const roomA = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('conversation-a'));
    const roomB = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('conversation-b'));

    const [first, second, isolated] = await Promise.all([
      createMessage(roomA, 'conversation-a', 'user-a', 'local-a1', 'First'),
      createMessage(roomA, 'conversation-a', 'user-a', 'local-a2', 'Second'),
      createMessage(roomB, 'conversation-b', 'user-b', 'local-b1', 'Isolated'),
    ]);

    expect([first.data.sequence, second.data.sequence].sort()).toEqual([1, 2]);
    expect(isolated.data.sequence).toBe(1);
    const rows = await testEnv.DB.prepare(`
      SELECT conversation_id, sequence FROM messages ORDER BY conversation_id, sequence
    `).all<{ conversation_id: string; sequence: number }>();
    expect(rows.results).toEqual([
      { conversation_id: 'conversation-a', sequence: 1 },
      { conversation_id: 'conversation-a', sequence: 2 },
      { conversation_id: 'conversation-b', sequence: 1 },
    ]);
  });

  it('accepts only attachments owned by the target conversation', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'attachment-room', 11, 'user-a');
    const room = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('attachment-room'));
    await testEnv.ATTACHMENTS.put('attachments/owned', 'evidence', {
      customMetadata: { conversationId: 'attachment-room' },
    });
    await testEnv.ATTACHMENTS.put('attachments/foreign', 'evidence', {
      customMetadata: { conversationId: 'another-room' },
    });

    const rejected = await room.fetch(messageRequest('attachment-room', 'user-a', {
      client_message_id: 'foreign-attachment',
      attachment_key: 'attachments/foreign',
      attachment_name: 'foreign.txt',
      attachment_content_type: 'text/plain',
    }));
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toMatchObject({ code: 'attachment_not_owned' });

    const accepted = await room.fetch(messageRequest('attachment-room', 'user-a', {
      client_message_id: 'owned-attachment',
      attachment_key: 'attachments/owned',
      attachment_name: 'owned.txt',
      attachment_content_type: 'text/plain',
    }));
    expect(accepted.status).toBe(201);
    await expect(accepted.json()).resolves.toMatchObject({
      data: { attachment_key: 'attachments/owned', sequence: 1 },
    });

    const duplicate = await room.fetch(messageRequest('attachment-room', 'user-a', {
      client_message_id: 'owned-attachment',
      attachment_key: 'attachments/owned',
      attachment_name: 'owned.txt',
      attachment_content_type: 'text/plain',
    }));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true, data: { sequence: 1 } });

    const conflict = await room.fetch(messageRequest('attachment-room', 'user-a', {
      client_message_id: 'owned-attachment',
      attachment_key: 'attachments/owned',
      attachment_name: 'renamed.txt',
      attachment_content_type: 'text/plain',
    }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: 'idempotency_conflict' });

    const afterDuplicate = await room.fetch(messageRequest('attachment-room', 'user-a', {
      client_message_id: 'after-duplicate', body: 'No sequence gap',
    }));
    await expect(afterDuplicate.json()).resolves.toMatchObject({ data: { sequence: 2 } });
  });

  it('continues sequence numbers from durable D1 history when room storage is empty', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'restored-room', 11, 'user-a');
    await testEnv.DB.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_kind, sender_id, body, client_message_id, sequence
      ) VALUES ('restored-message', 'restored-room', 'user', 'user-a', 'Restored history', 'restored-history', 7)
    `).run();

    const room = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('restored-room'));
    const response = await room.fetch(messageRequest('restored-room', 'user-a', {
      client_message_id: 'after-restore', body: 'Continue after restore',
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: { sequence: 8 } });
  });

  it('returns a stable 413 response for an oversized room message body', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'bounded-room', 11, 'user-a');
    const room = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('bounded-room'));
    const response = await room.fetch(roomRequest('https://room.internal/messages', 'bounded-room', 'user-a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x'.repeat(16_384), client_message_id: 'oversized' }),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: 'request_too_large',
      retryable: false,
    });
  });

  it('keeps a hibernatable WebSocket usable after Durable Object eviction', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'socket-room', 11, 'user-a');
    const room = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('socket-room'));
    const response = await room.fetch(roomRequest('https://room.internal/connect', 'socket-room', 'user-a', {
      headers: { Upgrade: 'websocket' },
    }));
    const socket = response.webSocket;
    if (!socket) throw new Error('Expected a WebSocket response');
    socket.accept();

    await expect(nextMessage(socket)).resolves.toMatchObject({
      type: 'connected',
      conversation_id: 'socket-room',
    });
    await evictDurableObject(room);
    const pong = nextMessage(socket);
    socket.send(JSON.stringify({ type: 'ping' }));
    await expect(pong).resolves.toEqual({ type: 'pong' });
    socket.close(1000, 'done');

    const reconnectResponse = await room.fetch(roomRequest(
      'https://room.internal/connect',
      'socket-room',
      'user-a',
      { headers: { Upgrade: 'websocket' } },
    ));
    const reconnected = reconnectResponse.webSocket;
    if (!reconnected) throw new Error('Expected a reconnected WebSocket response');
    reconnected.accept();
    await expect(nextMessage(reconnected)).resolves.toMatchObject({
      type: 'connected',
      conversation_id: 'socket-room',
    });
    reconnected.close(1000, 'done');
  });

  it('rejects a WebSocket whose identity token is already expired', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'expired-socket-room', 11, 'user-a');
    const room = testEnv.CONVERSATIONS.get(testEnv.CONVERSATIONS.idFromName('expired-socket-room'));
    const response = await room.fetch(roomRequest(
      'https://room.internal/connect',
      'expired-socket-room',
      'user-a',
      {
        headers: {
          Upgrade: 'websocket',
          'x-identity-expires-at': String(Date.now() - 1_000),
        },
      },
    ));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'identity_expired' });
  });

  it('supports agent receipts, typing, and owned attachments through internal routes', async () => {
    const testEnv = env as unknown as Env;
    await seedConversation(testEnv.DB, 'agent-room', 11, 'user-a');
    const base = 'https://messaging.internal/internal/projects/11/conversations/agent-room';
    const headers = {
      'X-OpenGrow-Internal-Token': capability,
      'X-OpenGrow-Agent-Id': 'agent-1',
    };

    const read = await SELF.fetch(`${base}/read`, { method: 'POST', headers });
    expect(read.status).toBe(200);
    await expect(testEnv.DB.prepare(`
      SELECT agent_last_read_at FROM conversations WHERE id = 'agent-room'
    `).first()).resolves.toMatchObject({ agent_last_read_at: expect.any(String) });

    const typing = await SELF.fetch(`${base}/typing`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    expect(typing.status).toBe(204);

    const upload = await SELF.fetch(`${base}/attachments`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain', 'X-Filename': 'evidence.txt' },
      body: 'attachment evidence',
    });
    expect(upload.status).toBe(201);
    const attachment = await upload.json() as { key: string; filename: string; content_type: string };
    expect(attachment).toMatchObject({ filename: 'evidence.txt', content_type: 'text/plain' });

    const message = await SELF.fetch(`${base}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachment_key: attachment.key,
        attachment_name: attachment.filename,
        attachment_content_type: attachment.content_type,
        client_message_id: 'agent-attachment-message',
      }),
    });
    expect(message.status).toBe(201);
    const messagePayload = await message.json() as { data: { id: string } };

    const download = await SELF.fetch(`${base}/attachments/${messagePayload.data.id}`, { headers });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('attachment evidence');
  });
});

async function seedConversation(db: D1Database, id: string, projectId: number, externalUserId: string) {
  await db.prepare(`
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, projectId, externalUserId, `client-${id}`, 'Runtime test').run();
}

async function createMessage(
  room: DurableObjectStub,
  conversationId: string,
  actorId: string,
  clientMessageId: string,
  body: string,
) {
  const response = await room.fetch(messageRequest(conversationId, actorId, {
    client_message_id: clientMessageId,
    body,
  }));
  expect(response.status).toBe(201);
  return response.json<{ data: { sequence: number } }>();
}

function messageRequest(conversationId: string, actorId: string, body: Record<string, unknown>) {
  return roomRequest('https://room.internal/messages', conversationId, actorId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function roomRequest(url: string, conversationId: string, actorId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-room-capability', capability);
  headers.set('x-conversation-id', conversationId);
  headers.set('x-actor-id', actorId);
  headers.set('x-actor-kind', 'user');
  if (!headers.has('x-identity-expires-at')) {
    headers.set('x-identity-expires-at', String(Date.now() + 60_000));
  }
  return new Request(url, { ...init, headers });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2_000);
    socket.addEventListener('message', (event) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
    }, { once: true });
  });
}
