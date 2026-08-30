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
import native from "./native";
import providers from "./providers";
import { runConversationAutomations } from "./workflows";
import { handleSupportQueue, publishSupportEvent } from "./webhooks";
import { claimSupportNotificationDeliveries } from "./notifications";
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
import {
  requireSupportRole,
  resolveSupportPrincipal,
  supportPrincipalFromHeaders,
  type SupportPrincipal,
  type SupportRole,
} from "./access";
import { verifyWidgetIdentity } from "./widget-auth";
import { semanticArticleMatches } from "./knowledge";
import { decryptCredentialPayload } from "./secrets";
import { readTextLimited } from "@superboard/contracts/request-body";
import {
  initializeConversationPolicies,
  recordSlaResolution,
} from "./service-levels";
import { completeIntegrationOAuth } from "./integration-oauth";

const app = new Hono<{
  Bindings: Env;
  Variables: {
    subject: string;
    identityExpiresAt: number;
    supportPrincipal: SupportPrincipal;
  };
}>();

app.use(
  "*",
  cors({
    origin: (origin, c) => (origin === c.env.CORS_ORIGIN ? origin : undefined),
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "X-OpenGrow-Project-Id",
      "X-SuperBoard-Project-Id",
      "X-SuperBoard-Widget-Key",
      "X-SuperBoard-Widget-Visitor",
      "X-SuperBoard-Widget-Signature",
      "X-SuperBoard-Widget-Timestamp",
      "X-Filename",
      "Idempotency-Key",
    ],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "superboard-support",
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
    { id: ticket.actor_id, kind: ticket.actor_kind },
    "/connect",
    source,
    new Date(ticket.expires_at).getTime(),
  );
});

app.get("/public/v1/providers/:provider/oauth/callback", async (c, next) => {
  const result = await completeIntegrationOAuth(
    c.env,
    c.req.raw,
    c.req.param("provider"),
  );
  if (!result.handled) return next();
  return result.response;
});

app.route("/public/v1/providers", providers);

app.get("/public/v1/help-center/:portalSlug/categories", async (c) => {
  const locale = String(c.req.query("locale") || "").slice(0, 32);
  const portal = await publicPortal(c.env.DB, c.req.param("portalSlug"));
  const rows = await c.env.DB.prepare(
    `SELECT category.* FROM support_portal_categories category
     WHERE category.portal_id = ? AND category.project_id = ? AND category.status = 'published'
     ORDER BY category.position, category.created_at`,
  ).bind(portal.id, portal.project_id).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({ ...row, locale: locale || portal.locale })) });
});

app.get("/public/v1/help-center/:portalSlug/sitemap.xml", async (c) => {
  const portal = await publicPortal(c.env.DB, c.req.param("portalSlug"));
  const rows = await c.env.DB.prepare(`SELECT slug, updated_at FROM support_articles
    WHERE portal_id = ? AND project_id = ? AND status = 'published'
    ORDER BY updated_at DESC LIMIT 50000`).bind(portal.id, portal.project_id)
    .all<{ slug: string; updated_at: string }>();
  const origin = new URL(c.req.url).origin;
  const portalPath = `/api/v1/support/help-center/${encodeURIComponent(String(portal.slug))}`;
  const urls = rows.results.map((row) =>
    `<url><loc>${xmlEscape(`${origin}${portalPath}/articles/${encodeURIComponent(row.slug)}`)}</loc><lastmod>${xmlEscape(row.updated_at)}</lastmod></url>`,
  ).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
});

app.get("/public/v1/help-center/:portalSlug/search", async (c) => {
  const portal = await publicPortal(c.env.DB, c.req.param("portalSlug"));
  const query = String(c.req.query("q") || "").trim();
  if (query.length < 2 || query.length > 500) {
    throw failure("help_center_query_invalid", "Help Center search query must contain between 2 and 500 characters", 422);
  }
  const limit = boundedLimit(c.req.query("limit"));
  const locale = String(c.req.query("locale") || "").slice(0, 32);
  const like = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const rows = await c.env.DB.prepare(
    `SELECT article.id, article.slug,
       COALESCE(translation.title, article.title) title,
       COALESCE(translation.excerpt, article.excerpt) excerpt,
       COALESCE(translation.content, article.content) content,
       COALESCE(translation.locale, ?) locale,
       article.published_at
     FROM support_articles article
     LEFT JOIN support_article_translations translation
       ON translation.article_id = article.id AND translation.locale = ? AND translation.status = 'published'
     WHERE article.portal_id = ? AND article.project_id = ? AND article.status = 'published'
       AND (COALESCE(translation.title, article.title) LIKE ? ESCAPE '\\'
         OR COALESCE(translation.excerpt, article.excerpt, '') LIKE ? ESCAPE '\\'
         OR COALESCE(translation.content, article.content) LIKE ? ESCAPE '\\')
     ORDER BY article.published_at DESC LIMIT ?`,
  ).bind(locale || portal.locale, locale || portal.locale, portal.id, portal.project_id,
    like, like, like, limit).all<Record<string, unknown>>();
  let semanticRows: Record<string, unknown>[] = [];
  try {
    const matches = await semanticArticleMatches(c.env, portal.project_id, query, limit);
    const articleIds = [...new Set(matches.map((match) => match.articleId))];
    if (articleIds.length) {
      const semantic = await c.env.DB.prepare(
        `SELECT article.id, article.slug,
           COALESCE(translation.title, article.title) title,
           COALESCE(translation.excerpt, article.excerpt) excerpt,
           COALESCE(translation.content, article.content) content,
           COALESCE(translation.locale, ?) locale,
           article.published_at
         FROM support_articles article
         LEFT JOIN support_article_translations translation
           ON translation.article_id = article.id AND translation.locale = ? AND translation.status = 'published'
         WHERE article.portal_id = ? AND article.project_id = ? AND article.status = 'published'
           AND article.id IN (${articleIds.map(() => "?").join(", ")})`,
      ).bind(
        locale || portal.locale,
        locale || portal.locale,
        portal.id,
        portal.project_id,
        ...articleIds,
      ).all<Record<string, unknown>>();
      const byId = new Map(semantic.results.map((row) => [String(row.id), row]));
      semanticRows = matches.flatMap((match) => {
        const row = byId.get(match.articleId);
        return row ? [row] : [];
      });
    }
  } catch (error) {
    // Lexical search remains available while AI or the semantic index is
    // temporarily degraded. The public response never exposes model details.
    console.error(JSON.stringify({
      event: "support_knowledge_query_degraded",
      request_id: c.req.header("X-Request-Id") || null,
      project_id: portal.project_id,
      error_code: String((error as { code?: unknown })?.code || "knowledge_query_unavailable"),
    }));
  }
  const combined = new Map<string, Record<string, unknown>>();
  for (const row of [...semanticRows, ...rows.results]) {
    if (!combined.has(String(row.id))) combined.set(String(row.id), row);
    if (combined.size >= limit) break;
  }
  return c.json({ data: [...combined.values()] });
});

