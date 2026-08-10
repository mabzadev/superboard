import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  requireInternal,
  requireProject,
  verifyApplicationIdentity,
  verifyInternalProjectContext,
} from "./auth";
import configuration, { getPublicSupportConfiguration } from "./configuration";
import operations, { ensureSupportContact } from "./operations";
import { runConversationAutomations } from "./workflows";
import { handleSupportQueue, publishSupportEvent } from "./webhooks";
import { ConversationRoom } from "./conversation-room";
import type { Actor, Conversation, Env } from "./types";
import {
  MAX_ATTACHMENT_BYTES,
  readBytesLimited,
  readJsonObject,
  safeFilename,
} from "./validation";
import { consumeRealtimeTicket, issueRealtimeTicket } from "./realtime";
import { MESSAGE_WITH_ATTACHMENTS } from "./message-records";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";

const app = new Hono<{
  Bindings: Env;
  Variables: { subject: string; identityExpiresAt: number };
}>();

app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.CORS_ORIGIN ? origin : undefined),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "X-OpenGrow-Project-Id",
      "X-Filename",
      "Idempotency-Key",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "opengrow-support",
    environment: c.env.ENVIRONMENT,
  }),
);
app.get("/internal/v1/health", async (c) => {
  try {
    const [metrics, schema] = await Promise.all([
      supportHealth(c.env.DB),
      inspectSqlSchemaHealth(c.env.DB, c.env.D1_EXPECTED_MIGRATION),
    ]);
    const current = schema.status === "current";
    return c.json(
      {
        data: {
          service: "support",
          version: "v1",
          status: current ? "ok" : "degraded",
          metrics,
          schema,
          ...(current ? {} : { reason: "database_schema_not_current" }),
        },
      },
      current ? 200 : 503,
      { "cache-control": "no-store" },
    );
  } catch {
    return c.json(
      {
        data: {
          service: "support",
          version: "v1",
          status: "degraded",
          metrics: null,
          reason: "database_health_unavailable",
        },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});

export async function supportHealth(db: D1Database) {
  const row = await db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM support_contacts) AS contacts,
      (SELECT COUNT(*) FROM conversations) AS conversations_total,
      (SELECT COUNT(*) FROM conversations WHERE status = 'open') AS conversations_open,
      (SELECT COUNT(*) FROM conversations WHERE status = 'pending') AS conversations_pending,
      (SELECT COUNT(*) FROM conversations WHERE status = 'closed') AS conversations_closed,
      (SELECT COUNT(*) FROM messages) AS messages,
      (SELECT COUNT(*) FROM support_message_attachments) AS attachments,
      (SELECT COUNT(*) FROM support_webhook_deliveries WHERE delivered_at IS NULL) AS webhooks_pending,
      (SELECT COUNT(*) FROM support_webhook_deliveries WHERE delivered_at IS NULL AND last_error IS NOT NULL) AS webhooks_failed,
      (SELECT COUNT(*) FROM support_dead_letters WHERE status = 'quarantined') AS dead_letters_quarantined,
      (SELECT COUNT(*) FROM support_csat_responses) AS csat_responses,
      (SELECT ROUND(AVG(rating), 2) FROM support_csat_responses) AS csat_average
  `,
    )
    .first<Record<string, number | null>>();
  if (!row) throw new Error("Support health query returned no row");
  return {
    contacts: Number(row.contacts || 0),
    conversations: {
      total: Number(row.conversations_total || 0),
      open: Number(row.conversations_open || 0),
      pending: Number(row.conversations_pending || 0),
      closed: Number(row.conversations_closed || 0),
    },
    messages: Number(row.messages || 0),
    attachments: Number(row.attachments || 0),
    webhooks: {
      pending: Number(row.webhooks_pending || 0),
      failed: Number(row.webhooks_failed || 0),
    },
    deadLetters: { quarantined: Number(row.dead_letters_quarantined || 0) },
    csat: {
      responses: Number(row.csat_responses || 0),
      average: row.csat_average == null ? null : Number(row.csat_average),
    },
  };
}

app.get("/public/v1/realtime/:ticket", async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    throw failure(
      "realtime_upgrade_required",
      "WebSocket upgrade is required",
      426,
    );
  }
  const ticket = await consumeRealtimeTicket(c.env, c.req.param("ticket"));
  const conversation = await projectConversation(
    c.env,
    ticket.conversation_id,
    ticket.project_id,
  );
  await c.env.DB.prepare(
    `
    INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
    VALUES (?, ?, 'realtime_ticket', ?, 'consumed', ?, '{}')
  `,
  )
    .bind(
      crypto.randomUUID(),
      ticket.project_id,
      ticket.conversation_id,
      ticket.actor_id,
    )
    .run();
  const headers = new Headers(c.req.raw.headers);
  headers.delete("authorization");
  headers.delete("cookie");
  const source = new Request(c.req.url, { method: "GET", headers });
  return roomFetch(
    c.env,
    conversation.id,
    { id: ticket.actor_id, kind: "agent" },
    "/connect",
    source,
    new Date(ticket.expires_at).getTime(),
  );
});

app.use("/v1/*", async (c, next) => {
  const identity = await verifyApplicationIdentity(
    c.env,
    c.req.header("Authorization"),
  );
  c.set("subject", identity.subject);
  c.set("identityExpiresAt", identity.expiresAt);
  await next();
});

app.post("/v1/conversations", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const body = await readJsonObject(c.req.raw);
  const clientId = String(
    body.client_conversation_id || c.req.header("Idempotency-Key") || "",
  ).trim();
  const subjectLine =
    typeof body.subject === "string" ? body.subject.trim().slice(0, 255) : "";
  const inboxId = optionalIdentifier(body.inbox_id, "inbox_id");
  const customAttributes = validateCustomAttributes(body.custom_attributes);
  if (!clientId || clientId.length > 128)
    throw failure(
      "client_conversation_id_invalid",
      "A client conversation id is required",
      422,
    );
  if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, custom_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `,
  )
    .bind(
      id,
      projectId,
      subject,
      clientId,
      subjectLine || null,
      inboxId,
      JSON.stringify(customAttributes),
    )
    .first<Record<string, unknown>>();
  const conversation =
    inserted ||
    (await c.env.DB.prepare(
      `
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `,
    )
      .bind(projectId, subject, clientId)
      .first<Record<string, unknown>>());
  if (!conversation) throw new Error("Unable to create conversation");
  await ensureSupportContact(c.env.DB, projectId, subject);
  if (inserted) {
    await audit(
      c.env,
      String(conversation.id),
      projectId,
      "conversation.created",
      { kind: "user", id: subject },
      {},
    );
    await runConversationAutomations(
      c.env,
      projectId,
      String(conversation.id),
      "conversation_created",
      `conversation_created:${conversation.id}`,
    );
  }
  await publishSupportEvent(
    c.env,
    projectId,
    `conversation.created:${conversation.id}`,
    "conversation.created",
    {
      conversation_id: conversation.id,
      external_user_id: subject,
      inbox_id: conversation.inbox_id,
      status: conversation.status,
      priority: conversation.priority,
    },
  );
  return c.json(
    { data: conversation, duplicate: !inserted },
    inserted ? 201 : 200,
  );
});

