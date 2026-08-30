import {
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleSupportQueue } from "../src/webhooks";
import { parseSupportRealtimeEvent } from "@superboard/contracts/support";
import { encryptCredentialPayload } from "../src/secrets";

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

async function signedWidgetRequest(options: {
  path: string;
  widgetKey: string;
  signingSecret: string;
  visitor: string;
  projectReference?: string;
  origin?: string;
  body?: string;
  idempotencyKey?: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const projectReference = options.projectReference ?? "12";
  const body = options.body ?? "{}";
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const canonical = [
    String(timestamp),
    "POST",
    `/api/v1/support-widget${options.path}`,
    projectReference,
    options.visitor,
    idempotencyKey,
    await sha256Hex(body),
  ].join("\n");
  const signature = await hmacHex(options.signingSecret, canonical);
  return new Request(`https://support.internal/public/v1/widget${options.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "origin": options.origin ?? "https://support.example.test",
      "x-superboard-project-id": projectReference,
      "x-superboard-widget-key": options.widgetKey,
      "x-superboard-widget-visitor": options.visitor,
      "x-superboard-widget-signature": signature,
      "x-superboard-widget-timestamp": String(timestamp),
    },
    body,
  });
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(secretValue: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretValue),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return [...signature]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("Support in the Workers runtime", () => {
  it("promotes a configured provider only after a signed inbound event", async () => {
    const endpointId = crypto.randomUUID();
    const providerSecret = `provider-secret-${crypto.randomUUID()}`;
    const credentials = await encryptCredentialPayload(
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
      { app_secret: providerSecret, verify_token: "runtime-verify-token" },
    );
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_provider_endpoints
        (id, project_id, provider, display_name, status, settings_json)
        VALUES (?, 12, 'whatsapp_cloud', ?, 'configured', '{}')`)
        .bind(endpointId, `Runtime signed inbound ${endpointId}`),
      env.DB.prepare(`INSERT INTO support_provider_credentials
        (endpoint_id, project_id, encrypted_payload)
        VALUES (?, 12, ?)`)
        .bind(endpointId, credentials),
    ]);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "123456", changes: [{ field: "messages", value: {
        messages: [{ id: `wamid.${endpointId}`, from: "41790000000", type: "text", text: { body: "Need help" } }],
      } }] }],
    });
    const invalid = await SELF.fetch(new Request(
      `https://support.internal/public/v1/providers/whatsapp_cloud/${endpointId}/events`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=invalid" },
        body,
      },
    ));
    expect(invalid.status).toBe(401);
    await expect(env.DB.prepare(`SELECT status FROM support_provider_endpoints WHERE id = ?`)
      .bind(endpointId).first()).resolves.toMatchObject({ status: "configured" });

    const accepted = await SELF.fetch(new Request(
      `https://support.internal/public/v1/providers/whatsapp_cloud/${endpointId}/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${await hmacHex(providerSecret, body)}`,
        },
        body,
      },
    ));
    expect(accepted.status).toBe(202);
    await expect(env.DB.prepare(`SELECT status, last_validated_at, last_event_at, last_error_code
      FROM support_provider_endpoints WHERE id = ?`).bind(endpointId).first()).resolves.toMatchObject({
      status: "live_validated",
      last_validated_at: expect.any(String),
      last_event_at: expect.any(String),
      last_error_code: null,
    });
  });

  it("manages native notification preferences, unread state, snooze, and deletion", async () => {
    const membershipId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO support_memberships
        (id, project_id, auth_user_id, display_name, role, availability, active)
      VALUES (?, 12, '2', 'Notification agent', 'agent', 'online', 1)
      ON CONFLICT(project_id, auth_user_id) DO UPDATE SET active = 1
    `).bind(membershipId).run();

    const preferences = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications/preferences",
      12,
      "PUT",
      {
        email_enabled: false,
        push_enabled: true,
        browser_enabled: true,
        in_app_enabled: true,
        audio_enabled: false,
        muted_event_types: ["conversation.read"],
      },
      "notifications-preferences-1",
    ));
    expect(preferences.status).toBe(200);
    await expect(preferences.json()).resolves.toMatchObject({
      data: {
        email_enabled: false,
        push_enabled: true,
        audio_enabled: false,
        muted_event_types: ["conversation.read"],
      },
    });

    const created = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications",
      12,
      "POST",
      {
        agent_id: "2",
        notification_type: "conversation.assigned",
        title: "New conversation",
        body: "A conversation requires attention",
        payload: { safe_reference: "notification-test" },
      },
      "notification-create-1",
    ));
    expect(created.status).toBe(201);
    const createdBody = await created.json<{ data: { id: string } }>();

    const unread = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications/unread-count",
      12,
    ));
    await expect(unread.json()).resolves.toMatchObject({ data: { unread_count: 1 } });

    const snoozed = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/notifications/${createdBody.data.id}/snooze`,
      12,
      "PATCH",
      { snoozed_until: new Date(Date.now() + 60_000).toISOString() },
      "notification-snooze-1",
    ));
    expect(snoozed.status).toBe(200);
    const hidden = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications?unread=true",
      12,
    ));
    await expect(hidden.json()).resolves.toMatchObject({ data: [] });

    const unsnoozed = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/notifications/${createdBody.data.id}/snooze`,
      12,
      "PATCH",
      { snoozed_until: null },
      "notification-unsnooze-1",
    ));
    expect(unsnoozed.status).toBe(200);
    const readAll = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications/read-all",
      12,
      "POST",
      {},
      "notification-read-all-1",
    ));
    await expect(readAll.json()).resolves.toMatchObject({ data: { updated: 1 } });

    const deleted = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/notifications/${createdBody.data.id}`,
      12,
      "DELETE",
      {},
      "notification-delete-1",
    ));
    expect(deleted.status).toBe(200);
    const visible = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/notifications",
      12,
    ));
    await expect(visible.json()).resolves.toMatchObject({ data: [] });
  });

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
          expectedMigration: "0023_support_integration_oauth.sql",
          latestMigration: "0023_support_integration_oauth.sql",
          appliedMigrationCount: 24,
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
    const listed = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/settings/operations/dead-letters",
      12,
    ));
    expect(listed.status).toBe(200);
    const listedBody = await listed.json<{ data: Array<{ id: string; message_id: string }> }>();
    const deadLetter = listedBody.data.find((item) => item.message_id === "support-dead-letter-1");
    expect(deadLetter?.id).toBeTruthy();

    const replayed = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/settings/operations/dead-letters/${deadLetter?.id}/replay`,
      12,
      "POST",
      {},
      "dead-letter-replay-1",
    ));
    expect(replayed.status).toBe(202);
    await expect(env.DB.prepare(`SELECT status FROM support_dead_letters WHERE id = ?`)
      .bind(deadLetter?.id).first()).resolves.toMatchObject({ status: "discarded" });
    await expect(env.DB.prepare(`SELECT action FROM support_operations_audit_events
      WHERE project_id = 12 AND resource_type = 'dead_letter' AND resource_id = ?`)
      .bind(deadLetter?.id).first()).resolves.toMatchObject({ action: "replayed" });
  });

  it("dispatches proactive Support idempotently and applies provider acknowledgements", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `proactive-inbox-${suffix}`;
    const contactId = `proactive-contact-${suffix}`;
    const endpointId = `proactive-endpoint-${suffix}`;
    const campaignId = `proactive-campaign-${suffix}`;
    const externalUserId = `4179${suffix.replace(/-/gu, "").slice(0, 8)}`;
    const credentials = await encryptCredentialPayload(
      "support-runtime-credential-encryption-key",
      { access_token: "runtime-token", phone_number_id: "runtime-phone" },
    );
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, 'Proactive runtime', ?, 'whatsapp_cloud')`)
        .bind(inboxId, `proactive-${suffix}`),
      env.DB.prepare(`INSERT INTO support_contacts
        (id, project_id, external_user_id, name, phone)
        VALUES (?, 12, ?, 'Proactive customer', ?)`)
        .bind(contactId, externalUserId, `+${externalUserId}`),
      env.DB.prepare(`INSERT INTO support_provider_endpoints
        (id, project_id, inbox_id, provider, display_name, status, settings_json)
        VALUES (?, 12, ?, 'whatsapp_cloud', ?, 'validated', '{}')`)
        .bind(endpointId, inboxId, `WhatsApp ${suffix}`),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_contact_inboxes
        (id, project_id, contact_id, inbox_id, source_id, verified)
        VALUES (?, 12, ?, ?, ?, 1)`)
        .bind(crypto.randomUUID(), contactId, inboxId, externalUserId),
      env.DB.prepare(`INSERT INTO support_provider_credentials
        (endpoint_id, project_id, encrypted_payload)
        VALUES (?, 12, ?)`)
        .bind(endpointId, credentials),
      env.DB.prepare(`INSERT INTO support_campaigns
        (id, project_id, inbox_id, name, campaign_type, message, audience_json,
         status, created_by)
        VALUES (?, 12, ?, ?, 'one_off', 'A proactive Support update', ?, 'running', '2')`)
        .bind(
          campaignId,
          inboxId,
          `Runtime campaign ${suffix}`,
          JSON.stringify({ external_user_id: externalUserId }),
        ),
    ]);

    const dispatch = () => createMessageBatch("support-test-bulk", [{
      id: `campaign-job-${crypto.randomUUID()}`,
      timestamp: new Date(),
      attempts: 1,
      body: {
        type: "support.campaign.dispatch.v1",
        projectId: 12,
        campaignId,
      },
    }]);
    const firstBatch = dispatch();
    await handleSupportQueue(firstBatch, env);
    expect((await getQueueResult(firstBatch, createExecutionContext())).explicitAcks)
      .toEqual([firstBatch.messages[0].id]);
    const replayBatch = dispatch();
    await handleSupportQueue(replayBatch, env);
    expect((await getQueueResult(replayBatch, createExecutionContext())).explicitAcks)
      .toEqual([replayBatch.messages[0].id]);

    const state = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM conversations WHERE project_id = 12 AND inbox_id = ?) conversations,
      (SELECT COUNT(*) FROM messages message
       INNER JOIN conversations conversation ON conversation.id = message.conversation_id
       WHERE conversation.project_id = 12 AND conversation.inbox_id = ?
         AND message.sender_kind = 'system' AND message.body = 'A proactive Support update') messages,
      (SELECT COUNT(*) FROM support_campaign_deliveries
       WHERE project_id = 12 AND campaign_id = ?) campaign_deliveries,
      (SELECT COUNT(*) FROM support_provider_deliveries
       WHERE project_id = 12 AND endpoint_id = ?) provider_deliveries
    `).bind(inboxId, inboxId, campaignId, endpointId).first<{
      conversations: number;
      messages: number;
      campaign_deliveries: number;
      provider_deliveries: number;
    }>();
    expect(state).toEqual({
      conversations: 1,
      messages: 1,
      campaign_deliveries: 1,
      provider_deliveries: 1,
    });
    const providerDelivery = await env.DB.prepare(`
      SELECT id, conversation_id, message_id FROM support_provider_deliveries
      WHERE project_id = 12 AND endpoint_id = ?
    `).bind(endpointId).first<{ id: string; conversation_id: string; message_id: string }>();
    expect(providerDelivery).toBeTruthy();
    await expect(env.DB.prepare(`SELECT delivery_status FROM messages WHERE id = ?`)
      .bind(providerDelivery?.message_id).first()).resolves.toMatchObject({ delivery_status: "pending" });

    await env.DB.prepare(`UPDATE support_provider_deliveries
      SET status = 'sent', provider_reference = 'wamid.runtime.outbound' WHERE id = ?`)
      .bind(providerDelivery?.id).run();
    const providerEventId = `provider-event-${suffix}`;
    await env.DB.prepare(`INSERT INTO support_provider_events
      (id, project_id, endpoint_id, provider, provider_event_id, event_type,
       payload_json, received_at)
      VALUES (?, 12, ?, 'whatsapp_cloud', ?, 'delivery.updated', ?, ?)`)
      .bind(
        providerEventId,
        endpointId,
        providerEventId,
        JSON.stringify({ entry: [{ changes: [{ value: { statuses: [
          { id: "wamid.runtime.outbound", status: "delivered" },
        ] } }] }] }),
        new Date().toISOString(),
      ).run();
    const receiptBatch = createMessageBatch("support-test-events", [{
      id: `receipt-job-${suffix}`,
      timestamp: new Date(),
      attempts: 1,
      body: {
        type: "support.provider.event.received.v1",
        projectId: 12,
        endpointId,
        provider: "whatsapp_cloud",
        eventRecordId: providerEventId,
      },
    }]);
    await handleSupportQueue(receiptBatch, env);
    expect((await getQueueResult(receiptBatch, createExecutionContext())).explicitAcks)
      .toEqual([receiptBatch.messages[0].id]);
    await expect(env.DB.prepare(`SELECT status FROM support_provider_deliveries WHERE id = ?`)
      .bind(providerDelivery?.id).first()).resolves.toMatchObject({ status: "delivered" });
    await expect(env.DB.prepare(`SELECT delivery_status FROM messages WHERE id = ?`)
      .bind(providerDelivery?.message_id).first()).resolves.toMatchObject({ delivery_status: "delivered" });
    await expect(env.DB.prepare(`SELECT status FROM support_campaigns WHERE id = ?`)
      .bind(campaignId).first()).resolves.toMatchObject({ status: "completed" });
    const room = env.CONVERSATIONS.getByName(String(providerDelivery?.conversation_id));
    await runInDurableObject(room, async (_instance, durableState) => {
      const events = durableState.storage.sql
        .exec<{ event_type: string }>("SELECT event_type FROM realtime_events ORDER BY sequence")
        .toArray();
      expect(events.map((event) => event.event_type)).toContain("delivery.updated");
    });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM support_campaigns WHERE id = ?").bind(campaignId),
      env.DB.prepare("DELETE FROM support_provider_endpoints WHERE id = ?").bind(endpointId),
      env.DB.prepare("DELETE FROM conversations WHERE project_id = 12 AND inbox_id = ?").bind(inboxId),
      env.DB.prepare("DELETE FROM support_contacts WHERE id = ?").bind(contactId),
      env.DB.prepare("DELETE FROM support_inboxes WHERE id = ?").bind(inboxId),
    ]);
  });

  it("routes real provider messages through automations and persisted realtime", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `inbound-inbox-${suffix}`;
    const endpointId = `inbound-endpoint-${suffix}`;
    const eventId = `inbound-event-${suffix}`;
    const sender = `4178${suffix.replace(/-/gu, "").slice(0, 8)}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, 'Inbound runtime', ?, 'whatsapp_cloud')`)
        .bind(inboxId, `inbound-${suffix}`),
      env.DB.prepare(`INSERT INTO support_provider_endpoints
        (id, project_id, inbox_id, provider, display_name, status, settings_json)
        VALUES (?, 12, ?, 'whatsapp_cloud', ?, 'validated', '{}')`)
        .bind(endpointId, inboxId, `Inbound WhatsApp ${suffix}`),
      env.DB.prepare(`INSERT INTO support_automation_rules
        (id, project_id, name, event_name, conditions_json, actions_json, created_by)
        VALUES (?, 12, ?, 'message_created', ?, ?, '2')`)
        .bind(
          crypto.randomUUID(),
          `Inbound priority ${suffix}`,
          JSON.stringify([{ field: "sender_kind", operator: "equals", value: "user" }]),
          JSON.stringify([{ type: "set_priority", value: "urgent" }]),
        ),
    ]);
    await env.DB.prepare(`INSERT INTO support_provider_events
      (id, project_id, endpoint_id, provider, provider_event_id, event_type,
       payload_json, received_at)
      VALUES (?, 12, ?, 'whatsapp_cloud', ?, 'message.created', ?, ?)`)
      .bind(
        eventId,
        endpointId,
        eventId,
        JSON.stringify({ entry: [{ changes: [{ value: {
          contacts: [{ wa_id: sender, profile: { name: "Runtime customer" } }],
          messages: [{ id: `wamid.${suffix}`, from: sender, text: { body: "Please help" } }],
        } }] }] }),
        new Date().toISOString(),
      ).run();
    const batch = createMessageBatch("support-test-events", [{
      id: `inbound-job-${suffix}`,
      timestamp: new Date(),
      attempts: 1,
      body: {
        type: "support.provider.event.received.v1",
        projectId: 12,
        endpointId,
        provider: "whatsapp_cloud",
        eventRecordId: eventId,
      },
    }]);
    await handleSupportQueue(batch, env);
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks)
      .toEqual([batch.messages[0].id]);
    const conversation = await env.DB.prepare(`SELECT id, priority FROM conversations
      WHERE project_id = 12 AND inbox_id = ? AND external_user_id = ?`)
      .bind(inboxId, sender).first<{ id: string; priority: string }>();
    expect(conversation).toMatchObject({ priority: "urgent" });
    await expect(env.DB.prepare(`SELECT status FROM support_provider_events WHERE id = ?`)
      .bind(eventId).first()).resolves.toMatchObject({ status: "processed" });
    await expect(env.DB.prepare(`SELECT sender_kind, body FROM messages WHERE conversation_id = ?`)
      .bind(conversation?.id).first()).resolves.toMatchObject({
      sender_kind: "user",
      body: "Please help",
    });
    const room = env.CONVERSATIONS.getByName(String(conversation?.id));
    await runInDurableObject(room, async (_instance, durableState) => {
      const events = durableState.storage.sql
        .exec<{ event_type: string }>("SELECT event_type FROM realtime_events ORDER BY sequence")
        .toArray();
      expect(events.map((event) => event.event_type)).toContain("message.created");
    });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM support_automation_rules WHERE project_id = 12 AND name = ?")
        .bind(`Inbound priority ${suffix}`),
      env.DB.prepare("DELETE FROM support_provider_endpoints WHERE id = ?").bind(endpointId),
      env.DB.prepare("DELETE FROM conversations WHERE project_id = 12 AND inbox_id = ?").bind(inboxId),
      env.DB.prepare("DELETE FROM support_contacts WHERE project_id = 12 AND external_user_id = ?").bind(sender),
      env.DB.prepare("DELETE FROM support_inboxes WHERE id = ?").bind(inboxId),
    ]);
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
    await expect(otherProject.json()).resolves.toMatchObject({ data: [] });
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
      data: { id: string; attachments: unknown[] };
    }>();
    expect(attachmentPayload.data.attachments).toHaveLength(1);
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
    await runInDurableObject(room, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ id: number }>(
            "SELECT id FROM _sql_schema_migrations ORDER BY id",
          )
          .toArray(),
      ).toEqual([{ id: 1 }]);
      const events = state.storage.sql
        .exec<{ event_type: string; payload_json: string }>(
          "SELECT event_type, payload_json FROM realtime_events ORDER BY sequence",
        )
        .toArray();
      expect(events.map((event) => event.event_type)).toContain(
        "message.created",
      );
      expect(events.map((event) => event.event_type)).toContain(
        "presence.updated",
      );
      for (const event of events) {
        expect(() =>
          parseSupportRealtimeEvent(JSON.parse(event.payload_json)),
        ).not.toThrow();
        expect(event.payload_json).not.toContain("attachments_json");
        expect(event.payload_json).not.toContain("metadata_json");
        expect(event.payload_json).not.toContain("storage_key");
      }
    });
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
    await env.DB.prepare(`
      INSERT OR REPLACE INTO support_memberships
        (id, project_id, auth_user_id, display_name, role, availability, active)
      VALUES ('member-2', 12, '2', 'Support Agent', 'agent', 'online', 1)
    `).run();
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
      error: { code: "support_role_insufficient" },
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

  it("manages contacts and companies with bounded cursor pagination and project isolation", async () => {
    const companyCreate = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/companies",
        12,
        "POST",
        {
          name: "Northwind Support",
          domain: "northwind.example",
          description: "Priority account",
          custom_attributes: { tier: "enterprise" },
        },
        "operations-company-create-1",
      ),
    );
    expect(companyCreate.status).toBe(201);
    const company = await companyCreate.json<{ data: { id: string } }>();
    expect(company.data.id).toMatch(/^[0-9a-f-]{36}$/u);

    const contacts: string[] = [];
    for (const suffix of ["a", "b", "c"]) {
      const response = await SELF.fetch(
        await signedRequest(
          "/internal/v1/projects/12/contacts",
          12,
          "POST",
          {
            external_user_id: `cursor-contact-${suffix}`,
            name: `Cursor ${suffix.toUpperCase()}`,
            email: `cursor-${suffix}@example.test`,
            company_id: company.data.id,
            avatar_url: `https://cdn.example.test/avatars/${suffix}.png`,
          },
          `operations-contact-create-${suffix}`,
        ),
      );
      expect(response.status).toBe(201);
      contacts.push((await response.json<{ data: { id: string } }>()).data.id);
    }

    const firstPage = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts?q=Cursor&limit=2",
        12,
      ),
    );
    expect(firstPage.status).toBe(200);
    const first = await firstPage.json<{
      data: Array<{ id: string; avatar_url: string }>;
      pagination: { has_more: boolean; next_cursor: string };
    }>();
    expect(first.data).toHaveLength(2);
    expect(first.pagination.has_more).toBe(true);
    expect(first.data[0].avatar_url).toMatch(/^https:\/\//u);

    const secondPage = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts?q=Cursor&limit=2&cursor=${encodeURIComponent(first.pagination.next_cursor)}`,
        12,
      ),
    );
    const second = await secondPage.json<{
      data: Array<{ id: string }>;
      pagination: { has_more: boolean };
    }>();
    expect(second.data.length).toBeGreaterThan(0);
    expect(second.data.map((item) => item.id)).not.toContain(first.data[0].id);
    expect(second.data.map((item) => item.id)).not.toContain(first.data[1].id);

    const tooLarge = await SELF.fetch(
      await signedRequest("/internal/v1/projects/12/contacts?limit=101", 12),
    );
    expect(tooLarge.status).toBe(422);
    await expect(tooLarge.json()).resolves.toMatchObject({
      error: { code: "limit_invalid" },
    });

    const companySearch = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/companies?q=northwind&limit=1",
        12,
      ),
    );
    await expect(companySearch.json()).resolves.toMatchObject({
      data: [{ id: company.data.id, contact_count: 3 }],
      pagination: { limit: 1 },
    });
    const isolated = await SELF.fetch(
      await signedRequest("/internal/v1/projects/11/companies?q=northwind", 11),
    );
    await expect(isolated.json()).resolves.toMatchObject({ data: [] });

    const update = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/companies/${company.data.id}`,
        12,
        "PATCH",
        { description: "Updated priority account" },
        "operations-company-update-1",
      ),
    );
    await expect(update.json()).resolves.toMatchObject({
      data: { description: "Updated priority account" },
    });
    const detail = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/companies/${company.data.id}`,
        12,
      ),
    );
    const companyDetail = await detail.json<{
      data: { id: string; contact_count: number; contacts: Array<{ id: string }> };
    }>();
    expect(companyDetail.data).toMatchObject({
      id: company.data.id,
      contact_count: 3,
    });
    expect(companyDetail.data.contacts.map((item) => item.id)).toContain(contacts[0]);

    const remove = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/companies/${company.data.id}`,
        12,
        "DELETE",
        undefined,
        "operations-company-delete-1",
      ),
    );
    await expect(remove.json()).resolves.toMatchObject({
      data: { deleted: true, detached_contacts: 3 },
    });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) total FROM support_contacts
         WHERE project_id = 12 AND id IN (?, ?, ?) AND company_id IS NULL`,
      )
        .bind(...contacts)
        .first(),
    ).resolves.toMatchObject({ total: 3 });

    const deleteContact = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/${contacts[0]}`,
        12,
        "DELETE",
        undefined,
        "operations-contact-delete-1",
      ),
    );
    await expect(deleteContact.json()).resolves.toMatchObject({
      data: { id: contacts[0], deleted: true },
    });
    await expect(
      env.DB.prepare(`SELECT COUNT(*) total FROM support_contacts WHERE project_id = 12 AND id = ?`)
        .bind(contacts[0])
        .first(),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("merges contacts idempotently while preserving labels, inbox identities and audit history", async () => {
    const inboxId = crypto.randomUUID();
    const labelId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, 'Contact Inbox', ?, 'api')`).bind(inboxId, `contact-${inboxId}`),
      env.DB.prepare(`INSERT INTO support_labels
        (id, project_id, name, color) VALUES (?, 12, ?, '#2563eb')`)
        .bind(labelId, `Priority ${labelId}`),
    ]);
    const sourceResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts",
        12,
        "POST",
        {
          external_user_id: `merge-source-${crypto.randomUUID()}`,
          name: "Merge Source",
          email: `merge-source-${crypto.randomUUID()}@example.test`,
        },
        `contact-source-${crypto.randomUUID()}`,
      ),
    );
    const targetResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts",
        12,
        "POST",
        { external_user_id: `merge-target-${crypto.randomUUID()}`, name: "Merge Target" },
        `contact-target-${crypto.randomUUID()}`,
      ),
    );
    const source = await sourceResponse.json<{ data: { id: string; external_user_id: string } }>();
    const target = await targetResponse.json<{ data: { id: string; external_user_id: string } }>();
    const sourceRecord = await env.DB.prepare(`SELECT email FROM support_contacts WHERE id = ?`)
      .bind(source.data.id)
      .first<{ email: string }>();
    const labelsResponse = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/${source.data.id}/labels`,
        12,
        "PUT",
        { label_ids: [labelId] },
        `contact-labels-${crypto.randomUUID()}`,
      ),
    );
    expect(labelsResponse.status).toBe(200);
    await expect(labelsResponse.json()).resolves.toMatchObject({
      data: [{ id: labelId }],
    });
    const inboxResponse = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/${source.data.id}/inboxes`,
        12,
        "POST",
        {
          inbox_id: inboxId,
          source_id: `identity-${crypto.randomUUID()}`,
          verified: true,
          metadata: { locale: "fr-CH" },
        },
        `contact-inbox-${crypto.randomUUID()}`,
      ),
    );
    expect(inboxResponse.status).toBe(201);
    await expect(inboxResponse.json()).resolves.toMatchObject({
      data: { inbox_id: inboxId, verified: true, metadata: { locale: "fr-CH" } },
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_contact_notes
        (id, project_id, contact_id, content, created_by)
        VALUES (?, 12, ?, 'Keep this note', '2')`).bind(
        crypto.randomUUID(),
        source.data.id,
      ),
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject)
        VALUES (?, 12, ?, ?, 'Merged contact conversation')`).bind(
        crypto.randomUUID(),
        source.data.external_user_id,
        `merge-client-${crypto.randomUUID()}`,
      ),
    ]);

    const key = `contact-merge-${crypto.randomUUID()}`;
    const merge = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/${source.data.id}/merge`,
        12,
        "POST",
        { target_contact_id: target.data.id },
        key,
      ),
    );
    expect(merge.status).toBe(200);
    await expect(merge.json()).resolves.toMatchObject({
      data: {
        contact: { id: target.data.id, email: sourceRecord?.email },
        merged_contact_id: source.data.id,
      },
    });
    const replay = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/${source.data.id}/merge`,
        12,
        "POST",
        { target_contact_id: target.data.id },
        key,
      ),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    const [sourceCount, targetRelations, conversationCount, audit] =
      await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(*) total FROM support_contacts
          WHERE project_id = 12 AND id = ?`).bind(source.data.id),
        env.DB.prepare(`SELECT
          (SELECT COUNT(*) FROM support_contact_labels WHERE project_id = 12 AND contact_id = ?) labels,
          (SELECT COUNT(*) FROM support_contact_inboxes WHERE project_id = 12 AND contact_id = ?) inboxes,
          (SELECT COUNT(*) FROM support_contact_notes WHERE project_id = 12 AND contact_id = ?) notes`)
          .bind(target.data.id, target.data.id, target.data.id),
        env.DB.prepare(`SELECT COUNT(*) total FROM conversations
          WHERE project_id = 12 AND external_user_id = ?`).bind(target.data.external_user_id),
        env.DB.prepare(`SELECT COUNT(*) total FROM support_operations_audit_events
          WHERE project_id = 12 AND resource_type = 'contact' AND resource_id = ? AND action = 'merged'`)
          .bind(target.data.id),
      ]);
    expect(sourceCount.results[0]).toMatchObject({ total: 0 });
    expect(targetRelations.results[0]).toMatchObject({ labels: 1, inboxes: 1, notes: 1 });
    expect(conversationCount.results[0]).toMatchObject({ total: 1 });
    expect(audit.results[0]).toMatchObject({ total: 1 });
  });

  it("binds providers to an active same-project inbox and validates runtime delivery fields", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `voice-inbox-${suffix}`;
    await env.DB.prepare(`INSERT INTO support_inboxes
      (id, project_id, name, identifier, channel_type, status)
      VALUES (?, 12, ?, ?, 'twilio_voice', 'active')`)
      .bind(inboxId, `Voice ${suffix}`, `voice-${suffix}`).run();

    const missingInbox = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/providers",
      12,
      "POST",
      {
        provider: "twilio_voice",
        display_name: `Missing inbox ${suffix}`,
        status: "configuration_required",
        settings: {},
      },
      `provider-missing-inbox-${suffix}`,
    ));
    expect(missingInbox.status).toBe(422);
    await expect(missingInbox.json()).resolves.toMatchObject({
      error: { code: "support_field_required" },
    });

    const mismatchedInbox = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/providers",
      12,
      "POST",
      {
        provider: "twilio_sms",
        inbox_id: inboxId,
        display_name: `Mismatched inbox ${suffix}`,
        status: "configuration_required",
        settings: {},
      },
      `provider-mismatched-inbox-${suffix}`,
    ));
    expect(mismatchedInbox.status).toBe(422);
    await expect(mismatchedInbox.json()).resolves.toMatchObject({
      error: { code: "support_provider_inbox_invalid" },
    });

    const createdResponse = await SELF.fetch(await signedRequest(
      "/internal/v1/projects/12/providers",
      12,
      "POST",
      {
        provider: "twilio_voice",
        inbox_id: inboxId,
        display_name: `Voice provider ${suffix}`,
        status: "configuration_required",
        settings: {},
      },
      `provider-valid-inbox-${suffix}`,
    ));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{ data: { id: string } }>();

    const unsafeCallback = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/providers/${created.data.id}/credentials`,
      12,
      "PUT",
      {
        credentials: {
          account_sid: "AC1234567890",
          auth_token: "voice-token",
          from_number: "+14155552671",
          status_callback_url: "https://127.0.0.1/voice/status",
        },
      },
      `provider-unsafe-callback-${suffix}`,
    ));
    expect(unsafeCallback.status).toBe(422);
    await expect(unsafeCallback.json()).resolves.toMatchObject({
      error: { code: "support_provider_credentials_invalid" },
    });

    const configured = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/providers/${created.data.id}/credentials`,
      12,
      "PUT",
      {
        credentials: {
          account_sid: "AC1234567890",
          auth_token: "voice-token",
          from_number: "+14155552671",
          status_callback_url: "https://voice.example.test/support/status",
        },
      },
      `provider-valid-credentials-${suffix}`,
    ));
    expect(configured.status).toBe(200);
    await expect(configured.json()).resolves.toMatchObject({
      data: { endpoint_id: created.data.id, configured: true },
    });
  });

  it("routes integration authorization through the native project and public callback surfaces", async () => {
    const suffix = crypto.randomUUID();
    const integrationId = `oauth-route-${suffix}`;
    const encrypted = await encryptCredentialPayload(
      "support-runtime-credential-encryption-key",
      { client_id: "route-client", client_secret: "route-secret" },
    );
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_integrations
        (id, project_id, provider, display_name, status, settings_json)
        VALUES (?, 12, 'linear', ?, 'configuration_required', ?)`)
        .bind(integrationId, `OAuth route ${suffix}`, JSON.stringify({
          workflow_action: "create_issue",
          allowed_actions: ["create_issue"],
          team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
        })),
      env.DB.prepare(`INSERT INTO support_integration_credentials
        (integration_id, project_id, encrypted_payload) VALUES (?, 12, ?)`)
        .bind(integrationId, encrypted),
    ]);
    const startedResponse = await SELF.fetch(await signedRequest(
      `/internal/v1/projects/12/integrations/${integrationId}/oauth`,
      12,
      "POST",
      {
        callback_uri: "https://api.example.test/api/v1/support/providers/linear/oauth/callback",
        return_uri: "https://dashboard.example.test/support/integrations",
      },
      `integration-oauth-start-${suffix}`,
    ));
    expect(startedResponse.status).toBe(201);
    const started = await startedResponse.json<{
      data: { authorization_url: string; expires_in: number };
    }>();
    const state = new URL(started.data.authorization_url).searchParams.get("state");
    expect(state).toMatch(/^si1\./u);

    const callback = await SELF.fetch(new Request(
      `https://support.internal/public/v1/providers/linear/oauth/callback?error=access_denied&state=${encodeURIComponent(state!)}`,
      { redirect: "manual" },
    ));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(
      "https://dashboard.example.test/support/integrations?support_result=error&support_code=authorization_failed",
    );
    await expect(env.DB.prepare(`SELECT status FROM support_integrations
      WHERE id = ? AND project_id = 12`).bind(integrationId).first())
      .resolves.toMatchObject({ status: "configuration_required" });
  });

  it("persists contact import and export jobs before enqueueing them on the bulk queue", async () => {
    const importResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts/imports",
        12,
        "POST",
        { storage_key: `imports/12/${crypto.randomUUID()}.json` },
        `contact-import-${crypto.randomUUID()}`,
      ),
    );
    expect(importResponse.status).toBe(202);
    const imported = await importResponse.json<{
      data: { id: string; status: string; storage_key?: string };
    }>();
    expect(imported.data).toMatchObject({ status: "queued" });
    expect(imported.data.storage_key).toBeUndefined();

    const exportResponse = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts/exports",
        12,
        "POST",
        { filters: { company_id: null } },
        `contact-export-${crypto.randomUUID()}`,
      ),
    );
    expect(exportResponse.status).toBe(202);
    const exported = await exportResponse.json<{
      data: { id: string; status: string; storage_key?: string };
    }>();
    expect(exported.data).toMatchObject({ status: "queued" });
    expect(exported.data.storage_key).toBeUndefined();

    const [importJob, exportJob] = await env.DB.batch([
      env.DB.prepare(`SELECT resource_type, status FROM support_import_jobs
        WHERE project_id = 12 AND id = ?`).bind(imported.data.id),
      env.DB.prepare(`SELECT resource_type, status FROM support_export_jobs
        WHERE project_id = 12 AND id = ?`).bind(exported.data.id),
    ]);
    expect(importJob.results[0]).toMatchObject({ resource_type: "contacts", status: "queued" });
    expect(exportJob.results[0]).toMatchObject({ resource_type: "contacts", status: "queued" });

    const exportStorageKey = `exports/12/${exported.data.id}.json`;
    await env.ATTACHMENTS.put(exportStorageKey, JSON.stringify({ data: [{ id: "contact-exported" }] }), {
      httpMetadata: { contentType: "application/json" },
    });
    await env.DB.prepare(`UPDATE support_export_jobs SET status = 'completed', storage_key = ?
      WHERE project_id = 12 AND id = ?`).bind(exportStorageKey, exported.data.id).run();
    const exportStatus = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/exports/${exported.data.id}`,
        12,
      ),
    );
    await expect(exportStatus.json()).resolves.toMatchObject({
      data: { id: exported.data.id, status: "completed", download_ref: exported.data.id },
    });
    const download = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/contacts/exports/${exported.data.id}/download`,
        12,
      ),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(`support-contacts-${exported.data.id}.json`);
    const downloaded = await download.text();
    expect(downloaded).toContain("contact-exported");
    expect(downloaded).not.toContain(exportStorageKey);

    const secretFilter = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/contacts/exports",
        12,
        "POST",
        { filters: { access_token: "must-not-be-stored" } },
        `contact-export-secret-${crypto.randomUUID()}`,
      ),
    );
    expect(secretFilter.status).toBe(422);
    await expect(secretFilter.json()).resolves.toMatchObject({
      error: { code: "filters_invalid" },
    });
  });

  it("supports native conversation mute, transfer, bulk actions, merge and secret-free transcripts", async () => {
    const inboxId = crypto.randomUUID();
    const teamId = crypto.randomUUID();
    const labelId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, 'Operations Inbox', ?, 'api')`).bind(inboxId, `ops-${inboxId}`),
      env.DB.prepare(`INSERT INTO support_teams
        (id, project_id, name) VALUES (?, 12, ?)`).bind(teamId, `Operations ${teamId}`),
      env.DB.prepare(`INSERT INTO support_labels
        (id, project_id, name, color) VALUES (?, 12, ?, '#0f766e')`)
        .bind(labelId, `Escalated ${labelId}`),
    ]);
    const sourceId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, priority)
        VALUES (?, 12, ?, ?, 'Source transcript', 'normal')`).bind(
        sourceId,
        `conversation-source-${sourceId}`,
        `source-${sourceId}`,
      ),
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, priority)
        VALUES (?, 12, ?, ?, 'Target transcript', 'normal')`).bind(
        targetId,
        `conversation-target-${targetId}`,
        `target-${targetId}`,
      ),
      env.DB.prepare(`INSERT INTO messages
        (id, conversation_id, sender_kind, sender_id, body, client_message_id, sequence)
        VALUES (?, ?, 'user', 'contact-1', 'Transcript body', ?, 1)`).bind(
        messageId,
        sourceId,
        `message-${messageId}`,
      ),
      env.DB.prepare(`INSERT INTO support_message_attachments
        (id, project_id, conversation_id, message_id, storage_key, file_name, content_type, byte_size)
        VALUES (?, 12, ?, ?, ?, 'evidence.txt', 'text/plain', 14)`).bind(
        attachmentId,
        sourceId,
        messageId,
        `attachments/12/${sourceId}/${messageId}/private-object-key`,
      ),
    ]);

    const inboxPage = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/conversations?q=transcript&limit=1",
        12,
      ),
    );
    await expect(inboxPage.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: expect.any(String) })],
      pagination: { limit: 1, has_more: true, next_cursor: expect.any(String) },
    });
    const invalidInboxLimit = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/conversations?limit=101",
        12,
      ),
    );
    expect(invalidInboxLimit.status).toBe(422);

    const mute = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/conversations/${targetId}/mute`,
        12,
        "POST",
        {},
        `mute-${targetId}`,
      ),
    );
    await expect(mute.json()).resolves.toMatchObject({ data: { muted: true } });
    const unmute = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/conversations/${targetId}/unmute`,
        12,
        "POST",
        {},
        `unmute-${targetId}`,
      ),
    );
    await expect(unmute.json()).resolves.toMatchObject({ data: { muted: false } });

    const transfer = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/conversations/${targetId}/transfer`,
        12,
        "POST",
        { inbox_id: inboxId, assigned_team_id: teamId },
        `transfer-${targetId}`,
      ),
    );
    await expect(transfer.json()).resolves.toMatchObject({
      data: { inbox_id: inboxId, assigned_team_id: teamId },
    });

    const bulk = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/conversations/bulk-actions",
        12,
        "POST",
        {
          conversation_ids: [sourceId, targetId],
          action: "set_priority",
          priority: "urgent",
        },
        `bulk-${targetId}`,
      ),
    );
    await expect(bulk.json()).resolves.toMatchObject({
      data: {
        conversations: [
          { id: sourceId, priority: "urgent" },
          { id: targetId, priority: "urgent" },
        ],
      },
    });

    const labels = await SELF.fetch(
      await signedRequest(
        "/internal/v1/projects/12/conversations/bulk",
        12,
        "POST",
        {
          conversation_ids: [sourceId, targetId],
          action: "add_label",
          label_id: labelId,
        },
        `bulk-label-${targetId}`,
      ),
    );
    expect(labels.status).toBe(200);

    const merge = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/conversations/${sourceId}/merge`,
        12,
        "POST",
        { target_conversation_id: targetId },
        `merge-${targetId}`,
      ),
    );
    expect(merge.status).toBe(200);
    await expect(merge.json()).resolves.toMatchObject({
      data: {
        target: { id: targetId },
        source: { id: sourceId, status: "closed", merged_into_conversation_id: targetId },
      },
    });

    const transcript = await SELF.fetch(
      await signedRequest(
        `/internal/v1/projects/12/conversations/${targetId}/transcript?limit=1`,
        12,
      ),
    );
    const transcriptText = await transcript.text();
    expect(transcript.status).toBe(200);
    expect(transcriptText).not.toContain("storage_key");
    expect(transcriptText).not.toContain("private-object-key");
    expect(JSON.parse(transcriptText)).toMatchObject({
      data: {
        messages: [{
          id: messageId,
          body: "Transcript body",
          attachments: [{
            id: attachmentId,
            file_name: "evidence.txt",
            content_type: "text/plain",
          }],
        }],
      },
      pagination: { limit: 1, has_more: false },
    });

    const [attachment, source, audit] = await env.DB.batch([
      env.DB.prepare(`SELECT conversation_id FROM support_message_attachments WHERE id = ?`).bind(attachmentId),
      env.DB.prepare(`SELECT status, external_user_id,
        json_extract(custom_attributes_json, '$.merged_into_conversation_id') merged_into
        FROM conversations WHERE project_id = 12 AND id = ?`).bind(sourceId),
      env.DB.prepare(`SELECT COUNT(*) total FROM support_operations_audit_events
        WHERE project_id = 12 AND resource_type = 'conversation' AND resource_id = ? AND action = 'merged'`)
        .bind(targetId),
    ]);
    expect(attachment.results[0]).toMatchObject({ conversation_id: targetId });
    expect(source.results[0]).toMatchObject({
      status: "closed",
      external_user_id: `merged:${sourceId}`,
      merged_into: targetId,
    });
    expect(audit.results[0]).toMatchObject({ total: 1 });
  });

  it("authenticates the public widget, isolates its endpoint project, and issues a user realtime ticket", async () => {
    const endpointId = crypto.randomUUID();
    const widgetKey = `widget-key-${crypto.randomUUID()}`;
    const signingSecret = `widget-secret-${crypto.randomUUID()}`;
    const visitor = `visitor-${crypto.randomUUID()}`;
    const widgetKeyHash = await sha256Hex(widgetKey);
    const widgetSubject = `widget:${await sha256Hex(`${endpointId}:${visitor}`)}`;
    const encryptedPayload = await encryptCredentialPayload(
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
      {
        widget_key: widgetKey,
        signing_secret: signingSecret,
        allowed_domains: ["support.example.test"],
      },
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_provider_endpoints
          (id, project_id, provider, display_name, status, settings_json)
         VALUES (?, 12, 'widget', ?, 'live_validated', ?)`,
      ).bind(
        endpointId,
        `Widget ${endpointId}`,
        JSON.stringify({ widget_key_hash: widgetKeyHash }),
      ),
      env.DB.prepare(
        `INSERT INTO support_provider_credentials
          (endpoint_id, project_id, encrypted_payload)
         VALUES (?, 12, ?)`,
      ).bind(endpointId, encryptedPayload),
    ]);

    const ownedConversation = crypto.randomUUID();
    const foreignConversation = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO conversations
          (id, project_id, external_user_id, client_conversation_id, subject)
         VALUES (?, 12, ?, ?, 'Widget owned')`,
      ).bind(ownedConversation, widgetSubject, `client-${ownedConversation}`),
      env.DB.prepare(
        `INSERT INTO conversations
          (id, project_id, external_user_id, client_conversation_id, subject)
         VALUES (?, 13, ?, ?, 'Widget foreign')`,
      ).bind(foreignConversation, widgetSubject, `client-${foreignConversation}`),
    ]);

    const isolated = await SELF.fetch(await signedWidgetRequest({
      path: `/conversations/${foreignConversation}/realtime-ticket`,
      widgetKey,
      signingSecret,
      visitor,
      projectReference: "13",
    }));
    const isolatedBody = await isolated.json();
    expect(isolatedBody).toMatchObject({
      error: { code: "conversation_not_found" },
    });
    expect(isolated.status).toBe(404);

    const issued = await SELF.fetch(await signedWidgetRequest({
      path: `/conversations/${ownedConversation}/realtime-ticket`,
      widgetKey,
      signingSecret,
      visitor,
      projectReference: "13",
    }));
    expect(issued.status).toBe(201);
    const issuedBody = await issued.json<{
      data: { ticket: string; expires_at: string };
    }>();
    expect(issuedBody.data.ticket).toContain(".");
    expect(issuedBody.data.ticket).not.toContain(visitor);
    await expect(
      env.DB.prepare(
        `SELECT project_id, conversation_id, actor_id, actor_kind, consumed_at
         FROM support_realtime_tickets
         WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1`,
      ).bind(ownedConversation).first(),
    ).resolves.toMatchObject({
      project_id: 12,
      conversation_id: ownedConversation,
      actor_id: widgetSubject,
      actor_kind: "user",
      consumed_at: null,
    });

    const connected = await SELF.fetch(new Request(
      `https://support.internal/public/v1/realtime/${encodeURIComponent(issuedBody.data.ticket)}`,
      { headers: { upgrade: "websocket" } },
    ));
    expect(connected.status).toBe(101);
    connected.webSocket?.accept();
    connected.webSocket?.close(1000, "widget test complete");

    const replayed = await SELF.fetch(new Request(
      `https://support.internal/public/v1/realtime/${encodeURIComponent(issuedBody.data.ticket)}`,
      { headers: { upgrade: "websocket" } },
    ));
    expect(replayed.status).toBe(401);
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