app.get("/public/v1/help-center/:portalSlug/articles/:articleSlug", async (c) => {
  const portal = await publicPortal(c.env.DB, c.req.param("portalSlug"));
  const locale = String(c.req.query("locale") || portal.locale).slice(0, 32);
  const article = await c.env.DB.prepare(
    `SELECT article.id, article.slug,
       COALESCE(translation.title, article.title) title,
       COALESCE(translation.excerpt, article.excerpt) excerpt,
       COALESCE(translation.content, article.content) content,
       COALESCE(translation.locale, ?) locale,
       article.published_at, article.updated_at
     FROM support_articles article
     LEFT JOIN support_article_translations translation
       ON translation.article_id = article.id AND translation.locale = ? AND translation.status = 'published'
     WHERE article.portal_id = ? AND article.project_id = ? AND article.slug = ?
       AND article.status = 'published' LIMIT 1`,
  ).bind(locale, locale, portal.id, portal.project_id, c.req.param("articleSlug"))
    .first<Record<string, unknown>>();
  if (!article) throw failure("help_center_article_not_found", "Help Center article not found", 404);
  return c.json({ data: article });
});

app.post("/public/v1/help-center/:portalSlug/articles/:articleSlug/views", async (c) => {
  const portal = await publicPortal(c.env.DB, c.req.param("portalSlug"));
  const article = await c.env.DB.prepare(
    "SELECT id FROM support_articles WHERE portal_id = ? AND project_id = ? AND slug = ? AND status = 'published'",
  ).bind(portal.id, portal.project_id, c.req.param("articleSlug")).first<{ id: string }>();
  if (!article) throw failure("help_center_article_not_found", "Help Center article not found", 404);
  const source = c.req.header("CF-Connecting-IP") || c.req.header("User-Agent") || crypto.randomUUID();
  const id = String(c.req.header("Idempotency-Key") || crypto.randomUUID()).slice(0, 128);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO support_article_views
      (id, project_id, portal_id, article_id, viewer_hash, locale, referrer_host)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, portal.project_id, portal.id, article.id, (await sha256(source)).slice(0, 64),
    String(c.req.query("locale") || portal.locale).slice(0, 32), safeReferrerHost(c.req.header("Referer"))).run();
  return c.json({ data: { recorded: true } }, 201);
});

for (const pattern of ["/public/v1/widget", "/public/v1/widget/*"]) {
  app.all(pattern, async (c) => {
    const identity = await verifyWidgetIdentity(c.env, c.req.raw);
    const source = new URL(c.req.url);
    const prefix = "/public/v1/widget";
    const suffix = source.pathname.slice(prefix.length);
    source.pathname = `/v1${suffix}`;
    const headers = new Headers(c.req.raw.headers);
    headers.delete("authorization");
    headers.delete("cookie");
    headers.set("x-widget-capability", c.env.INTERNAL_API_TOKEN);
    headers.set("x-widget-subject", identity.subject);
    headers.set("x-widget-project-id", String(identity.projectId));
    headers.set("x-widget-identity-expires-at", String(identity.expiresAt));
    headers.set("x-superboard-project-id", String(identity.projectId));
    return app.fetch(new Request(source, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? null : c.req.raw.body,
    }), c.env);
  });
}

app.use("/v1/*", async (c, next) => {
  const widgetCapability = c.req.header("x-widget-capability");
  if (widgetCapability) {
    await requireInternal(c.env, widgetCapability);
    const subject = String(c.req.header("x-widget-subject") || "").trim();
    const expiresAt = Number(c.req.header("x-widget-identity-expires-at"));
    const projectId = Number(c.req.header("x-widget-project-id"));
    if (!subject || subject.length > 255 || !Number.isSafeInteger(projectId) ||
      projectId <= 0 || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw failure("widget_identity_invalid", "Widget identity is invalid", 401);
    }
    c.set("subject", subject);
    c.set("identityExpiresAt", expiresAt);
    await next();
    return;
  }
  const identity = await verifyApplicationIdentity(
    c.env,
    c.req.header("Authorization"),
  );
  c.set("subject", identity.subject);
  c.set("identityExpiresAt", identity.expiresAt);
  await next();
});

app.use("/v1/*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const { projectId, subject } = publicClientContext(c);
  const key = String(c.req.header("Idempotency-Key") || "").trim();
  if (!key || key.length > 200) {
    throw failure(
      "idempotency_key_required",
      "Idempotency-Key is required and limited to 200 characters",
      422,
    );
  }
  const pathname = new URL(c.req.url).pathname;
  const scope = `client:${subject}:${c.req.method}:${pathname}:${key}`;
  const claim = await c.env.DB.prepare(
    `INSERT INTO support_idempotency_keys
      (project_id, key, request_method, request_path, state)
     VALUES (?, ?, ?, ?, 'processing')
     ON CONFLICT(project_id, key) DO NOTHING RETURNING key`,
  ).bind(projectId, scope, c.req.method, pathname).first();
  if (!claim) {
    const existing = await c.env.DB.prepare(
      `SELECT request_method, request_path, response_status, response_body
       FROM support_idempotency_keys WHERE project_id = ? AND key = ?`,
    ).bind(projectId, scope).first<{
      request_method: string;
      request_path: string;
      response_status: number | null;
      response_body: string | null;
    }>();
    if (!existing?.response_status || existing.response_body == null) {
      throw failure(
        "idempotency_in_progress",
        "An identical request is already being processed",
        409,
      );
    }
    return new Response(existing.response_body, {
      status: existing.response_status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "idempotency-replayed": "true",
      },
    });
  }
  try {
    await next();
    if (c.res.status >= 500 || c.res.status === 429) {
      await c.env.DB.prepare(
        "DELETE FROM support_idempotency_keys WHERE project_id = ? AND key = ?",
      ).bind(projectId, scope).run();
      return;
    }
    const responseBody = c.res.status === 204 ? "" : await c.res.clone().text();
    await c.env.DB.prepare(
      `UPDATE support_idempotency_keys SET state = 'completed',
         response_status = ?, response_body = ?,
         completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND key = ?`,
    ).bind(c.res.status, responseBody, projectId, scope).run();
  } catch (error) {
    await c.env.DB.prepare(
      "DELETE FROM support_idempotency_keys WHERE project_id = ? AND key = ?",
    ).bind(projectId, scope).run();
    throw error;
  }
});

app.get("/v1/contact", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  await ensureSupportContact(c.env.DB, projectId, subject);
  const contact = await publicContact(c.env.DB, projectId, subject);
  return c.json({ data: publicContactShape(contact) });
});