app.get("/v1/conversations", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  return c.json({
    data: await listUserConversations(c.env.DB, projectId, subject),
  });
});

app.get("/v1/configuration", async (c) => {
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  return c.json({
    data: await getPublicSupportConfiguration(c.env.DB, projectId),
  });
});

app.patch("/v1/conversations/:conversationId", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  const body = await readJsonObject(c.req.raw);
  const status = body.status == null ? null : String(body.status);
  if (status && !["open", "closed"].includes(status))
    throw failure(
      "status_invalid",
      "Customers can set only open or closed status",
    );
  const customAttributes =
    body.custom_attributes == null
      ? null
      : validateCustomAttributes(body.custom_attributes);
  if (status == null && customAttributes == null)
    throw failure(
      "conversation_update_empty",
      "No supported conversation update was provided",
    );
  await c.env.DB.prepare(
    `
    UPDATE conversations SET
      status = COALESCE(?, status),
      custom_attributes_json = COALESCE(?, custom_attributes_json),
      resolved_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHEN ? = 'open' THEN NULL ELSE resolved_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `,
  )
    .bind(
      status,
      customAttributes == null ? null : JSON.stringify(customAttributes),
      status,
      status,
      conversation.id,
    )
    .run();
  await audit(
    c.env,
    conversation.id,
    projectId,
    "conversation.customer_updated",
    { kind: "user", id: subject },
    {
      status,
      custom_attributes: customAttributes,
    },
  );
  const eventId = `conversation_customer_updated:${conversation.id}:${crypto.randomUUID()}`;
  await runConversationAutomations(
    c.env,
    projectId,
    conversation.id,
    status === "closed"
      ? "conversation_resolved"
      : status === "open"
        ? "conversation_opened"
        : "conversation_updated",
    eventId,
  );
  const updated = await userConversationRecord(
    c.env,
    conversation.id,
    subject,
    projectId,
  );
  await publishSupportEvent(c.env, projectId, eventId, "conversation.updated", {
    conversation_id: conversation.id,
    status: updated.status,
    custom_attributes: updated.custom_attributes_json,
  });
  return c.json({ data: updated });
});

app.post("/v1/conversations/:conversationId/csat", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  if (conversation.status !== "closed")
    throw failure(
      "csat_not_available",
      "CSAT is available after the conversation is closed",
      409,
    );
  const body = await readJsonObject(c.req.raw);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw failure("csat_rating_invalid", "CSAT rating must be between 1 and 5");
  const feedback =
    body.feedback == null
      ? null
      : String(body.feedback).trim().slice(0, 4000) || null;
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `
    INSERT INTO support_csat_responses
      (id, project_id, conversation_id, contact_external_user_id, rating, feedback)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET rating = excluded.rating, feedback = excluded.feedback,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `,
  )
    .bind(id, projectId, conversation.id, subject, rating, feedback)
    .run();
  await audit(
    c.env,
    conversation.id,
    projectId,
    "conversation.csat_submitted",
    { kind: "user", id: subject },
    { rating },
  );
  await publishSupportEvent(
    c.env,
    projectId,
    `csat:${conversation.id}:${crypto.randomUUID()}`,
    "conversation.csat_submitted",
    {
      conversation_id: conversation.id,
      rating,
      feedback,
    },
  );
  return c.json(
    { data: { conversation_id: conversation.id, rating, feedback } },
    201,
  );
});

export async function listUserConversations(
  db: D1Database,
  projectId: number,
  externalUserId: string,
) {
  const rows = await db
    .prepare(
      `
    SELECT conversation.*,
      (SELECT COUNT(*) FROM messages message
        WHERE message.conversation_id = conversation.id
          AND message.visibility = 'public'
          AND message.sender_kind IN ('agent', 'system')
          AND (conversation.user_last_read_at IS NULL OR message.created_at > conversation.user_last_read_at)
      ) AS unread_count
    FROM conversations conversation
    WHERE conversation.project_id = ? AND conversation.external_user_id = ?
    ORDER BY conversation.updated_at DESC LIMIT 100
  `,
    )
    .bind(projectId, externalUserId)
    .all<Record<string, unknown>>();
  return rows.results;
}

