import { DurableObject } from "cloudflare:workers";
import { parseMessageInput, readJsonObject } from "./validation";
import type { Actor, Conversation, Env } from "./types";
import {
  configuredSecrets,
  matchesAnySecret,
} from "@superboard/contracts/secret";
import { runConversationAutomations } from "./workflows";
import { publishSupportEvent } from "./webhooks";
import { localAttachment, MESSAGE_WITH_ATTACHMENTS } from "./message-records";
import {
  SUPPORT_SCHEMA_VERSION,
  parseSupportRealtimeEvent,
  type SupportMessageAttachmentDto,
  type SupportMessageDto,
  type SupportRealtimeEvent,
  type SupportRealtimeEventType,
} from "@superboard/contracts/support";
import { recordSlaMessage } from "./service-levels";
import { enqueueAutomaticCaptainTasks } from "./captain";

type SocketAttachment = Actor & { conversationId: string; expiresAt: number };

export class ConversationRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrateSqlStorage();
    });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const capability = request.headers.get("x-room-capability") || "";
      if (
        !(await matchesAnySecret(
          capability,
          configuredSecrets(
            this.env.INTERNAL_API_TOKEN,
            this.env.INTERNAL_API_TOKEN_PREVIOUS,
          ),
        ))
      ) {
        return Response.json(
          { code: "room_auth_invalid", message: "Room capability rejected" },
          { status: 401 },
        );
      }
      const url = new URL(request.url);
      if (url.pathname === "/connect")
        return await this.connectWebSocket(request);
      if (url.pathname === "/messages" && request.method === "POST")
        return await this.createMessage(request);
      const messageRoute = /^\/messages\/([^/]+)$/.exec(url.pathname);
      if (messageRoute && request.method === "PATCH")
        return await this.updateMessage(request, decodeURIComponent(messageRoute[1]));
      if (messageRoute && request.method === "DELETE")
        return await this.deleteMessage(request, decodeURIComponent(messageRoute[1]));
      if (/^\/messages\/[^/]+\/retry$/.test(url.pathname) && request.method === "POST")
        return await this.retryMessage(request, decodeURIComponent(url.pathname.split("/")[2]));
      if (/^\/messages\/[^/]+\/delivery$/.test(url.pathname) && request.method === "PATCH")
        return await this.updateDelivery(request, decodeURIComponent(url.pathname.split("/")[2]));
      if (url.pathname === "/typing" && request.method === "POST")
        return await this.typing(request);
      if (url.pathname === "/read" && request.method === "POST")
        return await this.markRead(request);
      if (url.pathname === "/erase" && request.method === "DELETE")
        return await this.eraseConversation();
      return Response.json(
        { code: "not_found", message: "Room operation not found" },
        { status: 404 },
      );
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 500);
      return Response.json(
        {
          code: (error as { code?: string })?.code || "internal_error",
          message:
            status >= 500
              ? "Conversation services are temporarily unavailable"
              : error instanceof Error
                ? error.message
                : "Request failed",
          retryable: status >= 500,
        },
        { status },
      );
    }
  }

  private async connectWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { code: "upgrade_required", message: "WebSocket upgrade required" },
        { status: 426 },
      );
    }
    const attachment = this.actorFromHeaders(request);
    if (attachment.expiresAt <= Date.now()) {
      return Response.json(
        { code: "identity_expired", message: "Identity token has expired" },
        { status: 401 },
      );
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    server.send(
      JSON.stringify(
        canonicalRealtimeEvent({
          type: "connected",
          conversation_id: attachment.conversationId,
        }),
      ),
    );
    this.broadcast(
      {
        type: "presence.updated",
        conversation_id: attachment.conversationId,
        actor: { kind: attachment.kind, id: attachment.id },
        state: "online",
      },
      attachment,
    );
    await this.scheduleSocketExpiration();
    return new Response(null, { status: 101, webSocket: client });
  }

  private async createMessage(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const conversation = await this.conversation(actor.conversationId);
    if (!conversation)
      return Response.json(
        { code: "conversation_not_found", message: "Conversation not found" },
        { status: 404 },
      );
    const input = parseMessageInput(await readJsonObject(request));
    if (input.visibility === "private" && actor.kind !== "agent") {
      return Response.json(
        {
          code: "private_note_forbidden",
          message: "Only agents can create private notes",
        },
        { status: 403 },
      );
    }
    if (input.reply_to_message_id) {
      const replied = await this.env.DB.prepare(
        "SELECT id FROM messages WHERE id = ? AND conversation_id = ?",
      )
        .bind(input.reply_to_message_id, conversation.id)
        .first();
      if (!replied)
        return Response.json(
          {
            code: "reply_message_not_found",
            message: "Reply message not found",
          },
          { status: 404 },
        );
    }
    const attachmentObjects = await Promise.all(
      input.attachments.map(async (attachment) => ({
        input: attachment,
        object: await this.env.ATTACHMENTS.head(attachment.key),
      })),
    );
    for (const attachment of attachmentObjects) {
      if (
        !attachment.object ||
        attachment.object.customMetadata?.conversationId !== conversation.id
      ) {
        return Response.json(
          {
            code: "attachment_not_owned",
            message: "Attachment does not belong to this conversation",
          },
          { status: 403 },
        );
      }
    }
    const existing = await this.env.DB.prepare(
      `SELECT ${MESSAGE_WITH_ATTACHMENTS} FROM messages
       WHERE conversation_id = ? AND client_message_id = ? LIMIT 1`,
    )
      .bind(conversation.id, input.client_message_id)
      .first<Record<string, unknown>>();
    if (existing) {
      if (!messageMatchesInput(existing, input)) return idempotencyConflict();
      await this.recordMessageSla(conversation, existing, actor, input.visibility);
      if (outboundProviderDeliveryRequested(actor, input)) {
        await this.enqueueProviderDelivery(conversation, String(existing.id), input);
      }
      if (actor.kind === "user" && input.visibility === "public") {
        await enqueueAutomaticCaptainTasks(
          this.env,
          conversation.project_id,
          conversation.id,
          String(existing.id),
        );
      }
      await publishMessageEvent(this.env, conversation, existing);
      return Response.json({ data: publicMessage(existing, conversation.id) });
    }
    const sequence = await this.nextSequence(conversation.id);
    const id = crypto.randomUUID();
    const initialDeliveryStatus = actor.kind === "system" &&
      input.metadata.delivery_pending === true
      ? "pending"
      : "sent";
    const inserted = await this.env.DB.prepare(
      `
      INSERT INTO messages (
        id, conversation_id, sender_kind, sender_id, body, attachment_key,
        attachment_name, attachment_content_type, client_message_id, sequence
        , visibility, content_type, reply_to_message_id, metadata_json,
        delivery_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, client_message_id) DO NOTHING
      RETURNING *
    `,
    )
      .bind(
        id,
        conversation.id,
        actor.kind,
        actor.id,
        input.body,
        input.attachment_key,
        input.attachment_name,
        input.attachment_content_type,
        input.client_message_id,
        sequence,
        input.visibility,
        input.content_type,
        input.reply_to_message_id,
        JSON.stringify(input.metadata),
        initialDeliveryStatus,
      )
      .first<Record<string, unknown>>();

    const persisted =
      inserted ||
      (await this.env.DB.prepare(
        `SELECT ${MESSAGE_WITH_ATTACHMENTS} FROM messages
       WHERE conversation_id = ? AND client_message_id = ? LIMIT 1`,
      )
        .bind(conversation.id, input.client_message_id)
        .first<Record<string, unknown>>());
    if (!persisted) throw new Error("Unable to persist message");

    if (!inserted && !messageMatchesInput(persisted, input))
      return idempotencyConflict();

    if (inserted) {
      const statements = [
        ...attachmentObjects.map((attachment, position) =>
          this.env.DB.prepare(
                `
          INSERT OR IGNORE INTO support_message_attachments (
            id, project_id, conversation_id, message_id, storage_key, file_name,
            content_type, byte_size, position, source_provider, source_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'superboard', ?)
        `,
              ).bind(
                `${id}:attachment:${position}`,
                conversation.project_id,
                conversation.id,
                id,
                attachment.input.key,
                attachment.input.name || "attachment",
                attachment.input.content_type || "application/octet-stream",
                attachment.object?.size ?? null,
                position,
                `${id}:${position}`,
              ),
        ),
        ...(input.visibility === "public"
          ? [
              this.env.DB.prepare(
                `
          UPDATE conversations SET last_message_preview = ?, last_message_at = ?, updated_at = ?
          WHERE id = ?
        `,
              ).bind(
                input.body?.slice(0, 240) ||
                  `[Attachment] ${input.attachment_name || ""}`.trim(),
                String(persisted.created_at),
                String(persisted.created_at),
                conversation.id,
              ),
            ]
          : []),
        this.env.DB.prepare(
          `
          INSERT INTO support_audit_events
            (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
          VALUES (?, ?, ?, 'message.created', ?, ?, ?)
        `,
        ).bind(
          crypto.randomUUID(),
          conversation.id,
          conversation.project_id,
          actor.kind,
          actor.id,
          JSON.stringify({
            message_id: persisted.id,
            sequence: persisted.sequence,
            visibility: input.visibility,
          }),
        ),
      ];
      await this.env.DB.batch(statements);
      await this.recordMessageSla(conversation, persisted, actor, input.visibility);
      if (outboundProviderDeliveryRequested(actor, input)) {
        await this.enqueueProviderDelivery(conversation, id, input);
      }
      const message: Record<string, unknown> = {
        ...persisted,
        attachments_json: JSON.stringify(localAttachment(id, input)),
      };
      this.broadcast(
        { type: "message.created", conversation_id: conversation.id, message },
        undefined,
        input.visibility === "private" ? "agents" : "all",
      );
      await runConversationAutomations(
        this.env,
        conversation.project_id,
        conversation.id,
        "message_created",
        String(message.id),
        { sender_kind: actor.kind, visibility: input.visibility },
      );
      if (actor.kind === "user" && input.visibility === "public") {
        await enqueueAutomaticCaptainTasks(
          this.env,
          conversation.project_id,
          conversation.id,
          String(message.id),
        );
      }
      await publishMessageEvent(this.env, conversation, message);
      return Response.json(
        { data: publicMessage(message, conversation.id) },
        { status: 201 },
      );
    }
    await this.recordMessageSla(conversation, persisted, actor, input.visibility);
    return Response.json({ data: publicMessage(persisted, conversation.id) });
  }

  private async recordMessageSla(
    conversation: Conversation,
    message: Record<string, unknown>,
    actor: Actor,
    visibility: "public" | "private",
  ) {
    const slaUpdate = await recordSlaMessage(
      this.env.DB,
      conversation.project_id,
      conversation.id,
      actor.kind,
      visibility,
      new Date(String(message.created_at)),
      String(message.id),
    );
    if (!slaUpdate.changed) return;
    await publishSupportEvent(
      this.env,
      conversation.project_id,
      `sla.message:${conversation.id}:${message.id}`,
      "sla.updated",
      {
        conversation_id: conversation.id,
        message_id: message.id,
        applied_sla_id: slaUpdate.appliedSlaId,
        status: slaUpdate.status,
      },
    );
  }

  private async typing(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const value = (await readJsonObject(request)) as { active?: unknown };
    this.broadcast(
      {
        type: value.active === true ? "typing.started" : "typing.stopped",
        conversation_id: actor.conversationId,
        actor: { kind: actor.kind, id: actor.id },
      },
      actor,
    );
    return new Response(null, { status: 204 });
  }

  private async markRead(request: Request): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const field =
      actor.kind === "user" ? "user_last_read_at" : "agent_last_read_at";
    const now = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE conversations SET ${field} = ?, updated_at = updated_at WHERE id = ?`,
    )
      .bind(now, actor.conversationId)
      .run();
    this.broadcast(
      {
        type: "conversation.read",
        conversation_id: actor.conversationId,
        actor: { kind: actor.kind, id: actor.id },
        read_at: now,
      },
      actor,
    );
    return Response.json({ read_at: now });
  }

  private async updateMessage(request: Request, messageId: string): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const body = await readJsonObject(request);
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text || text.length > 8_000) {
      throw failure("message_invalid", "Edited message text is required and limited to 8000 characters", 422);
    }
    const changed = await this.env.DB.prepare(
      `UPDATE messages SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND conversation_id = ?
         AND (? = 'agent' OR (sender_kind = ? AND sender_id = ?))
         AND deleted_at IS NULL RETURNING id`,
    ).bind(text, messageId, actor.conversationId, actor.kind, actor.kind, actor.id)
      .first<{ id: string }>();
    if (!changed) throw failure("message_not_found", "Message not found or cannot be edited", 404);
    const row = await this.env.DB.prepare(
      `SELECT ${MESSAGE_WITH_ATTACHMENTS} FROM messages
       WHERE id = ? AND conversation_id = ?`,
    ).bind(messageId, actor.conversationId).first<Record<string, unknown>>();
    if (!row) throw failure("message_not_found", "Message not found or cannot be edited", 404);
    const event = { type: "message.updated", conversation_id: actor.conversationId, message: row };
    this.broadcast(event);
    await this.auditMessage(actor, messageId, "message.updated", { edited_at: row.edited_at });
    return Response.json({ data: publicMessage(row, actor.conversationId) });
  }

  private async deleteMessage(request: Request, messageId: string): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    const row = await this.env.DB.prepare(
      `UPDATE messages SET body = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND conversation_id = ?
         AND (? = 'agent' OR (sender_kind = ? AND sender_id = ?))
         AND deleted_at IS NULL RETURNING id, deleted_at`,
    ).bind(messageId, actor.conversationId, actor.kind, actor.kind, actor.id)
      .first<Record<string, unknown>>();
    if (!row) throw failure("message_not_found", "Message not found or cannot be deleted", 404);
    const event = { type: "message.deleted", conversation_id: actor.conversationId, message_id: messageId, deleted_at: row.deleted_at };
    this.broadcast(event);
    await this.auditMessage(actor, messageId, "message.deleted", { deleted_at: row.deleted_at });
    return Response.json({ data: row });
  }

  private async retryMessage(request: Request, messageId: string): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    if (actor.kind !== "agent") throw failure("message_retry_forbidden", "Only Support agents can retry delivery", 403);
    const row = await this.env.DB.prepare(
      `UPDATE messages SET failure_reason = NULL WHERE id = ? AND conversation_id = ?
       AND deleted_at IS NULL RETURNING id, provider_message_id`,
    ).bind(messageId, actor.conversationId).first<Record<string, unknown>>();
    if (!row) throw failure("message_not_found", "Message not found", 404);
    const conversation = await this.conversation(actor.conversationId);
    if (!conversation) throw failure("conversation_not_found", "Conversation not found", 404);
    await this.env.SUPPORT_QUEUE.send({
      type: "support.message.retry.v1",
      projectId: conversation.project_id,
      conversationId: actor.conversationId,
      messageId,
    }, { contentType: "json" });
    await this.auditMessage(actor, messageId, "message.retry_requested", {});
    return Response.json({ data: { id: messageId, status: "queued" } }, { status: 202 });
  }

  private async updateDelivery(request: Request, messageId: string): Promise<Response> {
    const actor = this.actorFromHeaders(request);
    if (actor.kind === "user") throw failure("delivery_update_forbidden", "Delivery state cannot be changed by an end user", 403);
    const body = await readJsonObject(request);
    const status = String(body.status || "");
    if (!["queued", "sending", "sent", "delivered", "read", "failed", "cancelled"].includes(status)) {
      throw failure("delivery_status_invalid", "Delivery status is invalid", 422);
    }
    const deliveryId = body.delivery_id == null || body.delivery_id === ""
      ? null
      : String(body.delivery_id).trim();
    if (deliveryId != null && (deliveryId.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(deliveryId))) {
      throw failure("delivery_id_invalid", "Delivery identifier is invalid", 422);
    }
    const reasonCode = status === "failed"
      ? String(body.reason_code || body.reason || "delivery_failed").slice(0, 255)
      : null;
    const changed = await this.env.DB.prepare(
      `UPDATE support_provider_deliveries SET status = ?, last_error = ?,
       delivered_at = CASE WHEN ? IN ('delivered', 'read') THEN
         COALESCE(delivered_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE delivered_at END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE message_id = ? AND conversation_id = ? AND (? IS NULL OR id = ?)
       RETURNING id`,
    ).bind(status, reasonCode, status, messageId, actor.conversationId, deliveryId, deliveryId)
      .first<{ id: string }>();
    if (!changed) throw failure("delivery_not_found", "Message delivery was not found", 404);
    const publicStatus = status === "queued" || status === "sending"
      ? "pending"
      : status === "cancelled"
        ? "failed"
        : status;
    await this.env.DB.prepare(
      `UPDATE messages SET delivery_status = ?, failure_reason = ?
       WHERE id = ? AND conversation_id = ?`,
    ).bind(publicStatus, reasonCode, messageId, actor.conversationId).run();
    const event = {
      type: "delivery.updated",
      conversation_id: actor.conversationId,
      message_id: messageId,
      status: publicStatus,
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    };
    this.broadcast(event);
    await this.auditMessage(actor, messageId, "delivery.updated", {
      delivery_id: changed.id,
      status: publicStatus,
      ...(reasonCode ? { reason_code: reasonCode } : {}),
    });
    const conversation = await this.conversation(actor.conversationId);
    if (conversation) {
      await publishSupportEvent(
        this.env,
        conversation.project_id,
        `delivery.updated:${changed.id}:${publicStatus}`,
        "delivery.updated",
        {
          delivery_id: changed.id,
          conversation_id: actor.conversationId,
          message_id: messageId,
          status: publicStatus,
          ...(reasonCode ? { reason_code: reasonCode } : {}),
        },
      );
    }
    return Response.json({ data: event });
  }

  private async auditMessage(actor: SocketAttachment, messageId: string, eventType: string, payload: unknown) {
    const conversation = await this.conversation(actor.conversationId);
    if (!conversation) return;
    await this.env.DB.prepare(
      `INSERT INTO support_audit_events
        (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), actor.conversationId, conversation.project_id,
      eventType, actor.kind, actor.id, JSON.stringify({ message_id: messageId, ...asObject(payload) })).run();
  }

  private async enqueueProviderDelivery(
    conversation: Conversation,
    messageId: string,
    input: ReturnType<typeof parseMessageInput>,
  ) {
    const endpoint = await this.env.DB.prepare(
      `SELECT endpoint.id, endpoint.provider FROM support_provider_endpoints endpoint
       INNER JOIN conversations conversation ON conversation.inbox_id = endpoint.inbox_id
       WHERE conversation.id = ? AND conversation.project_id = ?
         AND endpoint.project_id = conversation.project_id
         AND endpoint.status IN ('configured', 'validated', 'live_validated')
       ORDER BY endpoint.created_at LIMIT 1`,
    ).bind(conversation.id, conversation.project_id).first<{ id: string; provider: string }>();
    if (!endpoint || endpoint.provider === "widget" || endpoint.provider === "api") return;
    const deliveryId = crypto.randomUUID();
    const idempotencyKey = `${endpoint.id}:${messageId}`;
    const inserted = await this.env.DB.prepare(
      `INSERT INTO support_provider_deliveries
        (id, project_id, endpoint_id, conversation_id, message_id, operation,
         idempotency_key, request_json, status)
       VALUES (?, ?, ?, ?, ?, 'message.send', ?, ?, 'queued')
       ON CONFLICT(endpoint_id, idempotency_key) DO NOTHING RETURNING id`,
    ).bind(
      deliveryId, conversation.project_id, endpoint.id, conversation.id, messageId,
      idempotencyKey, JSON.stringify({ body: input.body, attachments: input.attachments }),
    ).first<{ id: string; status?: string }>();
    const delivery = inserted || await this.env.DB.prepare(
      `SELECT id, status FROM support_provider_deliveries
       WHERE endpoint_id = ? AND idempotency_key = ? AND project_id = ?`,
    ).bind(endpoint.id, idempotencyKey, conversation.project_id)
      .first<{ id: string; status: string }>();
    if (delivery?.status == null || delivery.status === "queued") {
      await this.env.SUPPORT_QUEUE.send({
        type: "support.provider.delivery.send.v1",
        projectId: conversation.project_id,
        deliveryId: delivery?.id || deliveryId,
      }, { contentType: "json" });
    }
  }

  private async eraseConversation(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(4004, "Account erased");
      } catch {
        /* no-op */
      }
    }
    await this.ctx.storage.deleteAll();
    return new Response(null, { status: 204 });
  }

  private actorFromHeaders(request: Request): SocketAttachment {
    const id = request.headers.get("x-actor-id") || "";
    const kind = request.headers.get("x-actor-kind") as Actor["kind"] | null;
    const conversationId = request.headers.get("x-conversation-id") || "";
    const expiresAt = Number(request.headers.get("x-identity-expires-at"));
    if (
      !id ||
      !conversationId ||
      !kind ||
      !["user", "agent", "system"].includes(kind) ||
      !Number.isFinite(expiresAt)
    ) {
      throw new Error("Invalid room actor");
    }
    return { id, kind, conversationId, expiresAt };
  }

  private async conversation(id: string) {
    return this.env.DB.prepare(
      "SELECT id, project_id, external_user_id, status FROM conversations WHERE id = ?",
    )
      .bind(id)
      .first<Conversation>();
  }

  private async nextSequence(conversationId: string): Promise<number> {
    const persisted = await this.env.DB.prepare(
      `
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM messages WHERE conversation_id = ?
    `,
    )
      .bind(conversationId)
      .first<{ sequence: number }>();
    const persistedSequence = Number(persisted?.sequence || 0);
    return this.ctx.storage.transaction(async (transaction) => {
      const stored = await transaction.get<number>("sequence");
      const current = Math.max(Number(stored || 0), persistedSequence);
      const next = current + 1;
      await transaction.put("sequence", next);
      return next;
    });
  }

  private broadcast(
    payload: unknown,
    except?: Actor,
    audience: "all" | "agents" = "all",
  ) {
    const event = canonicalRealtimeEvent(payload);
    const encoded = JSON.stringify(event);
    this.persistRealtimeEvent(event, audience, encoded);
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || attachment.expiresAt <= Date.now()) {
        try {
          socket.close(4001, "Identity token expired");
        } catch {
          /* no-op */
        }
        continue;
      }
      if (
        except &&
        attachment?.id === except.id &&
        attachment.kind === except.kind
      )
        continue;
      if (audience === "agents" && attachment.kind !== "agent") continue;
      try {
        socket.send(encoded);
      } catch {
        try {
          socket.close(1011, "Delivery failed");
        } catch {
          /* no-op */
        }
      }
    }
  }

  webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment || attachment.expiresAt <= Date.now()) {
      socket.close(4001, "Identity token expired");
      return;
    }
    if (typeof message !== "string" || message.length > 1_024) {
      socket.close(1009, "Message too large");
      return;
    }
    try {
      const parsed = JSON.parse(message) as { type?: string; active?: boolean };
      const actor = attachment;
      if (parsed.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
      if (parsed.type === "typing")
        this.broadcast(
          {
            type: parsed.active === true ? "typing.started" : "typing.stopped",
            conversation_id: actor.conversationId,
            actor: { kind: actor.kind, id: actor.id },
          },
          actor,
        );
    } catch {
      socket.send(
        JSON.stringify(
          canonicalRealtimeEvent({
            type: "error",
            conversation_id: attachment.conversationId,
            error: {
              code: "message_invalid",
              message: "Realtime client message is invalid",
              retryable: false,
            },
          }),
        ),
      );
    }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    const attachment =
      socket.deserializeAttachment() as SocketAttachment | null;
    if (attachment) {
      this.broadcast(
        {
          type: "presence.updated",
          conversation_id: attachment.conversationId,
          actor: { kind: attachment.kind, id: attachment.id },
          state: "offline",
          code,
          reason: reason.slice(0, 123),
        },
        attachment,
      );
    }
  }

  webSocketError(socket: WebSocket) {
    try {
      socket.close(1011, "WebSocket error");
    } catch {
      /* no-op */
    }
  }

  async alarm() {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as SocketAttachment | null;
      if (!attachment || attachment.expiresAt <= now) {
        try {
          socket.close(4001, "Identity token expired");
        } catch {
          /* no-op */
        }
      }
    }
    await this.scheduleSocketExpiration();
  }

  private async scheduleSocketExpiration() {
    const next = this.ctx
      .getWebSockets()
      .map(
        (socket) =>
          (socket.deserializeAttachment() as SocketAttachment | null)
            ?.expiresAt,
      )
      .filter(
        (value): value is number =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > Date.now(),
      )
      .sort((left, right) => left - right)[0];
    if (next == null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private migrateSqlStorage() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) version FROM _sql_schema_migrations",
      )
      .one().version;
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS realtime_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          audience TEXT NOT NULL CHECK (audience IN ('all', 'agents')),
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS realtime_events_created_at
          ON realtime_events(created_at, sequence);
        INSERT INTO _sql_schema_migrations (id) VALUES (1);
      `);
    }
  }

  private persistRealtimeEvent(
    payload: unknown,
    audience: "all" | "agents",
    encoded: string,
  ) {
    const record = asObject(payload);
    const eventType = String(record.type || "error").slice(0, 128);
    const eventId = String(record.event_id || crypto.randomUUID());
    this.ctx.storage.sql.exec(
      `INSERT INTO realtime_events (event_id, event_type, audience, payload_json)
       VALUES (?, ?, ?, ?)`,
      eventId,
      eventType,
      audience,
      encoded,
    );
  }
}

function canonicalRealtimeEvent(value: unknown): SupportRealtimeEvent {
  const source = asObject(value);
  const type = realtimeType(source.type);
  const conversationId = boundedIdentifier(source.conversation_id, "conversation_id");
  const base = {
    schema_version: SUPPORT_SCHEMA_VERSION,
    type,
    event_id: boundedIdentifier(source.event_id || crypto.randomUUID(), "event_id"),
    conversation_id: conversationId,
    occurred_at: validIsoTimestamp(source.occurred_at),
  };
  let event: Record<string, unknown>;
  switch (type) {
    case "connected":
      event = {
        ...base,
        ...(typeof source.cursor === "string" ? { cursor: source.cursor.slice(0, 512) } : {}),
      };
      break;
    case "message.created":
    case "message.updated":
      event = { ...base, message: publicMessage(source.message, conversationId) };
      break;
    case "message.deleted":
      event = {
        ...base,
        message_id: boundedIdentifier(source.message_id, "message_id"),
      };
      break;
    case "conversation.updated":
      event = { ...base, conversation: publicConversation(source.conversation, conversationId) };
      break;
    case "typing.started":
    case "typing.stopped": {
      const actor = asObject(source.actor);
      const actorId = optionalIdentifier(source.actor_id ?? actor.id);
      event = {
        ...base,
        actor_kind: publicActorKind(source.actor_kind ?? actor.kind),
        ...(actorId ? { actor_id: actorId } : {}),
      };
      break;
    }
    case "conversation.read": {
      const actor = asObject(source.actor);
      const actorId = optionalIdentifier(source.actor_id ?? actor.id);
      const sequence = optionalSafeInteger(source.sequence);
      event = {
        ...base,
        ...(actorId ? { actor_id: actorId } : {}),
        read_at: validIsoTimestamp(source.read_at),
        ...(sequence == null ? {} : { sequence }),
      };
      break;
    }
    case "delivery.updated":
      event = {
        ...base,
        message_id: boundedIdentifier(source.message_id, "message_id"),
        status: publicDeliveryStatus(source.status),
        ...(typeof source.reason_code === "string"
          ? { reason_code: source.reason_code.slice(0, 255) }
          : {}),
      };
      break;
    case "presence.updated": {
      const actor = asObject(source.actor);
      event = {
        ...base,
        actor_id: boundedIdentifier(source.actor_id ?? actor.id, "actor_id"),
        presence: publicPresence(source.presence ?? source.state),
      };
      break;
    }
    case "assignment.updated":
      event = {
        ...base,
        ...nullableIdentifier("agent_id", source.agent_id),
        ...nullableIdentifier("team_id", source.team_id),
        ...nullableIdentifier("inbox_id", source.inbox_id),
      };
      break;
    case "error": {
      const error = asObject(source.error);
      event = {
        ...base,
        error: {
          code: boundedErrorText(error.code, "realtime_error"),
          message: boundedErrorText(error.message, "Support realtime request failed"),
          retryable: error.retryable === true,
          ...(typeof error.request_id === "string"
            ? { request_id: error.request_id.slice(0, 255) }
            : {}),
          ...(isPlainRecord(error.details) ? { details: error.details } : {}),
        },
      };
      break;
    }
  }
  return parseSupportRealtimeEvent(event);
}

function publicMessage(value: unknown, conversationId: string): SupportMessageDto {
  const source = asObject(value);
  const attachments = parseJsonArray(source.attachments ?? source.attachments_json)
    .slice(0, 50)
    .map(publicAttachment);
  const metadata = parseJsonObject(source.metadata ?? source.metadata_json);
  const body = source.body == null ? undefined : String(source.body).slice(0, 64 * 1024);
  const createdAt = validIsoTimestamp(source.created_at);
  const updatedAt = optionalIsoTimestamp(source.updated_at ?? source.edited_at);
  const deletedAt = optionalIsoTimestamp(source.deleted_at);
  return {
    id: boundedIdentifier(source.id, "message_id"),
    conversation_id: boundedIdentifier(source.conversation_id || conversationId, "conversation_id"),
    ...nullableIdentifier("source_id", source.source_id),
    ...nullableIdentifier("provider_message_id", source.provider_message_id),
    sender_kind: publicMessageSender(source.sender_kind),
    sequence: Math.max(0, optionalSafeInteger(source.sequence) ?? 0),
    ...(body === undefined ? {} : { body }),
    attachments,
    visibility: source.visibility === "private" ? "private" : "public",
    content_type: publicContentType(source.content_type),
    ...nullableIdentifier("reply_to_message_id", source.reply_to_message_id),
    metadata,
    ...(source.delivery_status == null && source.status == null
      ? {}
      : { delivery_status: publicDeliveryStatus(source.delivery_status ?? source.status) }),
    created_at: createdAt,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(source.deleted_at === null
      ? { deleted_at: null }
      : deletedAt
        ? { deleted_at: deletedAt }
        : {}),
  };
}

function publicAttachment(value: unknown, position: number): SupportMessageAttachmentDto {
  const source = asObject(value);
  const byteSize = optionalSafeInteger(source.byte_size);
  return {
    id: boundedIdentifier(source.id || `attachment-${position}`, "attachment_id"),
    file_name: boundedText(source.file_name ?? source.name, "attachment", 255),
    content_type: boundedText(source.content_type, "application/octet-stream", 255),
    ...(byteSize == null ? {} : { byte_size: Math.max(0, byteSize) }),
    position: Math.min(49, Math.max(0, optionalSafeInteger(source.position) ?? position)),
    ...(typeof source.download_url === "string"
      ? { download_url: source.download_url.slice(0, 2_048) }
      : {}),
  };
}

function publicConversation(value: unknown, conversationId: string) {
  const source = asObject(value);
  const displayId = optionalSafeInteger(source.display_id);
  return {
    id: boundedIdentifier(source.id || conversationId, "conversation_id"),
    ...(displayId == null ? {} : { display_id: Math.max(0, displayId) }),
    ...nullableIdentifier("external_id", source.external_id),
    status: ["open", "pending", "closed"].includes(String(source.status))
      ? String(source.status)
      : "open",
    priority: ["low", "normal", "high", "urgent"].includes(String(source.priority))
      ? String(source.priority)
      : "normal",
    unread_count: Math.max(0, optionalSafeInteger(source.unread_count) ?? 0),
    ...(source.subject == null ? {} : { subject: String(source.subject).slice(0, 255) }),
    ...nullableIdentifier("inbox_id", source.inbox_id),
    ...nullableIdentifier("assigned_agent_id", source.assigned_agent_id ?? source.assigned_user_id),
    ...nullableIdentifier("assigned_team_id", source.assigned_team_id),
    custom_attributes: parseJsonObject(source.custom_attributes ?? source.custom_attributes_json),
    ...(source.snoozed_until == null ? {} : { snoozed_until: optionalIsoTimestamp(source.snoozed_until) }),
    ...(source.last_message_preview == null ? {} : { last_message_preview: String(source.last_message_preview).slice(0, 1_000) }),
    ...(optionalIsoTimestamp(source.last_message_at) ? { last_message_at: optionalIsoTimestamp(source.last_message_at) } : {}),
    ...(optionalIsoTimestamp(source.created_at) ? { created_at: optionalIsoTimestamp(source.created_at) } : {}),
    ...(optionalIsoTimestamp(source.updated_at) ? { updated_at: optionalIsoTimestamp(source.updated_at) } : {}),
  };
}

function realtimeType(value: unknown): SupportRealtimeEventType {
  const type = String(value || "");
  const allowed: SupportRealtimeEventType[] = [
    "connected", "message.created", "message.updated", "message.deleted",
    "conversation.updated", "typing.started", "typing.stopped", "conversation.read",
    "delivery.updated", "presence.updated", "assignment.updated", "error",
  ];
  if (!allowed.includes(type as SupportRealtimeEventType)) {
    throw failure("realtime_event_invalid", "Realtime event type is invalid", 500);
  }
  return type as SupportRealtimeEventType;
}

function publicActorKind(value: unknown): "user" | "agent" | "bot" {
  if (value === "user" || value === "agent" || value === "bot") return value;
  return "bot";
}

function publicMessageSender(value: unknown): SupportMessageDto["sender_kind"] {
  if (value === "user" || value === "agent" || value === "system" || value === "bot") return value;
  return "system";
}

function publicPresence(value: unknown): "online" | "away" | "offline" {
  if (value === "online" || value === "away" || value === "offline") return value;
  return "offline";
}

function publicDeliveryStatus(value: unknown): "pending" | "sent" | "delivered" | "read" | "failed" {
  if (value === "sent" || value === "delivered" || value === "read" || value === "failed") return value;
  return value === "cancelled" ? "failed" : "pending";
}

function publicContentType(value: unknown): SupportMessageDto["content_type"] {
  const allowed: SupportMessageDto["content_type"][] = [
    "text", "html", "input_select", "form", "location", "file", "system",
  ];
  return allowed.includes(value as SupportMessageDto["content_type"])
    ? value as SupportMessageDto["content_type"]
    : "text";
}

function boundedIdentifier(value: unknown, field: string): string {
  const result = String(value || "").trim();
  if (!result || result.length > 255) {
    throw failure("realtime_event_invalid", `Realtime ${field} is invalid`, 500);
  }
  return result;
}

function optionalIdentifier(value: unknown): string | null {
  if (value == null || value === "") return null;
  const result = String(value).trim();
  return result && result.length <= 255 ? result : null;
}

function nullableIdentifier(name: string, value: unknown): Record<string, string | null> {
  if (value === null) return { [name]: null };
  const result = optionalIdentifier(value);
  return result ? { [name]: result } : {};
}

function boundedText(value: unknown, fallback: string, maximum: number): string {
  const result = String(value || fallback).trim();
  return (result || fallback).slice(0, maximum);
}

function boundedErrorText(value: unknown, fallback: string): string {
  return boundedText(value, fallback, 1_000);
}

function optionalSafeInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function validIsoTimestamp(value: unknown): string {
  return optionalIsoTimestamp(value) || new Date().toISOString();
}

function optionalIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function publishMessageEvent(
  env: Env,
  conversation: Conversation,
  message: Record<string, unknown>,
) {
  await publishSupportEvent(
    env,
    conversation.project_id,
    String(message.id),
    "message.created",
    {
      message_id: message.id,
      conversation_id: conversation.id,
      sender_kind: message.sender_kind,
      visibility: message.visibility,
      content_type: message.content_type,
      body: message.body,
      attachment_name: message.attachment_name,
      created_at: message.created_at,
    },
  );
}

function messageMatchesInput(
  message: Record<string, unknown>,
  input: ReturnType<typeof parseMessageInput>,
) {
  const storedAttachments = (() => {
    try {
      const parsed = JSON.parse(String(message.attachments_json || "[]"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })() as Array<Record<string, unknown>>;
  const attachmentsMatch = storedAttachments.length === input.attachments.length &&
    storedAttachments.every((stored, index) => {
      const expected = input.attachments[index];
      return String(stored.storage_key || "") === expected?.key &&
        String(stored.file_name || "attachment") === (expected?.name || "attachment") &&
        String(stored.content_type || "application/octet-stream") ===
          (expected?.content_type || "application/octet-stream");
    });
  return (
    (message.body ?? null) === input.body &&
    (message.attachment_key ?? null) === input.attachment_key &&
    (message.attachment_name ?? null) === input.attachment_name &&
    (message.attachment_content_type ?? null) ===
      input.attachment_content_type &&
    (message.visibility ?? "public") === input.visibility &&
    (message.content_type ?? "text") === input.content_type &&
    (message.reply_to_message_id ?? null) === input.reply_to_message_id &&
    String(message.metadata_json ?? "{}") === JSON.stringify(input.metadata) &&
    attachmentsMatch
  );
}

function outboundProviderDeliveryRequested(
  actor: Actor,
  input: ReturnType<typeof parseMessageInput>,
) {
  if (input.visibility !== "public") return false;
  if (actor.kind === "agent") return true;
  return actor.kind === "system" &&
    input.metadata.delivery_pending === true &&
    input.metadata.captain_task_id != null &&
    String(input.metadata.captain_task_id).length <= 255;
}

function idempotencyConflict() {
  return Response.json(
    {
      code: "idempotency_conflict",
      message: "client_message_id was already used with a different payload",
    },
    { status: 409 },
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