app.patch("/v1/contact", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const body = await readJsonObject(c.req.raw);
  const name = body.name == null ? null : String(body.name).trim().slice(0, 255);
  const email = body.email == null ? null : String(body.email).trim().slice(0, 320);
  const phone = body.phone == null ? null : String(body.phone).trim().slice(0, 64);
  const custom = body.custom_attributes == null ? null : validateCustomAttributes(body.custom_attributes);
  await ensureSupportContact(c.env.DB, projectId, subject);
  const contact = await c.env.DB.prepare(
    `UPDATE support_contacts SET name = COALESCE(?, name), email = COALESCE(?, email),
       phone = COALESCE(?, phone), custom_attributes_json = COALESCE(?, custom_attributes_json),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE project_id = ? AND external_user_id = ? RETURNING *`,
  ).bind(name, email, phone, custom == null ? null : JSON.stringify(custom), projectId, subject)
    .first<Record<string, unknown>>();
  return c.json({ data: publicContactShape(contact || {}) });
});

app.post("/v1/events", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const body = await readJsonObject(c.req.raw);
  const name = String(body.name || "").trim();
  const properties = validateCustomAttributes(body.properties || {});
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name)) {
    throw failure("support_event_name_invalid", "Support event name is invalid", 422);
  }
  await ensureSupportContact(c.env.DB, projectId, subject);
  const contact = await publicContact(c.env.DB, projectId, subject);
  const idempotencyKey = String(c.req.header("Idempotency-Key") || "").trim();
  if (!idempotencyKey) throw failure("idempotency_key_required", "Idempotency-Key is required", 422);
  const id = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO support_contact_events
      (id, project_id, contact_id, event_name, properties_json, idempotency_key, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(project_id, idempotency_key) DO NOTHING RETURNING id, event_name, occurred_at`,
  ).bind(id, projectId, contact.id, name, JSON.stringify(properties), idempotencyKey)
    .first<Record<string, unknown>>();
  return c.json({ data: inserted || { id, event_name: name, duplicate: true } }, inserted ? 201 : 200);
});

app.get("/v1/inboxes/:inboxId/members", async (c) => {
  const { projectId } = publicClientContext(c);
  const rows = await c.env.DB.prepare(
    `SELECT membership.id, membership.display_name, membership.availability
     FROM support_memberships membership INNER JOIN support_inbox_members member
       ON member.membership_id = membership.id AND member.project_id = membership.project_id
     WHERE member.project_id = ? AND member.inbox_id = ? AND membership.active = 1
     ORDER BY membership.display_name LIMIT 100`,
  ).bind(projectId, c.req.param("inboxId")).all();
  return c.json({ data: rows.results });
});

app.get("/v1/proactive-support", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const limit = boundedLimit(c.req.query("limit"));
  const rows = await c.env.DB.prepare(
    `SELECT campaign.id, campaign.name, campaign.message, campaign.inbox_id,
       campaign.campaign_type, campaign.started_at
     FROM support_campaigns campaign
     WHERE campaign.project_id = ? AND campaign.status = 'running'
       AND (json_extract(campaign.audience_json, '$.external_user_id') IS NULL
         OR json_extract(campaign.audience_json, '$.external_user_id') = ?)
     ORDER BY campaign.started_at DESC, campaign.id DESC LIMIT ?`,
  ).bind(projectId, subject, limit).all();
  return c.json({ data: rows.results });
});

app.get("/v1/conversations/:conversationId/labels", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const conversation = await userConversation(c.env, c.req.param("conversationId"), subject, projectId);
  const rows = await c.env.DB.prepare(
    `SELECT label.id, label.name, label.color, label.description
     FROM support_labels label INNER JOIN support_conversation_labels linked ON linked.label_id = label.id
     WHERE linked.project_id = ? AND linked.conversation_id = ? AND label.active = 1 ORDER BY label.name`,
  ).bind(projectId, conversation.id).all();
  return c.json({ data: rows.results });
});

app.post("/v1/conversations/:conversationId/transcript", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const conversation = await userConversation(c.env, c.req.param("conversationId"), subject, projectId);
  const messages = await c.env.DB.prepare(
    `SELECT id, sender_kind, body, created_at FROM messages
     WHERE conversation_id = ? AND visibility = 'public' AND deleted_at IS NULL ORDER BY sequence`,
  ).bind(conversation.id).all<Record<string, unknown>>();
  const transcript = messages.results.map((message) =>
    `[${String(message.created_at)}] ${String(message.sender_kind)}: ${String(message.body || "")}`,
  ).join("\n");
  return c.json({ data: { conversation_id: conversation.id, transcript, message_count: messages.results.length } });
});

app.get("/v1/help-center/:portalSlug/categories", (c) =>
  app.fetch(remapPublicPath(c.req.raw, `/public/v1/help-center/${encodeURIComponent(c.req.param("portalSlug"))}/categories`), c.env),
);
app.get("/v1/help-center/:portalSlug/search", (c) =>
  app.fetch(remapPublicPath(c.req.raw, `/public/v1/help-center/${encodeURIComponent(c.req.param("portalSlug"))}/search`), c.env),
);
app.get("/v1/help-center/:portalSlug/articles/:articleSlug", (c) =>
  app.fetch(remapPublicPath(c.req.raw, `/public/v1/help-center/${encodeURIComponent(c.req.param("portalSlug"))}/articles/${encodeURIComponent(c.req.param("articleSlug"))}`), c.env),
);
app.post("/v1/help-center/:portalSlug/articles/:articleSlug/views", (c) =>
  app.fetch(remapPublicPath(c.req.raw, `/public/v1/help-center/${encodeURIComponent(c.req.param("portalSlug"))}/articles/${encodeURIComponent(c.req.param("articleSlug"))}/views`), c.env),
);

app.post("/v1/conversations", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") ||
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
  let conversation =
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
    const initialized = await initializeConversationPolicies(
      c.env.DB,
      projectId,
      String(conversation.id),
      new Date(String(conversation.created_at)),
    );
    await publishPolicyInitializationEvents(
      c.env,
      projectId,
      String(conversation.id),
      initialized,
    );
    conversation = await userConversationRecord(
      c.env,
      String(conversation.id),
      subject,
      projectId,
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
    { data: publicConversationShape(conversation) },
    inserted ? 201 : 200,
  );
});

app.get("/v1/conversations", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const page = await listUserConversations(
    c.env.DB,
    projectId,
    subject,
    c.req.query("cursor"),
    c.req.query("limit"),
  );
  return c.json({
    data: page.data.map(publicConversationShape),
    meta: { next_cursor: page.nextCursor },
  });
});

app.get("/v1/configuration", async (c) => {
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  return c.json({
    data: await getPublicSupportConfiguration(c.env.DB, projectId),
  });
});

app.patch("/v1/conversations/:conversationId", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  const body = await readJsonObject(c.req.raw);
  const status = body.status == null ? null : String(body.status);
  if (status && !["open", "pending", "closed"].includes(status))
    throw failure(
      "status_invalid",
      "Conversation status is invalid",
    );
  const snoozeProvided = Object.hasOwn(body, "snoozed_until");
  const snoozedUntil = !snoozeProvided || body.snoozed_until == null
    ? null
    : String(body.snoozed_until).trim();
  if (snoozedUntil &&
    (!Number.isFinite(Date.parse(snoozedUntil)) || Date.parse(snoozedUntil) <= Date.now())) {
    throw failure(
      "snoozed_until_invalid",
      "Snooze time must be a future timestamp",
    );
  }
  const customAttributes =
    body.custom_attributes == null
      ? null
      : validateCustomAttributes(body.custom_attributes);
  if (status == null && customAttributes == null && !snoozeProvided)
    throw failure(
      "conversation_update_empty",
      "No supported conversation update was provided",
    );
  await c.env.DB.prepare(
    `
    UPDATE conversations SET
      status = COALESCE(?, status),
      custom_attributes_json = COALESCE(?, custom_attributes_json),
      snoozed_until = CASE WHEN ? = 1 THEN ? ELSE snoozed_until END,
      resolved_at = CASE WHEN ? = 'closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHEN ? IN ('open', 'pending') THEN NULL ELSE resolved_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `,
  )
    .bind(
      status,
      customAttributes == null ? null : JSON.stringify(customAttributes),
      snoozeProvided ? 1 : 0,
      snoozedUntil,
      status,
      status,
      conversation.id,
    )
    .run();
  if (status === "closed") {
    const sla = await recordSlaResolution(c.env.DB, projectId, conversation.id);
    if (sla.changed) {
      await publishSupportEvent(
        c.env,
        projectId,
        `sla.resolution:${conversation.id}:${sla.appliedSlaId}`,
        "sla.updated",
        {
          conversation_id: conversation.id,
          applied_sla_id: sla.appliedSlaId,
          target: "resolution",
          status: sla.status,
        },
      );
    }
  }
  await audit(
    c.env,
    conversation.id,
    projectId,
    "conversation.customer_updated",
    { kind: "user", id: subject },
    {
      status,
      custom_attributes: customAttributes,
      ...(snoozeProvided ? { snoozed_until: snoozedUntil } : {}),
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
    custom_attributes: parsePublicObject(updated.custom_attributes_json),
    snoozed_until: updated.snoozed_until,
  });
  return c.json({ data: publicConversationShape(updated) });
});

