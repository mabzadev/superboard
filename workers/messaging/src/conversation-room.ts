import type { DurableObjectState } from '@cloudflare/workers-types';
import { parseMessageInput } from './validation';
import type { Actor, Conversation, Env } from './types';
import { timingSafeEqual } from './auth';

type SocketAttachment = Actor & { conversationId: string };

export class ConversationRoom implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const capability = request.headers.get('x-room-capability') || '';
    if (!capability || !this.env.INTERNAL_API_TOKEN || !timingSafeEqual(capability, this.env.INTERNAL_API_TOKEN)) {
      return Response.json({ code: 'room_auth_invalid', message: 'Room capability rejected' }, { status: 401 });
    }
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.connectWebSocket(request);
    if (url.pathname === '/messages' && request.method === 'POST') return this.createMessage(request);
    if (url.pathname === '/typing' && request.method === 'POST') return this.typing(request);
    if (url.pathname === '/read' && request.method === 'POST') return this.markRead(request);
    return Response.json({ code: 'not_found', message: 'Room operation not found' }, { status: 404 });
  }

  private async connectWebSocket(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ code: 'upgrade_required', message: 'WebSocket upgrade required' }, { status: 426 });
    }
    const attachment = this.actorFromHeaders(request);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    server.send(JSON.stringify({ type: 'connected', conversation_id: attachment.conversationId }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async createMessage(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const conversation = await this.conversation(actor.conversationId);
    if (!conversation) return Response.json({ code: 'conversation_not_found', message: 'Conversation not found' }, { status: 404 });
    const input = parseMessageInput(await request.json().catch(() => ({})));
    if (input.attachment_key) {
      const attachment = await this.env.ATTACHMENTS.head(input.attachment_key);
      if (!attachment || attachment.customMetadata?.conversationId !== conversation.id) {
        return Response.json({ code: 'attachment_not_owned', message: 'Attachment does not belong to this conversation' }, { status: 403 });
      }
    }
    const existing = await this.env.DB.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND client_message_id = ? LIMIT 1',
    ).bind(conversation.id, input.client_message_id).first<Record<string, unknown>>();
    if (existing) {
      if (!messageMatchesInput(existing, input)) return idempotencyConflict();
      return Response.json({ data: existing, duplicate: true });
    }
    const sequence = await this.nextSequence(conversation.id);
    const id = crypto.randomUUID();
    const inserted = await this.env.DB.prepare(`
      INSERT INTO messages (
        id, conversation_id, sender_kind, sender_id, body, attachment_key,
        attachment_name, attachment_content_type, client_message_id, sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, client_message_id) DO NOTHING
      RETURNING *
    `).bind(
      id, conversation.id, actor.kind, actor.id, input.body, input.attachment_key,
      input.attachment_name, input.attachment_content_type, input.client_message_id, sequence,
    ).first<Record<string, unknown>>();

    const message = inserted || await this.env.DB.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? AND client_message_id = ? LIMIT 1',
    ).bind(conversation.id, input.client_message_id).first<Record<string, unknown>>();
    if (!message) throw new Error('Unable to persist message');

    if (!inserted && !messageMatchesInput(message, input)) return idempotencyConflict();

    if (inserted) {
      const preview = input.body?.slice(0, 240) || `[Attachment] ${input.attachment_name || ''}`.trim();
      await this.env.DB.batch([
        this.env.DB.prepare(`
          UPDATE conversations SET last_message_preview = ?, last_message_at = ?, updated_at = ?
          WHERE id = ?
        `).bind(preview, String(message.created_at), String(message.created_at), conversation.id),
        this.env.DB.prepare(`
          INSERT INTO messaging_audit_events
            (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
          VALUES (?, ?, ?, 'message.created', ?, ?, ?)
        `).bind(
          crypto.randomUUID(), conversation.id, conversation.project_id, actor.kind, actor.id,
          JSON.stringify({ message_id: message.id, sequence: message.sequence }),
        ),
      ]);
      this.broadcast({ type: 'message.created', conversation_id: conversation.id, message });
    }
    return Response.json({ data: message, duplicate: !inserted }, { status: inserted ? 201 : 200 });
  }

  private async typing(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const value = await request.json().catch(() => ({})) as { active?: unknown };
    this.broadcast({
      type: 'typing.changed', conversation_id: actor.conversationId,
      actor: { kind: actor.kind, id: actor.id }, active: value.active === true,
    }, actor);
    return new Response(null, { status: 204 });
  }

  private async markRead(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const field = actor.kind === 'user' ? 'user_last_read_at' : 'agent_last_read_at';
    const now = new Date().toISOString();
    await this.env.DB.prepare(`UPDATE conversations SET ${field} = ?, updated_at = updated_at WHERE id = ?`)
      .bind(now, actor.conversationId).run();
    this.broadcast({
      type: 'receipt.read', conversation_id: actor.conversationId,
      actor: { kind: actor.kind, id: actor.id }, read_at: now,
    }, actor);
    return Response.json({ read_at: now });
  }

  private actorFromHeaders(request: Request): SocketAttachment {
    const id = request.headers.get('x-actor-id') || '';
    const kind = request.headers.get('x-actor-kind') as Actor['kind'] | null;
    const conversationId = request.headers.get('x-conversation-id') || '';
    if (!id || !conversationId || !kind || !['user', 'agent', 'system'].includes(kind)) {
      throw new Error('Invalid room actor');
    }
    return { id, kind, conversationId };
  }

  private async conversation(id: string) {
    return this.env.DB.prepare('SELECT id, project_id, external_user_id, status FROM conversations WHERE id = ?')
      .bind(id).first<Conversation>();
  }

  private async nextSequence(conversationId: string): Promise<number> {
    const persisted = await this.env.DB.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM messages WHERE conversation_id = ?
    `).bind(conversationId).first<{ sequence: number }>();
    const persistedSequence = Number(persisted?.sequence || 0);
    return this.state.storage.transaction(async (transaction) => {
      const stored = await transaction.get<number>('sequence');
      const current = Math.max(Number(stored || 0), persistedSequence);
      const next = current + 1;
      await transaction.put('sequence', next);
      return next;
    });
  }

  private broadcast(payload: unknown, except?: Actor) {
    const encoded = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (except && attachment?.id === except.id && attachment.kind === except.kind) continue;
      try { socket.send(encoded); } catch { try { socket.close(1011, 'Delivery failed'); } catch { /* no-op */ } }
    }
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (typeof message !== 'string' || message.length > 1_024) {
      socket.close(1009, 'Message too large');
      return;
    }
    try {
      const parsed = JSON.parse(message) as { type?: string; active?: boolean };
      const actor = socket.deserializeAttachment() as SocketAttachment;
      if (parsed.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      if (parsed.type === 'typing') this.broadcast({
        type: 'typing.changed', conversation_id: actor.conversationId,
        actor: { kind: actor.kind, id: actor.id }, active: parsed.active === true,
      }, actor);
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'message_invalid' }));
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
  }

  webSocketError(socket: WebSocket) {
    try { socket.close(1011, 'WebSocket error'); } catch { /* no-op */ }
  }
}

function messageMatchesInput(message: Record<string, unknown>, input: ReturnType<typeof parseMessageInput>) {
  return (message.body ?? null) === input.body
    && (message.attachment_key ?? null) === input.attachment_key
    && (message.attachment_name ?? null) === input.attachment_name
    && (message.attachment_content_type ?? null) === input.attachment_content_type;
}

function idempotencyConflict() {
  return Response.json({
    code: 'idempotency_conflict',
    message: 'client_message_id was already used with a different payload',
  }, { status: 409 });
}
