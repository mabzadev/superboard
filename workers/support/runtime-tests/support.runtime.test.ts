import {
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleSupportQueue } from "../src/webhooks";

const secret = "support-runtime-secret";

async function signedRequest(
  path: string,
  projectId: number,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
  role = "owner",
) {
  const context: InternalProjectContext = {
    module: "support",
    method,
    pathname: new URL(path, "https://support.internal").pathname,
    projectId,
    projectRef: projectId === 12 ? "10-test" : "10-prod",
    instanceId: 10,
    environment: projectId === 12 ? "test" : "production",
    actorId: 2,
    role,
    requestId: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const headers = new Headers({
    "content-type": "application/json",
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": "10",
    "x-environment": context.environment,
    "x-actor-id": "2",
    "x-role": role,
    "x-request-id": context.requestId,
    "x-context-issued-at": String(context.issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://support.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Support in the Workers runtime", () => {
  it("reports non-sensitive operational database metrics", async () => {
    const response = await SELF.fetch(
      "https://support.internal/internal/v1/health",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        service: "support",
        status: "ok",
        schema: {
          status: "current",
          expectedMigration: "0009_application_user_erasure.sql",
          latestMigration: "0009_application_user_erasure.sql",
          appliedMigrationCount: 10,
        },
        metrics: {
          conversations: {
            total: expect.any(Number),
            open: expect.any(Number),
          },
          messages: expect.any(Number),
          attachments: expect.any(Number),
          webhooks: { pending: expect.any(Number), failed: expect.any(Number) },
          deadLetters: { quarantined: expect.any(Number) },
        },
      },
    });
  });

  it("durably quarantines terminal queue failures before acknowledging them", async () => {
    const batch = createMessageBatch("support-test-events-dlq", [
      {
        id: "support-dead-letter-1",
        timestamp: new Date(),
        attempts: 9,
        body: {
          type: "support.webhook.dispatch",
          projectId: 12,
          eventId: "support-event-1",
          eventName: "conversation.created",
          payload: { conversation_id: "conversation-1" },
        },
      },
    ]);
    const execution = createExecutionContext();
    await handleSupportQueue(batch, env);
    const result = await getQueueResult(batch, execution);
    expect(result.explicitAcks).toEqual(["support-dead-letter-1"]);
    await expect(
      env.DB.prepare(
        `
      SELECT source_queue, message_id, job_type, replayable, status FROM support_dead_letters
      WHERE message_id = 'support-dead-letter-1'
    `,
      ).first(),
    ).resolves.toMatchObject({
      source_queue: "support-test-events-dlq",
      message_id: "support-dead-letter-1",
      job_type: "support.webhook.dispatch",
      replayable: 1,
      status: "quarantined",
    });
  });

  it("persists isolated conversations and replays idempotent mutations", async () => {
    const payload = {
      external_user_id: "customer-1",
      client_conversation_id: "conversation-client-1",
      subject: "Need help",
    };
    const create = await SELF.fetch(
      await signedRequest(
        "/internal/v1/conversations",
        12,
        "POST",
        payload,
        "create-conversation-1",
      ),
    );
    expect(create.status).toBe(201);
    const created = await create.json<{ data: { id: string } }>();

    const replay = await SELF.fetch(
      await signedRequest(
        "/internal/v1/conversations",
        12,
        "POST",
        payload,
        "create-conversation-1",
      ),
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    await expect(replay.json()).resolves.toMatchObject({
      data: { id: created.data.id },
    });

    const list = await SELF.fetch(
      await signedRequest("/internal/v1/conversations", 12),
    );
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: [{ id: created.data.id, project_id: 12 }],
    });

    const otherProject = await SELF.fetch(
      await signedRequest("/internal/v1/conversations", 11),
    );
    await expect(otherProject.json()).resolves.toEqual({ data: [] });
    await expect(
      env.DB.prepare(
        `
      SELECT COUNT(*) total FROM support_operations_audit_events
      WHERE project_id = 12 AND resource_type = 'request' AND action LIKE 'POST %/conversations'
    `,
      ).first(),
    ).resolves.toMatchObject({ total: 1 });
  });

  it("persists messages and accepts hibernatable WebSockets in the conversation Durable Object", async () => {
    const conversationId = "runtime-room";
    await env.DB.prepare(
      `
      INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject)
      VALUES (?, 12, 'customer-room', 'runtime-room-client', 'Runtime room')
    `,
    )
      .bind(conversationId)
      .run();
    const room = env.CONVERSATIONS.getByName(conversationId);
    const headers = {
      "x-room-capability": secret,
      "x-conversation-id": conversationId,
      "x-actor-id": "agent-1",
      "x-actor-kind": "agent",
      "x-identity-expires-at": String(Date.now() + 60_000),
      "content-type": "application/json",
    };
    const message = await room.fetch(
      new Request("https://room.internal/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          body: "Hello from Support",
          client_message_id: "runtime-message-1",
        }),
      }),
    );
    expect(message.status).toBe(201);
    await expect(message.json()).resolves.toMatchObject({
      data: { sequence: 1, body: "Hello from Support" },
    });

    const attachmentKey = `attachments/12/runtime/${conversationId}/proof.txt`;
    await env.ATTACHMENTS.put(attachmentKey, "attachment proof", {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { conversationId, uploadedBy: "runtime-test" },
    });
    const attachmentMessage = await room.fetch(
      new Request("https://room.internal/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          attachment_key: attachmentKey,
          attachment_name: "proof.txt",
          attachment_content_type: "text/plain",
          client_message_id: "runtime-message-2",
        }),
      }),
    );
    expect(attachmentMessage.status).toBe(201);
    const attachmentPayload = await attachmentMessage.json<{
      data: { id: string; attachments_json: string };
    }>();
    expect(JSON.parse(attachmentPayload.data.attachments_json)).toHaveLength(1);
    const storedAttachments = await env.DB.prepare(
      `
      SELECT id, storage_key FROM support_message_attachments WHERE message_id = ?
    `,
    )
      .bind(attachmentPayload.data.id)
      .all();
    expect(storedAttachments.results).toHaveLength(1);

    const history = await SELF.fetch(
      await signedRequest(
        `/internal/v1/conversations/${conversationId}/messages`,
        12,
      ),
    );
    const historyPayload = await history.json<{
      data: Array<{ id: string; attachments_json: string }>;
    }>();
    const migratedShape = historyPayload.data.find(
      (item) => item.id === attachmentPayload.data.id,
    );
    expect(JSON.parse(migratedShape?.attachments_json || "[]")).toHaveLength(1);

    const attachmentId = String(storedAttachments.results[0]?.id);
    const download = await SELF.fetch(
      await signedRequest(
        `/internal/v1/conversations/${conversationId}/attachments/${attachmentPayload.data.id}?attachment_id=${encodeURIComponent(attachmentId)}`,
        12,
      ),
    );
    expect(download.status).toBe(200);
    await expect(download.text()).resolves.toBe("attachment proof");

    const websocket = await room.fetch(
      new Request("https://room.internal/connect", {
        headers: { ...headers, upgrade: "websocket" },
      }),
    );
    expect(websocket.status).toBe(101);
    expect(websocket.webSocket).not.toBeNull();
    websocket.webSocket?.accept();
    websocket.webSocket?.close(1000, "test complete");
  });

  it("closes realtime state and erases one application user's support data", async () => {
    const subject = "support-erasure-user";
    const createdResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/conversations",
        12,
        "POST",
        {
          external_user_id: subject,
          client_conversation_id: "support-erasure-conversation",
          subject: "Erase this conversation",
        },
        "support-erasure-create",
      ),
    );
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{ data: { id: string } }>();
    const attachmentKey = `attachments/12/erasure/${created.data.id}/private.txt`;
    await env.ATTACHMENTS.put(attachmentKey, "private support attachment", {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: {
        conversationId: created.data.id,
        uploadedBy: subject,
      },
    });
    const room = env.CONVERSATIONS.getByName(created.data.id);
    const message = await room.fetch(
      new Request("https://room.internal/messages", {
        method: "POST",
        headers: {
          "x-room-capability": secret,
          "x-conversation-id": created.data.id,
          "x-actor-id": subject,
          "x-actor-kind": "user",
          "x-identity-expires-at": String(Date.now() + 60_000),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          attachment_key: attachmentKey,
          attachment_name: "private.txt",
          attachment_content_type: "text/plain",
          client_message_id: "support-erasure-message",
        }),
      }),
    );
    expect(message.status).toBe(201);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) total FROM support_contacts WHERE project_id = 12 AND external_user_id = ?",
      )
        .bind(subject)
        .first(),
    ).resolves.toMatchObject({ total: 1 });

    const erased = await SELF.fetch(
      await signedRequest(
        `/internal/v1/application/users/${subject}`,
        12,
        "DELETE",
        undefined,
        "support-erasure-delete",
        "application",
      ),
    );
    expect(erased.status, await erased.clone().text()).toBe(200);
    await expect(erased.json()).resolves.toMatchObject({
      data: {
        erased: true,
        conversations_deleted: 1,
        contacts_deleted: 1,
        attachments_deleted: 1,
        audit_events_redacted: expect.any(Number),
      },
    });
    const replay = await SELF.fetch(
      await signedRequest(
        `/internal/v1/application/users/${subject}`,
        12,
        "DELETE",
        undefined,
        "support-erasure-delete",
        "application",
      ),
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");

    expect(await env.ATTACHMENTS.head(attachmentKey)).toBeNull();
    const [conversations, contacts, audit] = await env.DB.batch([
      env.DB.prepare(
        "SELECT COUNT(*) total FROM conversations WHERE project_id = 12 AND external_user_id = ?",
      ).bind(subject),
      env.DB.prepare(
        "SELECT COUNT(*) total FROM support_contacts WHERE project_id = 12 AND external_user_id = ?",
      ).bind(subject),
      env.DB.prepare(
        `SELECT conversation_id, actor_id, payload_json
         FROM support_audit_events
         WHERE project_id = 12 AND actor_kind = 'user' AND actor_id LIKE 'erased:%'
         ORDER BY created_at DESC LIMIT 1`,
      ),
    ]);
    expect(conversations.results[0]).toMatchObject({ total: 0 });
    expect(contacts.results[0]).toMatchObject({ total: 0 });
    expect(audit.results[0]).toMatchObject({
      conversation_id: null,
      actor_id: expect.stringMatching(/^erased:[a-f0-9]{32}$/u),
      payload_json: "{}",
    });
  });

  it("encrypts and rotates webhook secrets without exposing them", async () => {
    const created = await SELF.fetch(
      await signedRequest(
        "/internal/v1/settings/entities",
        12,
        "POST",
        {
          entity_type: "webhook",
          name: "Customer events",
          enabled: true,
          configuration: {
            url: "https://hooks.example.com/support",
            events: ["conversation.created"],
          },
        },
        "webhook-create-1",
      ),
    );
    expect(created.status).toBe(201);
    const entity = await created.json<{
      data: { id: string; secret_configured: boolean };
    }>();
    expect(entity.data.secret_configured).toBe(false);

    const configured = await SELF.fetch(
      await signedRequest(
        `/internal/v1/settings/entities/${entity.data.id}/secret`,
        12,
        "PUT",
        { secret: "support-webhook-private-value" },
        "webhook-secret-1",
      ),
    );
    expect(configured.status).toBe(200);
    await expect(configured.text()).resolves.not.toContain(
      "support-webhook-private-value",
    );
    const stored = await env.DB.prepare(
      `SELECT encrypted_secret, secret_version FROM support_webhook_secrets WHERE webhook_id = ?`,
    )
      .bind(entity.data.id)
      .first<{ encrypted_secret: string; secret_version: number }>();
    expect(stored?.encrypted_secret).not.toContain(
      "support-webhook-private-value",
    );
    expect(stored?.secret_version).toBe(1);

    const rotated = await SELF.fetch(
      await signedRequest(
        `/internal/v1/settings/entities/${entity.data.id}/secret`,
        12,
        "PUT",
        { secret: "support-webhook-rotated-value" },
        "webhook-secret-2",
      ),
    );
    await expect(rotated.json()).resolves.toMatchObject({
      data: { secret_configured: true, secret_version: 2 },
    });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) total FROM support_secret_audit_events WHERE webhook_id = ?`,
      )
        .bind(entity.data.id)
        .first(),
    ).resolves.toMatchObject({ total: 2 });
  });

  it("forbids members from changing configuration but allows Inbox operations", async () => {
    const forbidden = await SELF.fetch(
      await signedRequest(
        "/internal/v1/settings/entities",
        12,
        "POST",
        {
          entity_type: "label",
          name: "Private",
          configuration: { color: "#111111" },
        },
        "member-config-1",
        "member",
      ),
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "role_insufficient" },
    });

    const operational = await SELF.fetch(
      await signedRequest(
        "/internal/v1/conversations",
        12,
        "POST",
        {
          external_user_id: "member-customer",
          client_conversation_id: "member-operation",
          subject: "Allowed",
        },
        "member-operation-1",
        "member",
      ),
    );
    expect(operational.status).toBe(201);
  });

  it("projects Unified Inbox items and exchanges a one-use signed realtime ticket for a WebSocket", async () => {
    const conversationId = crypto.randomUUID();
    await env.DB.prepare(
      `
      INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, status, priority, last_message_preview)
      VALUES (?, 12, 'realtime-customer', ?, 'Realtime help', 'open', 'high', 'Waiting for an agent')
    `,
    )
      .bind(conversationId, `client-${conversationId}`)
      .run();
    const items = await SELF.fetch(
      await signedRequest(
        "/internal/v1/items?type=conversation&status=open",
        12,
      ),
    );
    expect(items.status).toBe(200);
    const projected = await items.json<{
      data: Array<Record<string, unknown>>;
      degraded_sources: unknown[];
      projection: boolean;
    }>();
    expect(projected.degraded_sources).toEqual([]);
    expect(projected.projection).toBe(true);
    expect(
      projected.data.find((item) => item.source_id === conversationId),
    ).toMatchObject({
      id: `conversation:${conversationId}`,
      source_type: "conversation",
      source_id: conversationId,
      status: "open",
      priority: "high",
      destination: `/support/inbox?type=conversation&id=${conversationId}`,
    });

    const issued = await SELF.fetch(
      await signedRequest(
        `/internal/v1/conversations/${conversationId}/realtime-ticket`,
        12,
        "POST",
        {},
        "realtime-ticket-1",
      ),
    );
    expect(issued.status).toBe(201);
    const ticketBody = await issued.json<{
      data: { ticket: string; expires_at: string };
    }>();
    expect(ticketBody.data.ticket).toContain(".");
    const connected = await SELF.fetch(
      new Request(
        `https://support.internal/public/v1/realtime/${encodeURIComponent(ticketBody.data.ticket)}`,
        { headers: { upgrade: "websocket" } },
      ),
    );
    expect(connected.status).toBe(101);
    expect(connected.webSocket).not.toBeNull();
    connected.webSocket?.accept();
    connected.webSocket?.close(1000, "test complete");

    const replayed = await SELF.fetch(
      new Request(
        `https://support.internal/public/v1/realtime/${encodeURIComponent(ticketBody.data.ticket)}`,
        { headers: { upgrade: "websocket" } },
      ),
    );
    expect(replayed.status).toBe(401);
  });
});