app.post("/v1/conversations/:conversationId/csat", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
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
  cursorValue?: string,
  limitValue?: string,
) {
  const limit = boundedLimit(limitValue);
  const cursor = decodeActivityCursor(cursorValue);
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
      AND (? IS NULL OR conversation.updated_at < ?
        OR (conversation.updated_at = ? AND conversation.id < ?))
    ORDER BY conversation.updated_at DESC, conversation.id DESC LIMIT ?
  `,
    )
    .bind(
      projectId,
      externalUserId,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    )
    .all<Record<string, unknown>>();
  const data = rows.results.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor: rows.results.length > limit && last
      ? encodeActivityCursor(String(last.updated_at), String(last.id))
      : null,
  };
}

app.get("/v1/conversations/:conversationId/messages", async (c) => {
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    c.get("subject"),
    projectId,
  );
  const cursorSequence = decodeSequenceCursor(c.req.query("cursor"));
  const before = Number(
    c.req.query("before_sequence") || cursorSequence || Number.MAX_SAFE_INTEGER,
  );
  const limit = boundedLimit(c.req.query("limit"));
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
      limit + 1,
    )
    .all<Record<string, unknown>>();
  const descending = rows.results.slice(0, limit);
  const oldest = descending.at(-1);
  return c.json({
    data: descending.reverse().map(publicMessageShape),
    meta: {
      next_cursor: rows.results.length > limit && oldest
        ? encodeSequenceCursor(Number(oldest.sequence))
        : null,
    },
  });
});

app.post("/v1/conversations/:conversationId/messages", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return publicRoomResponse(await roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/messages",
    c.req.raw,
    c.get("identityExpiresAt"),
  ), c.req.header("X-Request-Id"), "message");
});

for (const method of ["PATCH", "DELETE"] as const) {
  app.on(method, "/v1/conversations/:conversationId/messages/:messageId", async (c) => {
    const { projectId, subject } = publicClientContext(c);
    const conversation = await userConversation(
      c.env,
      c.req.param("conversationId"),
      subject,
      projectId,
    );
    return publicRoomResponse(await roomFetch(
      c.env,
      conversation.id,
      { id: subject, kind: "user" },
      `/messages/${encodeURIComponent(c.req.param("messageId"))}`,
      c.req.raw,
      c.get("identityExpiresAt"),
    ), c.req.header("X-Request-Id"), method === "PATCH" ? "message" : "data");
  });
}

app.post("/v1/conversations/:conversationId/read", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return publicRoomResponse(await roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/read",
    c.req.raw,
    c.get("identityExpiresAt"),
  ), c.req.header("X-Request-Id"), "data");
});

app.post("/v1/conversations/:conversationId/typing", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return publicRoomResponse(await roomFetch(
    c.env,
    conversation.id,
    { id: subject, kind: "user" },
    "/typing",
    c.req.raw,
    c.get("identityExpiresAt"),
  ), c.req.header("X-Request-Id"), "data");
});

app.post("/v1/conversations/:conversationId/realtime-ticket", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  const issued = await issueRealtimeTicket(
    c.env,
    projectId,
    conversation.id,
    subject,
    "user",
  );
  return c.json({ data: issued }, 201);
});

app.get("/v1/conversations/:conversationId/ws", async (c) => {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
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
    c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
  );
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  return storeAttachment(c.env, conversation, subject, c.req.raw);
});

app.post("/v1/conversations/:conversationId/meetings", async (c) => {
  const { projectId, subject } = publicClientContext(c);
  const conversation = await userConversation(
    c.env,
    c.req.param("conversationId"),
    subject,
    projectId,
  );
  const body = await readJsonObject(c.req.raw);
  const requestedId = optionalIdentifier(body.meeting_id, "meeting_id");
  const integration = await c.env.DB.prepare(
    `SELECT integration.id, integration.settings_json, credential.encrypted_payload
     FROM support_integrations integration
     INNER JOIN support_integration_credentials credential
       ON credential.integration_id = integration.id AND credential.project_id = integration.project_id
     WHERE integration.project_id = ? AND integration.provider = 'dyte'
       AND status IN ('configured', 'validated', 'live_validated')
     ORDER BY integration.created_at LIMIT 1`,
  )
    .bind(projectId)
    .first<{ id: string; settings_json: string; encrypted_payload: string }>();
  if (!integration) {
    throw failure(
      "configuration_required",
      "Support meeting integration is not configured",
      422,
    );
  }
  const settings = parsePublicObject(integration.settings_json);
  const preset = String(settings.meeting_preset || "").trim();
  const decrypted = await decryptCredentialPayload([
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], integration.encrypted_payload);
  const organizationId = String(decrypted.payload.organization_id || "").trim();
  const apiKey = String(decrypted.payload.api_key || "").trim();
  if (!organizationId || !apiKey || !preset) {
    throw failure("configuration_required", "Support meeting integration is not fully configured", 422);
  }
  const id = requestedId || crypto.randomUUID();
  let providerMeetingId: string;
  if (requestedId) {
    const existing = await c.env.DB.prepare(`SELECT provider_reference FROM support_meetings
      WHERE id = ? AND project_id = ? AND conversation_id = ? AND status IN ('created', 'active')`)
      .bind(requestedId, projectId, conversation.id).first<{ provider_reference: string }>();
    if (!existing?.provider_reference) {
      throw failure("support_meeting_not_found", "Support meeting not found", 404);
    }
    providerMeetingId = existing.provider_reference;
  } else {
    const created = await dyteRequest(organizationId, apiKey, "/meetings", {
      title: "Support meeting",
      record_on_start: false,
      ...(typeof settings.preferred_region === "string" && settings.preferred_region
        ? { preferred_region: settings.preferred_region }
        : {}),
    });
    providerMeetingId = String(created.id || "");
    if (!providerMeetingId) {
      throw failure("support_meeting_unavailable", "Support meeting provider returned an invalid response", 502);
    }
  }
  const contact = await c.env.DB.prepare(`SELECT name FROM support_contacts
    WHERE project_id = ? AND external_user_id = ? LIMIT 1`).bind(projectId, subject)
    .first<{ name: string | null }>();
  const participant = await dyteRequest(
    organizationId,
    apiKey,
    `/meetings/${encodeURIComponent(providerMeetingId)}/participants`,
    {
      name: String(contact?.name || "Support participant").slice(0, 255),
      preset_name: preset,
      client_specific_id: `support:${projectId}:${conversation.id}:${subject}`.slice(0, 255),
    },
  );
  const participantToken = String(participant.token || "");
  if (!participantToken) {
    throw failure("support_meeting_unavailable", "Support meeting participant could not be created", 502);
  }
  const meeting = await c.env.DB.prepare(
    `INSERT INTO support_meetings
      (id, project_id, conversation_id, integration_id, provider, provider_reference, status, created_by)
     VALUES (?, ?, ?, ?, 'dyte', ?, 'active', ?)
     ON CONFLICT(project_id, provider, provider_reference) DO UPDATE SET
       status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') RETURNING *`,
  )
    .bind(id, projectId, conversation.id, integration.id, providerMeetingId, subject)
    .first<Record<string, unknown>>();
  if (!meeting) {
    throw failure(
      "support_meeting_unavailable",
      "Support meeting could not be created",
      503,
    );
  }
  return c.json({
    data: {
      id: meeting.id,
      conversation_id: meeting.conversation_id,
      status: meeting.status,
      participant_token: participantToken,
      created_at: meeting.created_at,
      updated_at: meeting.updated_at,
    },
  }, requestedId ? 200 : 201);
});