app.get("/v1/conversations/:conversationId/messages", async (c) => {
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    c.get("subject"),
    projectId,
  );
  const before = Number(
    c.req.query("before_sequence") || Number.MAX_SAFE_INTEGER,
  );
  const limit = Math.min(Math.max(Number(c.req.query("limit") || 50), 1), 100);
  const rows = await c.env.DB.prepare(
    `
    SELECT ${MESSAGE_WITH_ATTACHMENTS} FROM messages
    WHERE conversation_id = ? AND visibility = 'public' AND sequence < ?
    ORDER BY sequence DESC LIMIT ?
  `,
  )
    .bind(
      conversation.id,
      Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER,
      limit,
    )
    .all();
  return c.json({ data: [...rows.results].reverse() });
});

app.post("/v1/conversations/:conversationId/messages", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/messages",
    c.req.raw,
    c.get("identityExpiresAt"),
  );
});

app.post("/v1/conversations/:conversationId/read", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/read",
    c.req.raw,
    c.get("identityExpiresAt"),
  );
});

app.post("/v1/conversations/:conversationId/typing", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/typing",
    c.req.raw,
    c.get("identityExpiresAt"),
  );
});

app.get("/v1/conversations/:conversationId/ws", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/connect",
    c.req.raw,
    c.get("identityExpiresAt"),
  );
});

app.post("/v1/conversations/:conversationId/attachments", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return storeAttachment(c.env, conversation, subject, c.req.raw);
});

app.get(
  "/v1/conversations/:conversationId/attachments/:messageId",
  async (c) => {
    const subject = c.get("subject");
    const projectId = requireProject(
      c.env,
      c.req.header("X-OpenGrow-Project-Id"),
    );
    const conversation = await userConversation(
      c.env,
      c.req.param("conversationId"),
      subject,
      projectId,
    );
    return attachmentResponse(
      c.env,
      conversation,
      c.req.param("messageId"),
      false,
      c.req.query("attachment_id"),
    );
  },
);

app.use("/internal/v1/*", async (c, next) => {
  await requireInternal(c.env, c.req.header("X-Internal-Token"));
  await next();
});

app.use("/internal/v1/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
    /^\/internal\/v1\/projects\/\d+\/settings(?:\/|$)/.test(path) &&
    !["owner", "admin"].includes(
      String(c.req.header("X-Role") || "").toLowerCase(),
    )
  ) {
    throw failure(
      "role_insufficient",
      "Owner or admin access is required to change Support configuration",
      403,
    );
  }
  await next();
});

app.use("/internal/v1/*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const projectId = positiveInt(
    c.req.header("X-Project-Id") || "",
    "project_id_invalid",
  );
  const key = String(c.req.header("Idempotency-Key") || "").trim();
  if (!key || key.length > 128)
    throw failure(
      "idempotency_key_required",
      "Idempotency-Key is required and limited to 128 characters",
      422,
    );
  const scope = `${c.req.method}:${new URL(c.req.url).pathname}:${key}`;
  const claim = await c.env.DB.prepare(
    `
    INSERT INTO support_idempotency_keys (project_id, key, request_method, request_path, state)
    VALUES (?, ?, ?, ?, 'processing') ON CONFLICT(project_id, key) DO NOTHING RETURNING key
  `,
  )
    .bind(projectId, scope, c.req.method, new URL(c.req.url).pathname)
    .first();
  if (!claim) {
    const existing = await c.env.DB.prepare(
      `
      SELECT response_status, response_body FROM support_idempotency_keys WHERE project_id = ? AND key = ?
    `,
    )
      .bind(projectId, scope)
      .first<{
        response_status: number | null;
        response_body: string | null;
      }>();
    if (!existing?.response_status || !existing.response_body) {
      throw failure(
        "idempotency_in_progress",
        "An identical request is already being processed",
        409,
      );
    }
    const replay = new Response(existing.response_body, {
      status: existing.response_status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "idempotency-replayed": "true",
      },
    });
    return replay;
  }
  try {
    await next();
    const status = c.res.status;
    if (status >= 500) {
      await c.env.DB.prepare(
        "DELETE FROM support_idempotency_keys WHERE project_id = ? AND key = ?",
      )
        .bind(projectId, scope)
        .run();
      return;
    }
    const body = await c.res.clone().text();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `
        UPDATE support_idempotency_keys SET state = 'completed', response_status = ?, response_body = ?,
          completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND key = ?
      `,
      ).bind(status, body, projectId, scope),
      c.env.DB.prepare(
        `
        INSERT INTO support_operations_audit_events
          (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
        VALUES (?, ?, 'request', ?, ?, ?, ?)
      `,
      ).bind(
        crypto.randomUUID(),
        projectId,
        new URL(c.req.url).pathname.slice(0, 255),
        `${c.req.method} ${new URL(c.req.url).pathname}`.slice(0, 255),
        String(c.req.header("X-OpenGrow-Agent-Id") || "system").slice(0, 255),
        JSON.stringify({
          status,
          request_id: c.req.header("X-Request-Id") || null,
        }),
      ),
    ]);
  } catch (error) {
    await c.env.DB.prepare(
      "DELETE FROM support_idempotency_keys WHERE project_id = ? AND key = ?",
    )
      .bind(projectId, scope)
      .run();
    throw error;
  }
});

app.route("/internal/v1/projects", configuration);
app.route("/internal/v1/projects", operations);

