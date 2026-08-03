import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
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