app.get(
  "/v1/conversations/:conversationId/attachments/:messageId",
  async (c) => {
    const subject = c.get("subject");
    const projectId = requireProject(
      c.env,
      c.req.header("X-SuperBoard-Project-Id") || c.req.header("X-OpenGrow-Project-Id"),
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
  const url = new URL(c.req.url);
  if (url.pathname === "/internal/v1/health") return next();
  const signed = supportPrincipalFromHeaders(c.req.raw);
  if (signed.role === "application") return next();
  const pathProject = /^\/internal\/v1\/projects\/(\d+)(?:\/|$)/.exec(
    url.pathname,
  );
  if (pathProject && Number(pathProject[1]) !== signed.projectId) {
    throw failure(
      "project_context_mismatch",
      "The requested Support project does not match the signed project context",
      403,
    );
  }
  const principal = await resolveSupportPrincipal(c.env.DB, signed);
  requireSupportRole(principal, minimumSupportRole(c.req.method, url.pathname));
  c.set("supportPrincipal", principal);
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
    if (status >= 500 || status === 429) {
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
app.route("/internal/v1/projects", native);

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
    const initialized = await initializeConversationPolicies(
      c.env.DB,
      projectId,
      String(result.conversation.id),
      new Date(String(result.conversation.created_at)),
    );
    await publishPolicyInitializationEvents(
      c.env,
      projectId,
      String(result.conversation.id),
      initialized,
    );
    result.conversation = await projectConversation(
      c.env,
      String(result.conversation.id),
      projectId,
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

for (const method of ["PATCH", "DELETE"] as const) {
  app.on(
    method,
    "/internal/v1/projects/:projectId/conversations/:conversationId/messages/:messageId",
    async (c) => {
      const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
      const conversation = await projectConversation(c.env, c.req.param("conversationId"), projectId);
      const actorId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
      return roomFetch(
        c.env,
        conversation.id,
        { id: actorId, kind: "agent" },
        `/messages/${encodeURIComponent(c.req.param("messageId"))}`,
        c.req.raw,
      );
    },
  );
}

app.post(
  "/internal/v1/projects/:projectId/conversations/:conversationId/messages/:messageId/retry",
  async (c) => {
    const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
    const conversation = await projectConversation(c.env, c.req.param("conversationId"), projectId);
    const actorId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return roomFetch(
      c.env,
      conversation.id,
      { id: actorId, kind: "agent" },
      `/messages/${encodeURIComponent(c.req.param("messageId"))}/retry`,
      c.req.raw,
    );
  },
);

app.patch(
  "/internal/v1/projects/:projectId/conversations/:conversationId/messages/:messageId/delivery",
  async (c) => {
    const projectId = positiveInt(c.req.param("projectId"), "project_id_invalid");
    const conversation = await projectConversation(c.env, c.req.param("conversationId"), projectId);
    const actorId = requiredAgent(c.req.header("X-OpenGrow-Agent-Id"));
    return roomFetch(
      c.env,
      conversation.id,
      { id: actorId, kind: "system" },
      `/messages/${encodeURIComponent(c.req.param("messageId"))}/delivery`,
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
      "agent",
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
    if (status === "closed") {
      const sla = await recordSlaResolution(c.env.DB, projectId, conversation.id);
      if (sla.changed) {
        await publishSupportEvent(
          c.env,
          projectId,
          `sla.resolution:${conversation.id}:${sla.appliedSlaId}`,
          "sla.updated",
          {
            conversation_id: conversation.id,
            applied_sla_id: sla.appliedSlaId,
            target: "resolution",
            status: sla.status,
          },
        );
      }
    }
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

async function publishPolicyInitializationEvents(
  env: Env,
  projectId: number,
  conversationId: string,
  initialized: Awaited<ReturnType<typeof initializeConversationPolicies>>,
) {
  if (initialized.assignment.assigned) {
    await publishSupportEvent(
      env,
      projectId,
      `assignment.updated:${conversationId}:${initialized.assignment.policyId}`,
      "assignment.updated",
      {
        conversation_id: conversationId,
        policy_id: initialized.assignment.policyId,
        policy_type: initialized.assignment.policyType,
        membership_id: initialized.assignment.membershipId,
        assigned_user_id: initialized.assignment.userId,
        assigned_team_id: initialized.assignment.teamId,
        reason: initialized.assignment.reason,
      },
    );
  }
  if (initialized.sla.applied && initialized.sla.reason === "applied") {
    await publishSupportEvent(
      env,
      projectId,
      `sla.applied:${conversationId}:${initialized.sla.appliedSlaId}`,
      "sla.applied",
      {
        conversation_id: conversationId,
        applied_sla_id: initialized.sla.appliedSlaId,
        policy_id: initialized.sla.policyId,
        first_response_due_at: initialized.sla.firstResponseDueAt,
        resolution_due_at: initialized.sla.resolutionDueAt,
      },
    );
  }
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

function minimumSupportRole(method: string, pathname: string): SupportRole {
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (/\/settings(?:\/|$)/.test(pathname)) return "admin";
  if (
    /\/(?:providers|channels|integrations)(?:\/|$)/.test(pathname) &&
    mutation
  ) {
    return "admin";
  }
  if (
    /\/(?:workforce|teams|memberships|capacity-policies|leave-schedules|automations|sla|reports|captain)(?:\/|$)/.test(
      pathname,
    )
  ) {
    return "supervisor";
  }
  return "agent";
}

function publicClientContext(c: {
  env: Env;
  req: { header(name: string): string | undefined };
  get(name: "subject"): string;
}) {
  const subject = c.get("subject");
  const projectId = requireProject(
    c.env,
    c.req.header("X-SuperBoard-Project-Id") ||
      c.req.header("X-OpenGrow-Project-Id"),
  );
  return { subject, projectId };
}

async function publicContact(
  db: D1Database,
  projectId: number,
  externalUserId: string,
) {
  const row = await db
    .prepare(
      "SELECT * FROM support_contacts WHERE project_id = ? AND external_user_id = ?",
    )
    .bind(projectId, externalUserId)
    .first<Record<string, unknown>>();
  if (!row) throw failure("support_contact_not_found", "Support contact not found", 404);
  return row;
}

function publicContactShape(contact: Record<string, unknown>) {
  let customAttributes: Record<string, unknown> = {};
  try {
    const decoded = JSON.parse(String(contact.custom_attributes_json || "{}"));
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      customAttributes = decoded as Record<string, unknown>;
    }
  } catch {
    // An invalid historical value is normalized to an empty object.
  }
  return {
    id: contact.id,
    external_id: contact.external_user_id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    avatar_url: contact.avatar_url,
    custom_attributes: customAttributes,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
  };
}

function publicConversationShape(conversation: Record<string, unknown>) {
  const status = ["open", "pending", "closed"].includes(String(conversation.status))
    ? String(conversation.status)
    : "open";
  const priority = ["low", "normal", "high", "urgent"].includes(String(conversation.priority))
    ? String(conversation.priority)
    : "normal";
  return {
    id: conversation.id,
    display_id: nullableNumber(conversation.display_id),
    external_id: conversation.external_id ?? null,
    status,
    priority,
    unread_count: Math.max(0, Number(conversation.unread_count || 0)),
    subject: conversation.subject ?? null,
    inbox_id: conversation.inbox_id ?? null,
    assigned_agent_id: conversation.assigned_user_id ?? null,
    assigned_team_id: conversation.assigned_team_id ?? null,
    custom_attributes: parsePublicObject(conversation.custom_attributes_json),
    snoozed_until: conversation.snoozed_until ?? null,
    last_message_preview: conversation.last_message_preview ?? null,
    last_message_at: conversation.last_message_at ?? null,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

function publicMessageShape(message: Record<string, unknown>) {
  const attachments = parsePublicArray(message.attachments_json).map((value) => {
    const attachment = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    return {
      id: attachment.id,
      file_name: attachment.file_name,
      content_type: attachment.content_type,
      byte_size: nullableNumber(attachment.byte_size),
      position: Math.max(0, Number(attachment.position || 0)),
    };
  });
  const delivery = String(message.delivery_status || "");
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    source_id: message.source_id ?? null,
    provider_message_id: message.provider_message_id ?? null,
    sender_kind: message.sender_kind,
    sequence: Math.max(0, Number(message.sequence || 0)),
    body: message.body ?? null,
    attachments,
    visibility: message.visibility || "public",
    content_type: message.content_type || "text",
    reply_to_message_id: message.reply_to_message_id ?? null,
    metadata: parsePublicObject(message.metadata_json),
    ...(["pending", "sent", "delivered", "read", "failed"].includes(delivery)
      ? { delivery_status: delivery }
      : {}),
    created_at: message.created_at,
    updated_at: message.updated_at ?? message.edited_at,
    deleted_at: message.deleted_at ?? null,
  };
}

async function publicRoomResponse(
  response: Response,
  requestId: string | undefined,
  shape: "message" | "data",
) {
  if (!response.headers.get("content-type")?.includes("application/json")) return response;
  const value = await response.clone().json<unknown>();
  if (!response.ok) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const nested = source.error && typeof source.error === "object" &&
      !Array.isArray(source.error)
      ? source.error as Record<string, unknown>
      : source;
    const details = nested.details && typeof nested.details === "object" &&
      !Array.isArray(nested.details)
      ? nested.details as Record<string, unknown>
      : null;
    return Response.json({
      error: {
        code: String(nested.code || "support_request_failed"),
        message: String(nested.message || "Support request failed"),
        retryable: nested.retryable === true,
        ...(requestId || nested.request_id
          ? { request_id: String(requestId || nested.request_id) }
          : {}),
        ...(details ? { details } : {}),
      },
    }, { status: response.status });
  }
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (shape === "message" && source.data && typeof source.data === "object") {
    return Response.json({
      data: publicMessageShape(source.data as Record<string, unknown>),
    }, { status: response.status });
  }
  if (response.status === 204) return new Response(null, { status: 204 });
  return Response.json({ data: source.data ?? source }, { status: response.status });
}

function parsePublicObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parsePublicArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function dyteRequest(
  organizationId: string,
  apiKey: string,
  path: string,
  body: Record<string, unknown>,
) {
  let response: Response;
  try {
    response = await fetch(`https://api.dyte.io/v2${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${organizationId}:${apiKey}`)}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw failure("support_meeting_unavailable", "Support meeting provider is temporarily unavailable", 503);
  }
  const text = await readTextLimited(response, 64_000);
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // Provider response details are intentionally not exposed publicly.
  }
  if (!response.ok || payload.success === false) {
    const status = response.status === 429 || response.status >= 500 ? 503 : 422;
    const code = status === 422 ? "configuration_required" : "support_meeting_unavailable";
    throw failure(code, status === 422
      ? "Support meeting integration rejected its configuration"
      : "Support meeting provider is temporarily unavailable", status);
  }
  const data = payload.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw failure("support_meeting_unavailable", "Support meeting provider returned an invalid response", 502);
  }
  return data as Record<string, unknown>;
}

function nullableNumber(value: unknown): number | null {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}

function encodeActivityCursor(updatedAt: string, id: string) {
  return encodeCursor({ updated_at: updatedAt, id });
}

function decodeActivityCursor(value: string | undefined) {
  if (!value) return null;
  const decoded = decodeCursor(value);
  const updatedAt = String(decoded.updated_at || "");
  const id = String(decoded.id || "");
  if (!Number.isFinite(Date.parse(updatedAt)) || !id || id.length > 255) {
    throw failure("pagination_cursor_invalid", "Pagination cursor is invalid", 422);
  }
  return { updatedAt, id };
}

function encodeSequenceCursor(sequence: number) {
  return encodeCursor({ sequence });
}

function decodeSequenceCursor(value: string | undefined) {
  if (!value) return null;
  const decoded = decodeCursor(value);
  const sequence = Number(decoded.sequence);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw failure("pagination_cursor_invalid", "Pagination cursor is invalid", 422);
  }
  return sequence;
}

function encodeCursor(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeCursor(value: string) {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw failure("pagination_cursor_invalid", "Pagination cursor is invalid", 422);
  }
  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw failure("pagination_cursor_invalid", "Pagination cursor is invalid", 422);
  }
}

async function publicPortal(db: D1Database, slug: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(slug)) {
    throw failure("help_center_portal_not_found", "Help Center portal not found", 404);
  }
  const portals = await db
    .prepare(
      `SELECT id, project_id, slug, locale FROM support_portals
       WHERE lower(slug) = lower(?) AND status = 'published' LIMIT 2`,
    )
    .bind(slug)
    .all<{ id: string; project_id: number; slug: string; locale: string }>();
  // Fail closed if historical data predating the global public-slug index is
  // ambiguous. Never choose an arbitrary project with LIMIT 1.
  if (portals.results.length !== 1) {
    throw failure("help_center_portal_not_found", "Help Center portal not found", 404);
  }
  return portals.results[0];
}

function boundedLimit(value: string | undefined) {
  const limit = value == null || value === "" ? 50 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw failure("pagination_limit_invalid", "limit must be between 1 and 100", 422);
  }
  return limit;
}

function safeReferrerHost(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname.slice(0, 255);
  } catch {
    return null;
  }
}