app.delete(
  "/internal/v1/projects/:projectId/application/users/:userId",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const userId = applicationUserId(c.req.param("userId"));
    const conversations = await c.env.DB.prepare(
      `SELECT id FROM conversations
       WHERE project_id = ? AND external_user_id = ?`,
    )
      .bind(projectId, userId)
      .all<{ id: string }>();
    const attachments = await c.env.DB.prepare(
      `SELECT attachment.storage_key
       FROM support_message_attachments attachment
       INNER JOIN conversations conversation
         ON conversation.id = attachment.conversation_id
       WHERE conversation.project_id = ? AND conversation.external_user_id = ?`,
    )
      .bind(projectId, userId)
      .all<{ storage_key: string }>();

    for (const conversation of conversations.results) {
      const stub = c.env.CONVERSATIONS.get(
        c.env.CONVERSATIONS.idFromName(conversation.id),
      );
      const closed = await stub.fetch("https://room.internal/erase", {
        method: "DELETE",
        headers: { "x-room-capability": c.env.INTERNAL_API_TOKEN },
      });
      if (!closed.ok) {
        throw failure(
          "conversation_erasure_unavailable",
          "A realtime conversation could not be closed",
          503,
        );
      }
    }
    for (let index = 0; index < attachments.results.length; index += 1_000) {
      await c.env.ATTACHMENTS.delete(
        attachments.results
          .slice(index, index + 1_000)
          .map((attachment) => attachment.storage_key),
      );
    }

    const erasedActor = `erased:${(await sha256(`${projectId}:${userId}`)).slice(0, 32)}`;
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE support_audit_events
         SET actor_id = ?, payload_json = '{}'
         WHERE project_id = ? AND actor_kind = 'user' AND actor_id = ?`,
      ).bind(erasedActor, projectId, userId),
      c.env.DB.prepare(
        `DELETE FROM support_contacts
         WHERE project_id = ? AND external_user_id = ?`,
      ).bind(projectId, userId),
      c.env.DB.prepare(
        `DELETE FROM contacts
         WHERE project_id = ? AND external_id = ?`,
      ).bind(String(projectId), userId),
      c.env.DB.prepare(
        `DELETE FROM conversations
         WHERE project_id = ? AND external_user_id = ?`,
      ).bind(projectId, userId),
    ]);
    return c.json({
      data: {
        erased: true,
        conversations_deleted: conversations.results.length,
        contacts_deleted:
          Number(results[1].meta.changes || 0) +
          Number(results[2].meta.changes || 0),
        attachments_deleted: attachments.results.length,
        audit_events_redacted: Number(results[0].meta.changes || 0),
      },
    });
  },
);

app.get("/internal/v1/projects/:projectId/conversations", async (c) => {
  const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
  const status = c.req.query("status") || "";
  return c.json({
    data: await listProjectConversations(c.env.DB, projectId, status),
  });
});

app.get("/internal/v1/projects/:projectId/items", async (c) => {
  const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
  const selectedType = String(c.req.query("type") || "all");
  const selectedStatus = String(c.req.query("status") || "");
  if (!["all", "conversation", "refund_case"].includes(selectedType)) {
    throw failure("inbox_type_invalid", "Unsupported Inbox item type");
  }
  if (
    selectedStatus &&
    !["open", "pending", "closed"].includes(selectedStatus)
  ) {
    throw failure("inbox_status_invalid", "Unsupported Inbox status");
  }
  const conversations =
    selectedType === "refund_case"
      ? []
      : await listProjectConversations(c.env.DB, projectId, selectedStatus);
  return c.json({
    data: conversations.map(mapConversationItem),
    degraded_sources: [],
    projection: true,
  });
});

export async function listProjectConversations(
  db: D1Database,
  projectId: number,
  status = "",
) {
  const rows = await db
    .prepare(
      `
    SELECT c.*,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT COUNT(*) FROM messages unread
        WHERE unread.conversation_id = c.id AND unread.sender_kind = 'user'
          AND (c.agent_last_read_at IS NULL OR unread.created_at > c.agent_last_read_at)
      ) AS unread_count
    FROM conversations c
    WHERE c.project_id = ? AND (? = '' OR c.status = ?)
    ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      COALESCE(c.last_message_at, c.created_at) DESC LIMIT 250
  `,
    )
    .bind(projectId, status, status)
    .all<Record<string, unknown>>();
  return rows.results;
}

export function mapConversationItem(row: Record<string, unknown>) {
  const status = ["open", "pending", "closed"].includes(String(row.status))
    ? (String(row.status) as "open" | "pending" | "closed")
    : "open";
  const priority = ["low", "normal", "high", "urgent"].includes(
    String(row.priority),
  )
    ? (String(row.priority) as "low" | "normal" | "high" | "urgent")
    : "normal";
  const sourceId = String(row.id || "");
  const rawDate = String(
    row.last_message_at || row.updated_at || row.created_at || "",
  );
  const parsedDate = new Date(rawDate);
  return {
    id: `conversation:${sourceId}`,
    source_type: "conversation" as const,
    source_id: sourceId,
    title: String(row.subject || "Support conversation").slice(0, 255),
    preview: String(row.last_message_preview || "No messages").slice(0, 1000),
    status,
    priority,
    customer_reference: row.external_user_id
      ? String(row.external_user_id)
      : null,
    updated_at: Number.isNaN(parsedDate.getTime())
      ? new Date(0).toISOString()
      : parsedDate.toISOString(),
    destination: `/support/inbox?type=conversation&id=${encodeURIComponent(sourceId)}`,
    capabilities: ["reply", "assign", "set_priority", "set_status"],
    source: row,
  };
}

app.post("/internal/v1/projects/:projectId/conversations", async (c) => {
  const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
  const body = await readJsonObject(c.req.raw);
  const externalUserId = String(body.external_user_id || "").trim();
  const clientId = String(
    body.client_conversation_id || c.req.header("Idempotency-Key") || "",
  ).trim();
  const subjectLine =
    typeof body.subject === "string" ? body.subject.trim().slice(0, 255) : "";
  const inboxId = optionalIdentifier(body.inbox_id, "inbox_id");
  const customAttributes = validateCustomAttributes(body.custom_attributes);
  if (!externalUserId || externalUserId.length > 255)
    throw failure(
      "external_user_id_invalid",
      "A valid external user id is required",
    );
  if (!clientId || clientId.length > 128)
    throw failure(
      "client_conversation_id_invalid",
      "A client conversation id is required",
    );
  if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
  const result = await upsertProjectConversation(
    c.env,
    projectId,
    externalUserId,
    clientId,
    subjectLine || null,
    {
      inboxId,
      customAttributes,
    },
  );
  if (!result.duplicate) {
    await audit(
      c.env,
      String(result.conversation.id),
      projectId,
      "conversation.created",
      { kind: "system", id: "automation" },
      {
        source: "automation",
      },
    );
    await runConversationAutomations(
      c.env,
      projectId,
      String(result.conversation.id),
      "conversation_created",
      `conversation_created:${result.conversation.id}`,
    );
  }
  await ensureSupportContact(c.env.DB, projectId, externalUserId);
  await publishSupportEvent(
    c.env,
    projectId,
    `conversation.created:${result.conversation.id}`,
    "conversation.created",
    {
      conversation_id: result.conversation.id,
      external_user_id: externalUserId,
      inbox_id: result.conversation.inbox_id,
      status: result.conversation.status,
      priority: result.conversation.priority,
    },
  );
  return c.json(
    { data: result.conversation, duplicate: result.duplicate },
    result.duplicate ? 200 : 201,
  );
});

app.get(
  "/internal/v1/projects/:projectId/conversations/:conversationId/messages",
  async (c) => {
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      positiveInt(c.req.param("projectId"), "project_id_invalid"),
    );
    const rows = await c.env.DB.prepare(
      `SELECT ${MESSAGE_WITH_ATTACHMENTS} FROM messages
    WHERE conversation_id = ? ORDER BY sequence ASC LIMIT 500`,
    )
      .bind(conversation.id)
      .all();
    return c.json({ data: rows.results });
  },
);

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/messages",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = c.req.header("X-OpenGrow-Agent-Id") || "";
    if (!agentId)
      throw failure("agent_required", "Agent identity is required", 401);
    return roomFetch(
      c.env,
      conversation.id,
      { id: agentId, kind: "agent" },
      "/messages",
      c.req.raw,
    );
  },
);

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/realtime-ticket",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const actorId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    const issued = await issueRealtimeTicket(
      c.env,
      projectId,
      conversation.id,
      actorId,
    );
    await c.env.DB.prepare(
      `
    INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
    VALUES (?, ?, 'realtime_ticket', ?, 'issued', ?, ?)
  `,
    )
      .bind(
        crypto.randomUUID(),
        projectId,
        conversation.id,
        actorId,
        JSON.stringify({ expires_at: issued.expires_at }),
      )
      .run();
    return c.json({ data: issued }, 201);
  },
);

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/read",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return roomFetch(
      c.env,
      conversation.id,
      { id: agentId, kind: "agent" },
      "/read",
      c.req.raw,
    );
  },
);

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/typing",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return roomFetch(
      c.env,
      conversation.id,
      { id: agentId, kind: "agent" },
      "/typing",
      c.req.raw,
    );
  },
);

app.get(
  "/internal/v1/projects/:projectId/conversations/:conversationId/ws",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return roomFetch(
      c.env,
      conversation.id,
      { id: agentId, kind: "agent" },
      "/connect",
      c.req.raw,
    );
  },
);

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/attachments",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return storeAttachment(c.env, conversation, agentId, c.req.raw);
  },
);

app.get(
  "/internal/v1/projects/:projectId/conversations/:conversationId/attachments/:messageId",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return attachmentResponse(
      c.env,
      conversation,
      c.req.param("messageId"),
      true,
      c.req.query("attachment_id"),
    );
  },
);

app.patch(
  "/internal/v1/projects/:projectId/conversations/:conversationId",
  async (c) => {
    const projectId = positiveInt(
      c.req.param("projectId"),
      "project_id_invalid",
    );
    const conversation = await projectConversation(
      c.env,
      c.req.param("conversationId"),
      projectId,
    );
    const agentId = c.req.header("X-OpenGrow-Agent-Id") || "";
    if (!agentId)
      throw failure("agent_required", "Agent identity is required", 401);
    const body = await readJsonObject(c.req.raw);
    const status = body.status == null ? null : String(body.status);
    const priority = body.priority == null ? null : String(body.priority);
    const assigned =
      body.assigned_user_id == null
        ? null
        : String(body.assigned_user_id).slice(0, 255);
    const assignedTeam =
      body.assigned_team_id == null
        ? null
        : optionalIdentifier(body.assigned_team_id, "assigned_team_id");
    const inboxId =
      body.inbox_id == null
        ? null
        : optionalIdentifier(body.inbox_id, "inbox_id");
    const snoozedUntil =
      body.snoozed_until == null
        ? null
        : validTimestamp(body.snoozed_until, "snoozed_until");
    const customAttributes =
      body.custom_attributes == null
        ? null
        : validateCustomAttributes(body.custom_attributes);
    const labels =
      body.labels == null
        ? null
        : Array.isArray(body.labels)
          ? [
              ...new Set(
                body.labels
                  .map(String)
                  .map((item) => item.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 20)
          : null;
    if (status && !["open", "pending", "closed"].includes(status))
      throw failure("status_invalid", "Invalid conversation status");
    if (priority && !["low", "normal", "high", "urgent"].includes(priority))
      throw failure("priority_invalid", "Invalid conversation priority");
    if (body.labels != null && !labels)
      throw failure("labels_invalid", "Labels must be an array");
    if (inboxId) await requireEnabledInbox(c.env.DB, projectId, inboxId);
    if (assigned)
      await requireEnabledConfiguration(
        c.env.DB,
        projectId,
        "agent",
        assigned,
        "auth_user_id",
      );
    if (assignedTeam)
      await requireEnabledConfiguration(
        c.env.DB,
        projectId,
        "team",
        assignedTeam,
      );
    await c.env.DB.prepare(
      `
    UPDATE conversations SET
      status = COALESCE(?, status), priority = COALESCE(?, priority),
      assigned_user_id = CASE WHEN ? THEN ? ELSE assigned_user_id END,
      assigned_team_id = CASE WHEN ? THEN ? ELSE assigned_team_id END,
      inbox_id = CASE WHEN ? THEN ? ELSE inbox_id END,
      snoozed_until = CASE WHEN ? THEN ? ELSE snoozed_until END,
      custom_attributes_json = COALESCE(?, custom_attributes_json),
      labels_json = COALESCE(?, labels_json),
      resolved_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHEN ? = 'open' THEN NULL ELSE resolved_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `,
    )
      .bind(
        status,
        priority,
        body.assigned_user_id !== undefined ? 1 : 0,
        assigned,
        body.assigned_team_id !== undefined ? 1 : 0,
        assignedTeam,
        body.inbox_id !== undefined ? 1 : 0,
        inboxId,
        body.snoozed_until !== undefined ? 1 : 0,
        snoozedUntil,
        customAttributes == null ? null : JSON.stringify(customAttributes),
        labels ? JSON.stringify(labels) : null,
        status,
        status,
        conversation.id,
      )
      .run();
    await audit(
      c.env,
      conversation.id,
      projectId,
      "conversation.updated",
      { kind: "agent", id: agentId },
      {
        status,
        priority,
        assigned_user_id: assigned,
        assigned_team_id: assignedTeam,
        inbox_id: inboxId,
        snoozed_until: snoozedUntil,
        custom_attributes: customAttributes,
        labels,
      },
    );
    if (
      body.assigned_user_id !== undefined &&
      assigned &&
      assigned !== conversation.assigned_user_id
    ) {
      await c.env.DB.prepare(
        `
      INSERT INTO support_agent_notifications
        (id, project_id, agent_id, notification_type, title, body, conversation_id, payload_json)
      VALUES (?, ?, ?, 'conversation_assigned', 'Conversation assigned', 'A conversation was assigned to you.', ?, ?)
    `,
      )
        .bind(
          crypto.randomUUID(),
          projectId,
          assigned,
          conversation.id,
          JSON.stringify({ assigned_by: agentId }),
        )
        .run();
    }
    const eventId = `conversation_agent_updated:${conversation.id}:${crypto.randomUUID()}`;
    await runConversationAutomations(
      c.env,
      projectId,
      conversation.id,
      status === "closed"
        ? "conversation_resolved"
        : status === "open"
          ? "conversation_opened"
          : "conversation_updated",
      eventId,
    );
    const updated = await projectConversation(
      c.env,
      conversation.id,
      projectId,
    );
    await publishSupportEvent(
      c.env,
      projectId,
      eventId,
      "conversation.updated",
      {
        conversation_id: conversation.id,
        status: updated.status,
        priority: updated.priority,
        assigned_user_id: updated.assigned_user_id,
        assigned_team_id: updated.assigned_team_id,
        inbox_id: updated.inbox_id,
        labels: updated.labels_json,
      },
    );
    return c.json({ data: updated });
  },
);

app.get("/internal/v1/projects/:projectId/quality", async (c) => {
  const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
  const [csat, conversations, responseTimes] = await Promise.all([
    c.env.DB.prepare(
      `
      SELECT COUNT(*) responses, ROUND(AVG(rating), 2) average_rating,
        SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) satisfied
      FROM support_csat_responses WHERE project_id = ?
    `,
    )
      .bind(projectId)
      .first<Record<string, number>>(),
    c.env.DB.prepare(
      `
      SELECT COUNT(*) total, SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) closed,
        SUM(CASE WHEN status != 'closed' THEN 1 ELSE 0 END) open
      FROM conversations WHERE project_id = ?
    `,
    )
      .bind(projectId)
      .first<Record<string, number>>(),
    c.env.DB.prepare(
      `
      SELECT ROUND(AVG((julianday(first_reply_at) - julianday(created_at)) * 1440), 2) average_first_reply_minutes,
        ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 1440), 2) average_resolution_minutes
      FROM conversations WHERE project_id = ?
    `,
    )
      .bind(projectId)
      .first<Record<string, number | null>>(),
  ]);
  return c.json({
    data: {
      csat: csat || {},
      conversations: conversations || {},
      response_times: responseTimes || {},
    },
  });
});

app.get("/internal/v1/projects/:projectId/audit", async (c) => {
  const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
  const rows = await c.env.DB.prepare(
    `
    SELECT id, event_type action, actor_kind, actor_id, payload_json, created_at, 'conversation' source
      FROM support_audit_events WHERE project_id = ?
    UNION ALL
    SELECT id, action, 'agent' actor_kind, actor_id, payload_json, created_at, resource_type source
      FROM support_operations_audit_events WHERE project_id = ?
    UNION ALL
    SELECT id, action, 'agent' actor_kind, actor_id,
      json_object('webhook_id', webhook_id, 'secret_version', secret_version) payload_json,
      created_at, 'webhook_secret' source
      FROM support_secret_audit_events WHERE project_id = ?
    ORDER BY created_at DESC LIMIT 500
  `,
  )
    .bind(projectId, projectId, projectId)
    .all();
  return c.json({ data: rows.results });
});

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "route_not_found",
        message: "Support route not found",
        retryable: false,
        request_id:
          c.req.header("x-request-id") ||
          c.req.header("cf-ray") ||
          crypto.randomUUID(),
      },
    },
    404,
  ),
);

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId =
    c.req.header("x-request-id") ||
    c.req.header("cf-ray") ||
    crypto.randomUUID();
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "support_request_failed",
        request_id: requestId,
        error: error.message,
      }),
    );
  return c.json(
    {
      error: {
        code: (error as { code?: string }).code || "internal_error",
        message:
          status >= 500 ? "Support is temporarily unavailable" : error.message,
        retryable: status >= 500,
        request_id: requestId,
      },
    },
    status as 400,
  );
});

async function userConversation(
  env: Env,
  id: string,
  subject: string,
  projectId: number,
): Promise<Conversation> {
  const conversation = await env.DB.prepare(
    `
    SELECT id, project_id, external_user_id, status FROM conversations
    WHERE id = ? AND external_user_id = ? AND project_id = ?
  `,
  )
    .bind(id, subject, projectId)
    .first<Conversation>();
  if (!conversation)
    throw failure("conversation_not_found", "Conversation not found", 404);
  return conversation;
}

async function userConversationRecord(
  env: Env,
  id: string,
  subject: string,
  projectId: number,
) {
  const conversation = await env.DB.prepare(
    `
    SELECT * FROM conversations WHERE id = ? AND external_user_id = ? AND project_id = ?
  `,
  )
    .bind(id, subject, projectId)
    .first<Record<string, unknown>>();
  if (!conversation)
    throw failure("conversation_not_found", "Conversation not found", 404);
  return conversation;
}

async function projectConversation(
  env: Env,
  id: string,
  projectId: number,
): Promise<Conversation & Record<string, unknown>> {
  const conversation = await env.DB.prepare(
    "SELECT * FROM conversations WHERE id = ? AND project_id = ?",
  )
    .bind(id, projectId)
    .first<Conversation & Record<string, unknown>>();
  if (!conversation)
    throw failure("conversation_not_found", "Conversation not found", 404);
  return conversation;
}

export async function upsertProjectConversation(
  env: Pick<Env, "DB">,
  projectId: number,
  externalUserId: string,
  clientConversationId: string,
  subject: string | null,
  options: {
    inboxId?: string | null;
    customAttributes?: Record<string, unknown>;
  } = {},
) {
  const id = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `
    INSERT INTO conversations (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, custom_attributes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, external_user_id, client_conversation_id) DO NOTHING
    RETURNING *
  `,
  )
    .bind(
      id,
      projectId,
      externalUserId,
      clientConversationId,
      subject,
      options.inboxId || null,
      JSON.stringify(options.customAttributes || {}),
    )
    .first<Record<string, unknown>>();
  const conversation =
    inserted ||
    (await env.DB.prepare(
      `
    SELECT * FROM conversations WHERE project_id = ? AND external_user_id = ? AND client_conversation_id = ?
  `,
    )
      .bind(projectId, externalUserId, clientConversationId)
      .first<Record<string, unknown>>());
  if (!conversation) throw new Error("Unable to create conversation");
  return { conversation, duplicate: !inserted };
}

function roomFetch(
  env: Env,
  conversationId: string,
  actor: Actor,
  path: string,
  source: Request,
  identityExpiresAt = Date.now() + 15 * 60 * 1000,
) {
  const stub = env.CONVERSATIONS.get(
    env.CONVERSATIONS.idFromName(conversationId),
  );
  const headers = new Headers(source.headers);
  headers.set("x-room-capability", env.INTERNAL_API_TOKEN);
  headers.set("x-conversation-id", conversationId);
  headers.set("x-actor-id", actor.id);
  headers.set("x-actor-kind", actor.kind);
  headers.set("x-identity-expires-at", String(identityExpiresAt));
  headers.delete("authorization");
  return stub.fetch(
    new Request(`https://room.internal${path}`, {
      method: source.method,
      headers,
      body:
        source.method === "GET" || source.method === "HEAD"
          ? null
          : source.body,
    }),
  );
}

async function audit(
  env: Env,
  conversationId: string,
  projectId: number,
  eventType: string,
  actor: Actor,
  payload: unknown,
) {
  await env.DB.prepare(
    `
    INSERT INTO support_audit_events (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      crypto.randomUUID(),
      conversationId,
      projectId,
      eventType,
      actor.kind,
      actor.id,
      JSON.stringify(payload),
    )
    .run();
}

function positiveInt(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw failure(code, "A positive integer is required");
  return parsed;
}

function applicationUserId(value: string): string {
  const resolved = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(resolved)) {
    throw failure(
      "application_user_id_invalid",
      "Application user identifier is invalid",
      422,
    );
  }
  return resolved;
}

function failure(code: string, message: string, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

function requiredAgent(value?: string): string {
  const agentId = String(value || "").trim();
  if (!agentId || agentId.length > 255)
    throw failure("agent_required", "Agent identity is required", 401);
  return agentId;
}

function optionalIdentifier(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const parsed = String(value).trim();
  if (!parsed || parsed.length > 255)
    throw failure(
      `${field}_invalid`,
      `${field} must be at most 255 characters`,
    );
  return parsed;
}

function validTimestamp(value: unknown, field: string) {
  if (value === "") return null;
  const parsed = String(value);
  const date = new Date(parsed);
  if (!parsed || Number.isNaN(date.getTime()))
    throw failure(`${field}_invalid`, `${field} must be an ISO-8601 timestamp`);
  return date.toISOString();
}

function validateCustomAttributes(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value))
    throw failure(
      "custom_attributes_invalid",
      "Custom attributes must be an object",
    );
  const attributes = value as Record<string, unknown>;
  const keys = Object.keys(attributes);
  if (
    keys.length > 50 ||
    keys.some((key) => !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))
  ) {
    throw failure(
      "custom_attributes_invalid",
      "Custom attributes contain too many keys or an invalid key",
    );
  }
  const serialized = JSON.stringify(attributes);
  if (serialized.length > 8000)
    throw failure(
      "custom_attributes_invalid",
      "Custom attributes are limited to 8 KB",
    );
  return JSON.parse(serialized) as Record<string, unknown>;
}

async function requireEnabledInbox(
  db: D1Database,
  projectId: number,
  inboxId: string,
) {
  const row = await db
    .prepare(
      `
    SELECT id FROM support_configuration_entities
    WHERE project_id = ? AND entity_type = 'inbox' AND id = ? AND enabled = 1
  `,
    )
    .bind(projectId, inboxId)
    .first();
  if (!row)
    throw failure(
      "inbox_not_found",
      "Enabled Inbox configuration not found",
      404,
    );
}

async function requireEnabledConfiguration(
  db: D1Database,
  projectId: number,
  type: "agent" | "team",
  value: string,
  configurationKey?: string,
) {
  const row = configurationKey
    ? await db
        .prepare(
          `
      SELECT id FROM support_configuration_entities
      WHERE project_id = ? AND entity_type = ? AND enabled = 1
        AND json_extract(configuration_json, ?) = ?
    `,
        )
        .bind(projectId, type, `$.${configurationKey}`, value)
        .first()
    : await db
        .prepare(
          `
      SELECT id FROM support_configuration_entities
      WHERE project_id = ? AND entity_type = ? AND enabled = 1 AND id = ?
    `,
        )
        .bind(projectId, type, value)
        .first();
  if (!row)
    throw failure(
      `${type}_not_found`,
      `Enabled ${type} configuration not found`,
      404,
    );
}

async function storeAttachment(
  env: Env,
  conversation: Conversation,
  uploaderId: string,
  request: Request,
) {
  const bytes = await readBytesLimited(
    request,
    MAX_ATTACHMENT_BYTES,
    "attachment_too_large",
    "Attachment is limited to 10 MB",
  );
  if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw failure(
      "attachment_invalid",
      "Attachment must contain between 1 byte and 10 MB",
      422,
    );
  }
  const filename = safeFilename(
    request.headers.get("X-Filename") || "attachment",
  );
  const uploaderHash = (await sha256(uploaderId)).slice(0, 24);
  const key = `attachments/${conversation.project_id}/${uploaderHash}/${conversation.id}/${crypto.randomUUID()}/${filename}`;
  const contentType =
    request.headers.get("Content-Type") || "application/octet-stream";
  await env.ATTACHMENTS.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      conversationId: conversation.id,
      uploadedBy: uploaderHash,
    },
  });
  return Response.json(
    { key, filename, content_type: contentType, size: bytes.byteLength },
    { status: 201 },
  );
}

async function attachmentResponse(
  env: Env,
  conversation: Conversation,
  messageId: string,
  allowPrivate: boolean,
  attachmentId?: string,
) {
  const message = await env.DB.prepare(
    `
    SELECT attachment.storage_key AS attachment_key, attachment.file_name AS attachment_name,
      attachment.content_type AS attachment_content_type
    FROM support_message_attachments attachment
    INNER JOIN messages message ON message.id = attachment.message_id
    WHERE message.id = ? AND message.conversation_id = ?
      AND (? = 1 OR message.visibility = 'public')
      AND (? IS NULL OR attachment.id = ?)
    ORDER BY attachment.position ASC LIMIT 1
  `,
  )
    .bind(
      messageId,
      conversation.id,
      allowPrivate ? 1 : 0,
      attachmentId || null,
      attachmentId || null,
    )
    .first<{
      attachment_key: string;
      attachment_name: string | null;
      attachment_content_type: string | null;
    }>();
  if (!message)
    throw failure("attachment_not_found", "Attachment not found", 404);
  const object = await env.ATTACHMENTS.get(message.attachment_key);
  if (!object)
    throw failure("attachment_not_found", "Attachment not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set(
    "Content-Disposition",
    `attachment; filename="${safeFilename(message.attachment_name || "attachment")}"`,
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
  return new Response(object.body, { headers });
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { ConversationRoom };

function contextualInternalRequest(request: Request) {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/internal/v1") ||
    url.pathname === "/internal/v1/health" ||
    url.pathname.startsWith("/internal/v1/projects/")
  )
    return request;
  const projectId = request.headers.get("x-project-id");
  if (!projectId) return request;
  const suffix = url.pathname.slice("/internal/v1".length);
  url.pathname = `/internal/v1/projects/${encodeURIComponent(projectId)}${suffix || "/"}`;
  const headers = new Headers(request.headers);
  if (!headers.has("x-opengrow-agent-id") && headers.has("x-actor-id")) {
    headers.set("x-opengrow-agent-id", headers.get("x-actor-id") || "");
  }
  return new Request(url, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/internal/v1") &&
      url.pathname !== "/internal/v1/health"
    ) {
      try {
        await verifyInternalProjectContext(request, env, "support");
      } catch (error) {
        const status = Number((error as { status?: number }).status || 500);
        const requestId =
          request.headers.get("x-request-id") || crypto.randomUUID();
        return Response.json(
          {
            error: {
              code: (error as { code?: string }).code || "internal_error",
              message:
                status >= 500
                  ? "Support is temporarily unavailable"
                  : error instanceof Error
                    ? error.message
                    : "Request failed",
              retryable: status >= 500,
              request_id: requestId,
            },
          },
          { status },
        );
      }
    }
    return app.fetch(contextualInternalRequest(request), env, ctx);
  },
  queue: handleSupportQueue,
} satisfies ExportedHandler<Env>;