function remapPublicPath(request: Request, pathname: string) {
  const target = new URL(request.url);
  target.pathname = pathname;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  return new Request(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
  });
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
    SELECT id FROM support_inboxes
    WHERE project_id = ? AND id = ? AND status = 'active'
    LIMIT 1
  `,
    )
    .bind(projectId, inboxId)
    .first();
  if (!row)
    throw failure(
      "inbox_not_found",
      "Active Support inbox not found",
      404,
    );
}

async function requireEnabledConfiguration(
  db: D1Database,
  projectId: number,
  type: "agent" | "team",
  value: string,
  _configurationKey?: string,
) {
  const row = await db
    .prepare(
      `
      SELECT id FROM support_memberships
      WHERE ? = 'agent' AND project_id = ? AND active = 1
        AND (? = auth_user_id OR ? = id)
      UNION ALL
      SELECT id FROM support_teams
      WHERE ? = 'team' AND project_id = ? AND active = 1 AND id = ?
      LIMIT 1
    `,
    )
    .bind(type, projectId, value, value, type, projectId, value)
    .first();
  if (!row)
    throw failure(
      `${type}_not_found`,
      `Active Support ${type} not found`,
      404,
    );
}

async function storeAttachment(
  env: Env,
  conversation: Conversation,
  uploaderId: string,
  request: Request,
) {
  const idempotencyKey = String(request.headers.get("Idempotency-Key") || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw failure("idempotency_key_required", "A valid Idempotency-Key is required", 422);
  }
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
  const contentType =
    request.headers.get("Content-Type") || "application/octet-stream";
  const existing = await env.DB.prepare(
    `SELECT id, storage_key, file_name, content_type, byte_size
     FROM support_attachment_uploads
     WHERE project_id = ? AND conversation_id = ? AND uploader_hash = ?
       AND idempotency_key = ? LIMIT 1`,
  ).bind(conversation.project_id, conversation.id, uploaderHash, idempotencyKey)
    .first<{
      id: string; storage_key: string; file_name: string;
      content_type: string; byte_size: number;
    }>();
  if (existing) {
    if (existing.file_name !== filename || existing.content_type !== contentType ||
      Number(existing.byte_size) !== bytes.byteLength) {
      throw failure("idempotency_conflict", "Idempotency-Key was already used with another attachment", 409);
    }
    if (!(await env.ATTACHMENTS.head(existing.storage_key))) {
      await env.ATTACHMENTS.put(existing.storage_key, bytes, {
        httpMetadata: { contentType },
        customMetadata: { conversationId: conversation.id, uploadedBy: uploaderHash },
      });
    }
    return Response.json({ data: attachmentUploadShape(existing) });
  }
  const uploadId = crypto.randomUUID();
  const key = `attachments/${conversation.project_id}/${uploaderHash}/${conversation.id}/${uploadId}/${filename}`;
  const inserted = await env.DB.prepare(
    `INSERT INTO support_attachment_uploads
      (id, project_id, conversation_id, uploader_hash, idempotency_key,
       storage_key, file_name, content_type, byte_size, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))
     ON CONFLICT(project_id, conversation_id, uploader_hash, idempotency_key)
       DO NOTHING RETURNING id`,
  ).bind(uploadId, conversation.project_id, conversation.id, uploaderHash,
    idempotencyKey, key, filename, contentType, bytes.byteLength).first<{ id: string }>();
  if (!inserted) {
    throw failure("idempotency_conflict", "Attachment upload is already being processed", 409);
  }
  await env.ATTACHMENTS.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      conversationId: conversation.id,
      uploadedBy: uploaderHash,
    },
  });
  return Response.json(
    { data: attachmentUploadShape({
      id: uploadId,
      storage_key: key,
      file_name: filename,
      content_type: contentType,
      byte_size: bytes.byteLength,
    }) },
    { status: 201 },
  );
}

function attachmentUploadShape(upload: {
  id: string;
  storage_key: string;
  file_name: string;
  content_type: string;
  byte_size: number;
}) {
  return {
    id: upload.id,
    key: upload.storage_key,
    filename: upload.file_name,
    content_type: upload.content_type,
    size: Number(upload.byte_size),
  };
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
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(claimScheduledSupportJobs(env));
  },
} satisfies ExportedHandler<Env>;

export async function claimScheduledSupportJobs(env: Env) {
  const notificationDeliveries = await claimSupportNotificationDeliveries(env);
  // A cron invocation can die after claiming a row or after queueing it. Reclaim
  // stale rows instead of leaving the business operation permanently blocked.
  // Queue handlers are required to be idempotent, so a conservative requeue is
  // safer than a lost SLA, campaign, indexation, or report job.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_scheduled_jobs SET status = 'failed', claim_token = NULL,
         claimed_at = NULL, last_error = COALESCE(last_error, 'retry_limit_exceeded'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE status IN ('pending', 'claimed', 'queued') AND attempts >= 8`,
    ),
    env.DB.prepare(
      `UPDATE support_scheduled_jobs SET status = 'pending', claim_token = NULL,
         claimed_at = NULL, due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         last_error = CASE
           WHEN status = 'claimed' THEN 'stale_claim_recovered'
           ELSE 'stale_queue_delivery_recovered'
         END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE attempts < 8 AND (
         (status = 'claimed' AND claimed_at <= datetime('now', '-5 minutes')) OR
         (status = 'queued' AND updated_at <= datetime('now', '-15 minutes'))
       )`,
    ),
  ]);
  const claimToken = crypto.randomUUID();
  const due = await env.DB.prepare(
    `UPDATE support_scheduled_jobs SET status = 'claimed', claim_token = ?,
       claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), attempts = attempts + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id IN (
       SELECT id FROM support_scheduled_jobs WHERE status = 'pending'
         AND due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       ORDER BY due_at LIMIT 100
     ) RETURNING id, project_id, job_type, resource_id, queue_name, payload_json`,
  ).bind(claimToken).all<{
    id: string;
    project_id: number;
    job_type: string;
    resource_id: string;
    queue_name: "events" | "ai" | "bulk";
    payload_json: string;
  }>();
  for (const job of due.results) {
    const queue = job.queue_name === "ai"
      ? env.SUPPORT_AI_QUEUE
      : job.queue_name === "bulk"
        ? env.SUPPORT_BULK_QUEUE
        : env.SUPPORT_QUEUE;
    try {
      const body = scheduledQueueBody(job);
      await queue.send(body, { contentType: "json" });
      await env.DB.prepare(
        `UPDATE support_scheduled_jobs SET status = 'queued', last_error = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND claim_token = ?`,
      ).bind(job.id, claimToken).run();
    } catch (error) {
      await env.DB.prepare(
        `UPDATE support_scheduled_jobs SET status = 'pending', claim_token = NULL,
         claimed_at = NULL, last_error = ?, due_at = datetime('now', '+5 minutes'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND claim_token = ?`,
      ).bind(error instanceof Error ? error.message.slice(0, 1_000) : "queue_unavailable", job.id, claimToken).run();
    }
  }
  const scheduledCampaigns = await env.DB.prepare(
    `SELECT id, project_id FROM support_campaigns WHERE status = 'scheduled'
     AND scheduled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ORDER BY scheduled_at LIMIT 100`,
  ).all<{ id: string; project_id: number }>();
  for (const campaign of scheduledCampaigns.results) {
    await env.SUPPORT_BULK_QUEUE.send({
      type: "support.campaign.dispatch.v1",
      projectId: campaign.project_id,
      campaignId: campaign.id,
    }, { contentType: "json" });
  }
  const dueSlas = await env.DB.prepare(
    `SELECT applied.id, applied.project_id FROM support_applied_slas applied
     WHERE applied.status IN ('active', 'breached') AND (
       (applied.first_response_met_at IS NULL
         AND applied.first_response_due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         AND NOT EXISTS (SELECT 1 FROM support_sla_events event
           WHERE event.applied_sla_id = applied.id AND event.target = 'first_response'
             AND event.event_type IN ('breach', 'cancelled'))) OR
       (applied.next_response_due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         AND NOT EXISTS (SELECT 1 FROM support_sla_events event
           WHERE event.applied_sla_id = applied.id AND event.target = 'next_response'
             AND event.event_type = 'breach')) OR
       (applied.resolution_met_at IS NULL
         AND applied.resolution_due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         AND NOT EXISTS (SELECT 1 FROM support_sla_events event
           WHERE event.applied_sla_id = applied.id AND event.target = 'resolution'
             AND event.event_type = 'breach'))
     ) ORDER BY COALESCE(applied.first_response_due_at,
       applied.next_response_due_at, applied.resolution_due_at), applied.id LIMIT 100`,
  ).all<{ id: string; project_id: number }>();
  for (const sla of dueSlas.results) {
    await env.SUPPORT_QUEUE.send({
      type: "support.sla.evaluate.v1",
      projectId: sla.project_id,
      resourceId: sla.id,
    }, { contentType: "json" });
  }
  return {
    notification_deliveries: notificationDeliveries,
    scheduled_jobs: due.results.length,
    campaigns: scheduledCampaigns.results.length,
    slas: dueSlas.results.length,
  };
}

function scheduledQueueBody(job: {
  id: string;
  project_id: number;
  job_type: string;
  resource_id: string;
  payload_json: string;
}) {
  if (job.job_type === "sla.evaluate") {
    return { type: "support.sla.evaluate.v1", projectId: job.project_id, resourceId: job.resource_id, scheduledJobId: job.id };
  }
  if (job.job_type === "report.rollup") {
    return { type: "support.report.rollup.v1", projectId: job.project_id, resourceId: job.resource_id, scheduledJobId: job.id };
  }
  if (job.job_type === "campaign.dispatch") {
    return { type: "support.campaign.dispatch.v1", projectId: job.project_id, campaignId: job.resource_id, scheduledJobId: job.id };
  }
  if (job.job_type === "knowledge.index") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload_json) as Record<string, unknown>; } catch { /* bounded database value */ }
    return {
      type: "support.knowledge.index.v1",
      projectId: job.project_id,
      sourceType: String(payload.source_type || "article"),
      sourceId: job.resource_id,
      scheduledJobId: job.id,
    };
  }
  if (job.job_type === "captain.task") {
    return {
      type: "support.captain.task.v1",
      projectId: job.project_id,
      taskId: job.resource_id,
      scheduledJobId: job.id,
    };
  }
  if (job.job_type === "workflow.webhook" || job.job_type === "workflow.integration") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload_json) as Record<string, unknown>; } catch { /* bounded database value */ }
    return {
      type: "support.workflow.action.v1",
      projectId: job.project_id,
      resourceId: job.resource_id,
      action: job.job_type === "workflow.webhook" ? "webhook" : "integration",
      target: String(payload.target || ""),
      conversationId: String(payload.conversation_id || ""),
      scheduledJobId: job.id,
    };
  }
  throw failure("scheduled_job_invalid", "Scheduled Support job type is invalid", 422);
}
