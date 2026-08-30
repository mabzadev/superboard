import { Hono } from "hono";
import { readJsonObject } from "./validation";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "./secrets";
import type { Env } from "./types";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import { validateWorkflowConfiguration } from "./workflows";
import {
  nativeIntegrationCredentialState,
  validateNativeIntegrationSettings,
} from "./integrations";
import { startIntegrationOAuth } from "./integration-oauth";

type NativeEnv = Env & {
  SUPPORT_CREDENTIAL_ENCRYPTION_KEY?: string;
  SUPPORT_AI_QUEUE?: Queue;
  SUPPORT_BULK_QUEUE?: Queue;
};

type FieldKind = "text" | "integer" | "boolean" | "json" | "timestamp" | "enum";
type Field = {
  column?: string;
  kind: FieldKind;
  required?: boolean;
  nullable?: boolean;
  max?: number;
  values?: readonly string[];
  createOnly?: boolean;
};
type Resource = {
  path: string;
  table: string;
  fields: Record<string, Field>;
  actorColumn?: string;
  searchColumns?: string[];
  redactColumns?: string[];
};

const PROVIDERS = [
  "widget",
  "api",
  "email_google",
  "email_microsoft",
  "smtp",
  "whatsapp_cloud",
  "facebook_messenger",
  "instagram",
  "twilio_sms",
  "twilio_voice",
  "whatsapp_calls",
  "telegram",
  "line",
  "tiktok",
  "twitter",
  "slack",
  "linear",
  "notion",
  "shopify",
  "dyte",
  "webhook",
] as const;

const resources: Resource[] = [
  {
    path: "workforce/memberships",
    table: "support_memberships",
    searchColumns: ["display_name", "auth_user_id"],
    fields: {
      auth_user_id: { kind: "text", required: true, max: 255, createOnly: true },
      display_name: { kind: "text", required: true, max: 255 },
      role: { kind: "enum", required: true, values: ["supervisor", "agent"] },
      availability: { kind: "enum", values: ["online", "busy", "offline"] },
      active: { kind: "boolean" },
      capacity: { kind: "integer", max: 10_000 },
      auto_offline: { kind: "boolean" },
    },
  },
  {
    path: "workforce/teams",
    table: "support_teams",
    searchColumns: ["name", "description"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      description: { kind: "text", nullable: true, max: 2_000 },
      allow_auto_assign: { kind: "boolean" },
      active: { kind: "boolean" },
    },
  },
  {
    path: "workforce/inboxes",
    table: "support_inboxes",
    searchColumns: ["name", "identifier", "channel_type"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      identifier: { kind: "text", required: true, max: 128 },
      channel_type: { kind: "enum", required: true, values: PROVIDERS },
      status: { kind: "enum", values: ["active", "disabled", "degraded"] },
      auto_assignment: { kind: "boolean" },
      allow_reopen: { kind: "boolean" },
      csat_enabled: { kind: "boolean" },
      settings: { column: "settings_json", kind: "json", max: 32_000 },
    },
  },
  {
    path: "workforce/capacity-policies",
    table: "support_capacity_policies",
    searchColumns: ["name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      default_capacity: { kind: "integer", required: true, max: 10_000 },
      priority_limits: { column: "priority_limits_json", kind: "json", max: 8_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "workforce/leave-schedules",
    table: "support_leave_schedules",
    actorColumn: "created_by",
    fields: {
      membership_id: { kind: "text", required: true, max: 255 },
      starts_at: { kind: "timestamp", required: true },
      ends_at: { kind: "timestamp", required: true },
      reason: { kind: "text", nullable: true, max: 1_000 },
    },
  },
  {
    path: "labels",
    table: "support_labels",
    searchColumns: ["name", "description"],
    fields: {
      name: { kind: "text", required: true, max: 64 },
      color: { kind: "text", max: 16 },
      description: { kind: "text", nullable: true, max: 1_000 },
      show_on_sidebar: { kind: "boolean" },
      active: { kind: "boolean" },
    },
  },
  {
    path: "custom-attributes",
    table: "support_custom_attribute_definitions",
    fields: {
      attribute_key: { kind: "text", required: true, max: 64 },
      model: { kind: "enum", required: true, values: ["contact", "conversation"] },
      value_type: { kind: "enum", required: true, values: ["text", "number", "date", "boolean", "list", "link"] },
      description: { kind: "text", nullable: true, max: 1_000 },
      allowed_values: { column: "allowed_values_json", kind: "json", max: 8_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "segments",
    table: "support_segments",
    actorColumn: "created_by",
    searchColumns: ["name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      model: { kind: "enum", required: true, values: ["contact", "conversation"] },
      query: { column: "query_json", kind: "json", required: true, max: 16_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "providers",
    table: "support_provider_endpoints",
    searchColumns: ["provider", "display_name"],
    fields: {
      inbox_id: { kind: "text", required: true, max: 255 },
      provider: { kind: "enum", required: true, values: PROVIDERS, createOnly: true },
      display_name: { kind: "text", required: true, max: 255 },
      status: { kind: "enum", values: ["configuration_required", "configured", "validated", "degraded", "live_validated", "disabled"] },
      settings: { column: "settings_json", kind: "json", max: 32_000 },
    },
  },
  {
    path: "integrations",
    table: "support_integrations",
    searchColumns: ["provider", "display_name"],
    fields: {
      provider: { kind: "enum", required: true, values: PROVIDERS, createOnly: true },
      display_name: { kind: "text", required: true, max: 255 },
      status: { kind: "enum", values: ["configuration_required", "configured", "validated", "degraded", "live_validated", "disabled"] },
      settings: { column: "settings_json", kind: "json", max: 32_000 },
    },
  },
  {
    path: "automations",
    table: "support_automation_rules",
    actorColumn: "created_by",
    searchColumns: ["name", "event_name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      event_name: { kind: "text", required: true, max: 128 },
      condition_mode: { kind: "enum", values: ["all", "any"] },
      conditions: { column: "conditions_json", kind: "json", max: 32_000 },
      actions: { column: "actions_json", kind: "json", required: true, max: 32_000 },
      position: { kind: "integer", max: 100_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "macros",
    table: "support_macros",
    actorColumn: "created_by",
    searchColumns: ["name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      actions: { column: "actions_json", kind: "json", required: true, max: 32_000 },
      position: { kind: "integer", max: 100_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "canned-responses",
    table: "support_canned_responses",
    actorColumn: "created_by",
    searchColumns: ["name", "content", "shortcut"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      content: { kind: "text", required: true, max: 64_000 },
      shortcut: { kind: "text", nullable: true, max: 64 },
      position: { kind: "integer", max: 100_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "assignment-policies",
    table: "support_assignment_policies",
    searchColumns: ["name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      policy_type: { kind: "enum", required: true, values: ["round_robin", "balanced", "manual"] },
      queue_order: { kind: "enum", values: ["oldest", "priority", "recent"] },
      max_assignments_per_agent: { kind: "integer", nullable: true, max: 10_000 },
      inbox_ids: { column: "inbox_ids_json", kind: "json", max: 16_000 },
      team_ids: { column: "team_ids_json", kind: "json", max: 16_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "sla/working-hours",
    table: "support_working_hours",
    fields: {
      inbox_id: { kind: "text", nullable: true, max: 255 },
      timezone: { kind: "text", required: true, max: 128 },
      weekly_schedule: { column: "weekly_schedule_json", kind: "json", required: true, max: 32_000 },
      closed_dates: { column: "closed_dates_json", kind: "json", max: 16_000 },
      unavailable_message: { kind: "text", nullable: true, max: 2_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "sla/policies",
    table: "support_sla_policies",
    searchColumns: ["name"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      first_response_minutes: { kind: "integer", required: true, max: 525_600 },
      next_response_minutes: { kind: "integer", nullable: true, max: 525_600 },
      resolution_minutes: { kind: "integer", required: true, max: 525_600 },
      business_hours_only: { kind: "boolean" },
      conditions: { column: "conditions_json", kind: "json", max: 32_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "proactive-support/campaigns",
    table: "support_campaigns",
    actorColumn: "created_by",
    searchColumns: ["name", "message"],
    fields: {
      inbox_id: { kind: "text", required: true, max: 255 },
      name: { kind: "text", required: true, max: 255 },
      campaign_type: { kind: "enum", required: true, values: ["one_off", "ongoing"] },
      message: { kind: "text", required: true, max: 8_000 },
      audience: { column: "audience_json", kind: "json", required: true, max: 32_000 },
      scheduled_at: { kind: "timestamp", nullable: true },
    },
  },
  {
    path: "help-center/portals",
    table: "support_portals",
    actorColumn: "created_by",
    searchColumns: ["name", "slug"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      slug: { kind: "text", required: true, max: 128 },
      locale: { kind: "text", max: 32 },
      status: { kind: "enum", values: ["draft", "published", "disabled"] },
      custom_domain: { kind: "text", nullable: true, max: 255 },
      settings: { column: "settings_json", kind: "json", max: 32_000 },
    },
  },
  {
    path: "help-center/categories",
    table: "support_portal_categories",
    searchColumns: ["name", "slug"],
    fields: {
      portal_id: { kind: "text", required: true, max: 255 },
      name: { kind: "text", required: true, max: 255 },
      slug: { kind: "text", required: true, max: 128 },
      description: { kind: "text", nullable: true, max: 2_000 },
      position: { kind: "integer", max: 100_000 },
      status: { kind: "enum", values: ["draft", "published", "archived"] },
    },
  },
  {
    path: "help-center/folders",
    table: "support_portal_folders",
    searchColumns: ["name", "slug"],
    fields: {
      portal_id: { kind: "text", required: true, max: 255 },
      category_id: { kind: "text", required: true, max: 255 },
      name: { kind: "text", required: true, max: 255 },
      slug: { kind: "text", required: true, max: 128 },
      description: { kind: "text", nullable: true, max: 2_000 },
      position: { kind: "integer", max: 100_000 },
      status: { kind: "enum", values: ["draft", "published", "archived"] },
    },
  },
  {
    path: "help-center/articles",
    table: "support_articles",
    searchColumns: ["title", "slug", "excerpt", "content"],
    fields: {
      portal_id: { kind: "text", required: true, max: 255 },
      category_id: { kind: "text", nullable: true, max: 255 },
      folder_id: { kind: "text", nullable: true, max: 255 },
      title: { kind: "text", required: true, max: 255 },
      slug: { kind: "text", required: true, max: 128 },
      excerpt: { kind: "text", nullable: true, max: 2_000 },
      content: { kind: "text", required: true, max: 250_000 },
      status: { kind: "enum", values: ["draft", "published", "archived"] },
      author_id: { kind: "text", max: 255 },
    },
  },
  {
    path: "help-center/translations",
    table: "support_article_translations",
    actorColumn: "translated_by",
    fields: {
      article_id: { kind: "text", required: true, max: 255 },
      locale: { kind: "text", required: true, max: 32 },
      title: { kind: "text", required: true, max: 255 },
      excerpt: { kind: "text", nullable: true, max: 2_000 },
      content: { kind: "text", required: true, max: 250_000 },
      status: { kind: "enum", values: ["draft", "published"] },
    },
  },
  {
    path: "captain/assistants",
    table: "support_assistants",
    actorColumn: "created_by",
    searchColumns: ["name", "description"],
    fields: {
      name: { kind: "text", required: true, max: 255 },
      description: { kind: "text", nullable: true, max: 2_000 },
      instructions: { kind: "text", required: true, max: 32_000 },
      response_mode: { kind: "enum", values: ["suggestion", "draft", "automatic"] },
      handoff_enabled: { kind: "boolean" },
      active: { kind: "boolean" },
    },
  },
  {
    path: "captain/scenarios",
    table: "support_assistant_scenarios",
    searchColumns: ["name"],
    fields: {
      assistant_id: { kind: "text", required: true, max: 255 },
      name: { kind: "text", required: true, max: 255 },
      trigger: { column: "trigger_json", kind: "json", max: 16_000 },
      instructions: { kind: "text", required: true, max: 32_000 },
      position: { kind: "integer", max: 100_000 },
      active: { kind: "boolean" },
    },
  },
  {
    path: "captain/tools",
    table: "support_assistant_tools",
    actorColumn: "created_by",
    redactColumns: ["headers_json"],
    searchColumns: ["name", "description"],
    fields: {
      assistant_id: { kind: "text", required: true, max: 255 },
      name: { kind: "text", required: true, max: 255 },
      description: { kind: "text", required: true, max: 2_000 },
      endpoint_url: { kind: "text", required: true, max: 2_048 },
      method: { kind: "enum", required: true, values: ["GET", "POST"] },
      input_schema: { column: "input_schema_json", kind: "json", max: 32_000 },
      headers: { column: "headers_json", kind: "json", max: 16_000 },
      allowed: { kind: "boolean" },
    },
  },
];

const native = new Hono<{ Bindings: NativeEnv }>();

for (const resource of resources) {
  native.get(`/:projectId/${resource.path}`, async (c) => {
    const projectId = projectIdFrom(c.req.param("projectId"));
    const page = cursorRequest(c.req.query("cursor"), c.req.query("limit"));
    const query = String(c.req.query("q") || "").trim().slice(0, 255);
    const clauses = ["project_id = ?"];
    const bindings: unknown[] = [projectId];
    if (query && resource.searchColumns?.length) {
      clauses.push(`(${resource.searchColumns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      const pattern = `%${escapeLike(query)}%`;
      bindings.push(...resource.searchColumns.map(() => pattern));
    }
    if (page.cursor) {
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(page.cursor.createdAt, page.cursor.createdAt, page.cursor.id);
    }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM ${resource.table} WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
      .bind(...bindings, page.limit + 1)
      .all<Record<string, unknown>>();
    const hasMore = rows.results.length > page.limit;
    const selected = rows.results.slice(0, page.limit).map((row) => serializeRow(resource, row));
    const last = rows.results[Math.min(rows.results.length, page.limit) - 1];
    return c.json({
      data: selected,
      pagination: {
        limit: page.limit,
        has_more: hasMore,
        next_cursor: hasMore && last ? encodeCursor(String(last.created_at), String(last.id)) : null,
      },
    });
  });

  native.get(`/:projectId/${resource.path}/:id`, async (c) => {
    const row = await resourceRow(c.env.DB, resource, projectIdFrom(c.req.param("projectId")), c.req.param("id"));
    return c.json({ data: serializeRow(resource, row) });
  });

  native.post(`/:projectId/${resource.path}`, async (c) => {
    const projectId = projectIdFrom(c.req.param("projectId"));
    const body = await readJsonObject(c.req.raw);
    validateNativeResourceBody(resource.path, body, true);
    const fields = mutationFields(resource, body, true);
    if (resource.path === "providers") {
      await validateProviderInbox(
        c.env.DB,
        projectId,
        body.inbox_id,
        body.provider,
      );
    }
    const id = crypto.randomUUID();
    if (resource.path === "providers" && body.provider === "api") {
      // The API channel uses the signed application identity contract and has
      // no external credential or smoke to perform. This state is assigned by
      // Support itself, never trusted from the CRUD request.
      fields.set("status", "configured");
    }
    if (resource.path === "integrations" && body.provider === "api") {
      fields.set("status", "configured");
    }
    if (resource.actorColumn) fields.set(resource.actorColumn, actorId(c.req.raw));
    const columns = ["id", "project_id", ...fields.keys()];
    const values = [id, projectId, ...fields.values()];
    const row = await c.env.DB.prepare(
      `INSERT INTO ${resource.table} (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`,
    )
      .bind(...values)
      .first<Record<string, unknown>>();
    if (!row) throw failure("support_resource_create_failed", "Support resource could not be created", 500);
    await audit(c.env.DB, projectId, resource.path, id, "created", actorId(c.req.raw));
    await enqueueCreatedResource(c.env, resource.path, projectId, id, row);
    return c.json({ data: serializeRow(resource, row) }, 201);
  });

  native.patch(`/:projectId/${resource.path}/:id`, async (c) => {
    const projectId = projectIdFrom(c.req.param("projectId"));
    const id = identifier(c.req.param("id"));
    const body = await readJsonObject(c.req.raw);
    validateNativeResourceBody(resource.path, body, false);
    if (resource.path === "providers" && body.inbox_id !== undefined) {
      const endpoint = await c.env.DB.prepare(`SELECT provider
        FROM support_provider_endpoints WHERE id = ? AND project_id = ?`)
        .bind(id, projectId).first<{ provider: string }>();
      if (!endpoint) throw failure("support_resource_not_found", "Support resource not found", 404);
      await validateProviderInbox(
        c.env.DB,
        projectId,
        body.inbox_id,
        endpoint.provider,
      );
    }
    const fields = mutationFields(resource, body, false);
    if (fields.size === 0) throw failure("support_resource_update_empty", "At least one mutable field is required", 422);
    const assignments = [...fields.keys()].map((column) => `${column} = ?`);
    assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    const row = await c.env.DB.prepare(
      `UPDATE ${resource.table} SET ${assignments.join(", ")}
       WHERE id = ? AND project_id = ? RETURNING *`,
    )
      .bind(...fields.values(), id, projectId)
      .first<Record<string, unknown>>();
    if (!row) throw failure("support_resource_not_found", "Support resource not found", 404);
    await audit(c.env.DB, projectId, resource.path, id, "updated", actorId(c.req.raw));
    await enqueueCreatedResource(c.env, resource.path, projectId, id, row);
    return c.json({ data: serializeRow(resource, row) });
  });

  native.delete(`/:projectId/${resource.path}/:id`, async (c) => {
    const projectId = projectIdFrom(c.req.param("projectId"));
    const id = identifier(c.req.param("id"));
    const knowledge = resource.path === "help-center/articles"
      ? await c.env.DB.prepare(`SELECT id, chunk_count FROM support_knowledge_documents
          WHERE project_id = ? AND source_type = 'article' AND source_id = ?`)
        .bind(projectId, id).first<{ id: string; chunk_count: number }>()
      : null;
    const result = await c.env.DB.prepare(`DELETE FROM ${resource.table} WHERE id = ? AND project_id = ?`)
      .bind(id, projectId)
      .run();
    if (!result.meta.changes) throw failure("support_resource_not_found", "Support resource not found", 404);
    await audit(c.env.DB, projectId, resource.path, id, "deleted", actorId(c.req.raw));
    if (knowledge) {
      const vectorIds = Array.from({ length: knowledge.chunk_count }, (_, index) => `${knowledge.id}:${index}`);
      for (let index = 0; index < vectorIds.length; index += 100) {
        await c.env.SUPPORT_KNOWLEDGE.deleteByIds(vectorIds.slice(index, index + 100));
      }
      await c.env.DB.prepare(`UPDATE support_knowledge_documents SET status = 'deleted', chunk_count = 0,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
        .bind(knowledge.id, projectId).run();
    }
    return c.json({ data: { id, deleted: true } });
  });
}

function validateNativeResourceBody(
  path: string,
  body: Record<string, unknown>,
  creating: boolean,
) {
  if ((path === "providers" || path === "integrations") && body.status !== undefined) {
    const status = String(body.status);
    if (!["configuration_required", "degraded", "disabled"].includes(status)) {
      throw failure(
        "support_status_managed",
        "Configured and validated states are managed by credential, OAuth, inbound-event, and diagnostic flows",
        422,
      );
    }
  }
  if (path === "automations") {
    if (!creating && body.actions === undefined && body.conditions === undefined) return;
    validateWorkflowConfiguration("automation_rule", {
      conditions: body.conditions ?? [],
      actions: body.actions ?? [{ type: "set_status", value: "open" }],
    });
  } else if (path === "macros") {
    if (!creating && body.actions === undefined) return;
    validateWorkflowConfiguration("macro", { actions: body.actions });
  } else if (path === "captain/tools") {
    if (body.endpoint_url !== undefined && !isSafePublicHttpsUrl(String(body.endpoint_url || ""))) {
      throw failure("support_tool_endpoint_invalid", "Assistant tool endpoint must use public HTTPS", 422);
    }
    if (body.headers !== undefined) {
      const headers = body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
        ? body.headers as Record<string, unknown>
        : null;
      if (!headers || Object.keys(headers).some((name) => !["accept", "content-type"].includes(name.toLowerCase()))) {
        throw failure("support_tool_headers_invalid", "Assistant tools accept only non-sensitive content headers", 422);
      }
    }
  }
}

native.get("/:projectId/workforce", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const [memberships, teams, inboxes, activeAssignments, leaves] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT role, availability, active, COUNT(*) count FROM support_memberships WHERE project_id = ? GROUP BY role, availability, active").bind(projectId),
    c.env.DB.prepare("SELECT COUNT(*) count FROM support_teams WHERE project_id = ? AND active = 1").bind(projectId),
    c.env.DB.prepare("SELECT COUNT(*) count FROM support_inboxes WHERE project_id = ? AND status = 'active'").bind(projectId),
    c.env.DB.prepare("SELECT assigned_user_id, COUNT(*) count FROM conversations WHERE project_id = ? AND status != 'closed' AND assigned_user_id IS NOT NULL GROUP BY assigned_user_id").bind(projectId),
    c.env.DB.prepare("SELECT COUNT(*) count FROM support_leave_schedules WHERE project_id = ? AND starts_at <= datetime('now') AND ends_at > datetime('now')").bind(projectId),
  ]);
  return c.json({ data: {
    memberships: memberships.results,
    active_teams: Number((teams.results[0] as Record<string, unknown>)?.count || 0),
    active_inboxes: Number((inboxes.results[0] as Record<string, unknown>)?.count || 0),
    assignments: activeAssignments.results,
    active_leaves: Number((leaves.results[0] as Record<string, unknown>)?.count || 0),
  } });
});

native.get("/:projectId/workforce/teams/:teamId/members", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const teamId = identifier(c.req.param("teamId"));
  await activeWorkforceResource(c.env.DB, "support_teams", projectId, teamId);
  const rows = await c.env.DB.prepare(`SELECT membership.id, membership.auth_user_id,
      membership.display_name, membership.role, membership.availability, membership.active
    FROM support_team_members linked
    INNER JOIN support_memberships membership
      ON membership.id = linked.membership_id AND membership.project_id = linked.project_id
    WHERE linked.project_id = ? AND linked.team_id = ?
    ORDER BY membership.display_name, membership.id`).bind(projectId, teamId).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({ ...row, active: Boolean(row.active) })) });
});

native.put("/:projectId/workforce/teams/:teamId/members/:membershipId", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const teamId = identifier(c.req.param("teamId"));
  const membershipId = identifier(c.req.param("membershipId"));
  await Promise.all([
    activeWorkforceResource(c.env.DB, "support_teams", projectId, teamId),
    activeWorkforceResource(c.env.DB, "support_memberships", projectId, membershipId),
  ]);
  await c.env.DB.prepare(`INSERT INTO support_team_members
      (project_id, team_id, membership_id) VALUES (?, ?, ?)
    ON CONFLICT(team_id, membership_id) DO NOTHING`).bind(projectId, teamId, membershipId).run();
  await audit(c.env.DB, projectId, "workforce/team-members", `${teamId}:${membershipId}`, "linked", actorId(c.req.raw));
  return c.json({ data: { team_id: teamId, membership_id: membershipId, linked: true } });
});

native.delete("/:projectId/workforce/teams/:teamId/members/:membershipId", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const teamId = identifier(c.req.param("teamId"));
  const membershipId = identifier(c.req.param("membershipId"));
  const result = await c.env.DB.prepare(`DELETE FROM support_team_members
    WHERE project_id = ? AND team_id = ? AND membership_id = ?`)
    .bind(projectId, teamId, membershipId).run();
  if (!result.meta.changes) throw failure("support_team_member_not_found", "Support team member not found", 404);
  await audit(c.env.DB, projectId, "workforce/team-members", `${teamId}:${membershipId}`, "unlinked", actorId(c.req.raw));
  return c.json({ data: { team_id: teamId, membership_id: membershipId, linked: false } });
});

native.get("/:projectId/workforce/inboxes/:inboxId/members", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const inboxId = identifier(c.req.param("inboxId"));
  await activeWorkforceResource(c.env.DB, "support_inboxes", projectId, inboxId);
  const rows = await c.env.DB.prepare(`SELECT membership.id, membership.auth_user_id,
      membership.display_name, membership.role, membership.availability, membership.active
    FROM support_inbox_members linked
    INNER JOIN support_memberships membership
      ON membership.id = linked.membership_id AND membership.project_id = linked.project_id
    WHERE linked.project_id = ? AND linked.inbox_id = ?
    ORDER BY membership.display_name, membership.id`).bind(projectId, inboxId).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({ ...row, active: Boolean(row.active) })) });
});

native.put("/:projectId/workforce/inboxes/:inboxId/members/:membershipId", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const inboxId = identifier(c.req.param("inboxId"));
  const membershipId = identifier(c.req.param("membershipId"));
  await Promise.all([
    activeWorkforceResource(c.env.DB, "support_inboxes", projectId, inboxId),
    activeWorkforceResource(c.env.DB, "support_memberships", projectId, membershipId),
  ]);
  await c.env.DB.prepare(`INSERT INTO support_inbox_members
      (project_id, inbox_id, membership_id) VALUES (?, ?, ?)
    ON CONFLICT(inbox_id, membership_id) DO NOTHING`).bind(projectId, inboxId, membershipId).run();
  await audit(c.env.DB, projectId, "workforce/inbox-members", `${inboxId}:${membershipId}`, "linked", actorId(c.req.raw));
  return c.json({ data: { inbox_id: inboxId, membership_id: membershipId, linked: true } });
});

native.delete("/:projectId/workforce/inboxes/:inboxId/members/:membershipId", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const inboxId = identifier(c.req.param("inboxId"));
  const membershipId = identifier(c.req.param("membershipId"));
  const result = await c.env.DB.prepare(`DELETE FROM support_inbox_members
    WHERE project_id = ? AND inbox_id = ? AND membership_id = ?`)
    .bind(projectId, inboxId, membershipId).run();
  if (!result.meta.changes) throw failure("support_inbox_member_not_found", "Support inbox member not found", 404);
  await audit(c.env.DB, projectId, "workforce/inbox-members", `${inboxId}:${membershipId}`, "unlinked", actorId(c.req.raw));
  return c.json({ data: { inbox_id: inboxId, membership_id: membershipId, linked: false } });
});

native.get("/:projectId/channels", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const rows = await c.env.DB.prepare(
    `SELECT inbox.*, endpoint.id endpoint_id, endpoint.provider, endpoint.display_name provider_display_name,
      endpoint.status provider_status, endpoint.last_validated_at, endpoint.last_event_at, endpoint.last_error_code
     FROM support_inboxes inbox LEFT JOIN support_provider_endpoints endpoint
       ON endpoint.inbox_id = inbox.id AND endpoint.project_id = inbox.project_id
     WHERE inbox.project_id = ? ORDER BY inbox.created_at DESC`,
  ).bind(projectId).all();
  return c.json({ data: rows.results });
});

native.put("/:projectId/providers/:id/credentials", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const endpointId = identifier(c.req.param("id"));
  const endpoint = await c.env.DB.prepare(
    "SELECT id, provider FROM support_provider_endpoints WHERE id = ? AND project_id = ?",
  ).bind(endpointId, projectId).first<{ id: string; provider: string }>();
  if (!endpoint) throw failure("support_provider_not_found", "Support provider endpoint not found", 404);
  const body = await readJsonObject(c.req.raw);
  const credentials = body.credentials;
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw failure("support_provider_credentials_invalid", "Credentials must be an object", 422);
  }
  validateProviderCredentials(endpoint.provider, credentials as Record<string, unknown>);
  const widgetKeyHash = endpoint.provider === "widget"
    ? await sha256(String((credentials as Record<string, unknown>).widget_key))
    : null;
  const widgetDomains = endpoint.provider === "widget"
    ? (Array.isArray((credentials as Record<string, unknown>).allowed_domains)
        ? (credentials as Record<string, unknown>).allowed_domains as unknown[]
        : String((credentials as Record<string, unknown>).allowed_domains || "").split(","))
      .map((domain) => String(domain).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 100)
    : [];
  if (widgetKeyHash) {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM support_provider_endpoints
       WHERE provider = 'widget' AND id != ?
         AND json_extract(settings_json, '$.widget_key_hash') = ? LIMIT 1`,
    ).bind(endpointId, widgetKeyHash).first();
    if (existing) {
      throw failure("support_widget_key_conflict", "Widget key is already configured", 409);
    }
  }
  const encrypted = await encryptCredentialPayload(
    String(c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY || ""),
    credentials as Record<string, unknown>,
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO support_provider_credentials (endpoint_id, project_id, encrypted_payload)
       VALUES (?, ?, ?) ON CONFLICT(endpoint_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload,
       credential_version = credential_version + 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(endpointId, projectId, encrypted),
    c.env.DB.prepare(
      `UPDATE support_provider_endpoints SET status = 'configured', last_error_code = NULL,
       settings_json = CASE WHEN ? IS NULL THEN settings_json ELSE
         json_set(settings_json, '$.widget_key_hash', ?, '$.allowed_domains', json(?)) END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`,
    ).bind(widgetKeyHash, widgetKeyHash, JSON.stringify(widgetDomains), endpointId, projectId),
  ]);
  await audit(c.env.DB, projectId, "providers", endpointId, "credentials_rotated", actorId(c.req.raw));
  return c.json({ data: {
    endpoint_id: endpointId,
    configured: true,
    credential_fields: Object.keys(credentials as Record<string, unknown>).sort(),
  } });
});

native.put("/:projectId/integrations/:id/credentials", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const integrationId = identifier(c.req.param("id"));
  const integration = await c.env.DB.prepare(
    `SELECT id, provider, settings_json FROM support_integrations
     WHERE id = ? AND project_id = ? AND status != 'disabled'`,
  ).bind(integrationId, projectId).first<{
    id: string;
    provider: string;
    settings_json: string;
  }>();
  if (!integration) {
    throw failure("support_integration_not_found", "Support integration not found", 404);
  }
  const body = await readJsonObject(c.req.raw);
  const credentials = body.credentials;
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw failure("support_integration_credentials_invalid", "Credentials must be an object", 422);
  }
  const credentialRecord = credentials as Record<string, unknown>;
  let nativeCredentialState: ReturnType<typeof nativeIntegrationCredentialState> = null;
  if (integration.provider === "webhook") {
    const settings = parseJson(integration.settings_json) as Record<string, unknown> | null;
    if (!isSafePublicHttpsUrl(String(settings?.endpoint_url || ""))) {
      throw failure("support_webhook_url_invalid", "Webhook endpoint must be a public HTTPS URL", 422);
    }
    const signingSecret = String(credentialRecord.signing_secret || "");
    if (signingSecret.length < 32 || signingSecret.length > 512) {
      throw failure("support_webhook_secret_invalid", "Webhook signing secret must contain between 32 and 512 characters", 422);
    }
  } else if (integration.provider === "dyte") {
    const organizationId = String(credentialRecord.organization_id || "").trim();
    const apiKey = String(credentialRecord.api_key || "").trim();
    const settings = parseJson(integration.settings_json) as Record<string, unknown> | null;
    if (!organizationId || organizationId.length > 255 || !apiKey || apiKey.length > 512 ||
      !String(settings?.meeting_preset || "").trim()) {
      throw failure("configuration_required", "Support meeting credentials and preset are required", 422);
    }
  } else {
    nativeCredentialState = nativeIntegrationCredentialState(integration.provider, credentialRecord);
    if (nativeCredentialState?.configured) {
      const settings = parseJson(integration.settings_json) as Record<string, unknown> | null;
      validateNativeIntegrationSettings(integration.provider, settings || {});
    }
  }
  const serialized = JSON.stringify(credentialRecord);
  if (new TextEncoder().encode(serialized).byteLength > 32_000) {
    throw failure("support_integration_credentials_invalid", "Credentials exceed their size limit", 422);
  }
  if (!c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY) {
    throw failure("support_credentials_unavailable", "Support credential encryption is not configured", 503);
  }
  const encrypted = await encryptCredentialPayload(
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    credentialRecord,
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO support_integration_credentials
        (integration_id, project_id, encrypted_payload)
       VALUES (?, ?, ?)
       ON CONFLICT(integration_id) DO UPDATE SET
         encrypted_payload = excluded.encrypted_payload,
         credential_version = support_integration_credentials.credential_version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(integrationId, projectId, encrypted),
    c.env.DB.prepare(
      `UPDATE support_integrations SET status = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND project_id = ?`,
    ).bind(nativeCredentialState?.configured === false ? "configuration_required" : "configured", integrationId, projectId),
  ]);
  await audit(c.env.DB, projectId, "integrations", integrationId, "credentials.rotated", actorId(c.req.raw));
  const status = nativeCredentialState?.configured === false ? "configuration_required" : "configured";
  return c.json({ data: {
    id: integrationId,
    status,
    credentials_configured: nativeCredentialState?.configured ?? true,
    ...(nativeCredentialState ? { authorization_required: !nativeCredentialState.configured } : {}),
  } });
});

native.post("/:projectId/integrations/:id/oauth", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const integrationId = identifier(c.req.param("id"));
  const body = await readJsonObject(c.req.raw);
  const result = await startIntegrationOAuth(c.env, {
    projectId,
    integrationId,
    callbackUri: String(body.callback_uri || ""),
    returnUri: String(body.return_uri || ""),
    actorId: actorId(c.req.raw),
  });
  await audit(c.env.DB, projectId, "integrations", integrationId, "oauth.started", actorId(c.req.raw));
  return c.json({ data: result }, 201);
});

native.get("/:projectId/providers/:id/credentials", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const endpointId = identifier(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT endpoint.id, endpoint.status, credential.credential_version, credential.updated_at
     FROM support_provider_endpoints endpoint LEFT JOIN support_provider_credentials credential
       ON credential.endpoint_id = endpoint.id AND credential.project_id = endpoint.project_id
     WHERE endpoint.id = ? AND endpoint.project_id = ?`,
  ).bind(endpointId, projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_provider_not_found", "Support provider endpoint not found", 404);
  return c.json({ data: {
    endpoint_id: endpointId,
    configured: row.credential_version != null,
    credential_version: row.credential_version || null,
    updated_at: row.updated_at || null,
  } });
});

native.post("/:projectId/providers/:id/oauth", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const endpointId = identifier(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `SELECT endpoint.provider, endpoint.settings_json, credential.encrypted_payload
     FROM support_provider_endpoints endpoint
     LEFT JOIN support_provider_credentials credential ON credential.endpoint_id = endpoint.id
     WHERE endpoint.id = ? AND endpoint.project_id = ?`,
  ).bind(endpointId, projectId).first<{
    provider: string;
    settings_json: string;
    encrypted_payload: string | null;
  }>();
  if (!row) throw failure("support_provider_not_found", "Support provider endpoint not found", 404);
  if (!row.encrypted_payload) throw failure("configuration_required", "Support provider credentials are not configured", 422);
  const body = await readJsonObject(c.req.raw);
  const callbackUri = String(body.callback_uri || "").trim();
  const returnUri = String(body.return_uri || "").trim();
  if (!isSafePublicHttpsUrl(callbackUri) || !isSafePublicHttpsUrl(returnUri)) {
    throw failure("support_oauth_uri_invalid", "OAuth callback and return URLs must be public HTTPS URLs", 422);
  }
  const callback = new URL(callbackUri);
  if (!callback.pathname.endsWith(`/api/v1/support/providers/${row.provider}/oauth/callback`)) {
    throw failure("support_oauth_uri_invalid", "OAuth callback URL does not match the Support provider route", 422);
  }
  const decrypted = await decryptCredentialPayload([
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], row.encrypted_payload);
  const clientId = String(decrypted.payload.client_id || decrypted.payload.client_key || "").trim();
  if (!clientId) throw failure("configuration_required", "OAuth client configuration is incomplete", 422);
  const settings = parseJson(row.settings_json) as Record<string, unknown> | null;
  const oauth = oauthProviderConfiguration(row.provider, settings || {}, decrypted.payload);
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await sha256Base64Url(verifier);
  const stateHash = await sha256(state);
  const stateId = crypto.randomUUID();
  const verifierEncrypted = await encryptCredentialPayload(
    c.env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    { verifier },
  );
  await c.env.DB.prepare(
    `INSERT INTO support_oauth_states
      (id, project_id, endpoint_id, provider, state_hash, verifier_encrypted,
       callback_uri, redirect_uri, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'), ?)`,
  ).bind(
    stateId, projectId, endpointId, row.provider, stateHash, verifierEncrypted,
    callbackUri, returnUri, actorId(c.req.raw),
  ).run();
  const authorization = new URL(oauth.authorizationUrl);
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", callbackUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("state", state);
  if (oauth.scope) authorization.searchParams.set("scope", oauth.scope);
  if (oauth.pkce) {
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
  }
  for (const [name, value] of Object.entries(oauth.extra)) authorization.searchParams.set(name, value);
  return c.json({ data: { authorization_url: authorization.toString(), expires_in: 600 } }, 201);
});

native.post("/:projectId/proactive-support/campaigns/:id/:action", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const id = identifier(c.req.param("id"));
  const action = c.req.param("action");
  const target = ({ schedule: "scheduled", start: "running", pause: "paused", resume: "running", cancel: "cancelled" } as Record<string, string>)[action];
  if (!target) throw failure("support_campaign_action_invalid", "Campaign action is invalid", 422);
  const body = await readJsonObject(c.req.raw);
  const scheduledAt = action === "schedule" ? timestamp(body.scheduled_at, "scheduled_at", false) : null;
  if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
    throw failure("support_campaign_schedule_invalid", "Campaign schedule must be in the future", 422);
  }
  const row = await c.env.DB.prepare(
    `UPDATE support_campaigns SET status = ?, scheduled_at = COALESCE(?, scheduled_at),
      started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE started_at END,
      completed_at = CASE WHEN ? = 'cancelled' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE completed_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND project_id = ? RETURNING *`,
  ).bind(target, scheduledAt, target, target, id, projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_campaign_not_found", "Support campaign not found", 404);
  // Future schedules are claimed by the minute cron only when due. Explicit
  // start/resume actions are the only actions that enqueue immediately.
  if (target === "running") {
    await c.env.SUPPORT_BULK_QUEUE?.send({
      type: "support.campaign.dispatch.v1", projectId, campaignId: id,
    }, { contentType: "json" });
  }
  await audit(c.env.DB, projectId, "proactive-support/campaigns", id, action, actorId(c.req.raw));
  return c.json({ data: serializeRow(resources.find((entry) => entry.path === "proactive-support/campaigns")!, row) });
});

native.post("/:projectId/help-center/articles/:id/publish", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const id = identifier(c.req.param("id"));
  const row = await c.env.DB.prepare(
    `UPDATE support_articles SET status = 'published', published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ? RETURNING *`,
  ).bind(id, projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_article_not_found", "Help Center article not found", 404);
  await queueKnowledgeDocument(c.env, projectId, id, row, actorId(c.req.raw));
  await audit(c.env.DB, projectId, "help-center/articles", id, "published", actorId(c.req.raw));
  return c.json({ data: serializeRow(resources.find((entry) => entry.path === "help-center/articles")!, row) });
});

native.post("/:projectId/captain/tasks", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const body = await readJsonObject(c.req.raw);
  const taskType = text(body.task_type, "task_type", 64, false);
  const allowed = ["suggest_reply", "summarize", "translate", "index_document", "copilot", "handoff", "run_tool"];
  if (!allowed.includes(taskType)) throw failure("support_task_type_invalid", "Captain task type is invalid", 422);
  const id = crypto.randomUUID();
  const input = jsonValue(body.input || {}, "input", 32_000);
  const assistantId = nullableIdentifier(body.assistant_id);
  const conversationId = nullableIdentifier(body.conversation_id);
  if (assistantId) {
    const assistant = await c.env.DB.prepare(`SELECT handoff_enabled FROM support_assistants
      WHERE id = ? AND project_id = ? AND active = 1`).bind(assistantId, projectId)
      .first<{ handoff_enabled: number }>();
    if (!assistant) throw failure("support_assistant_not_found", "Active Support assistant not found", 404);
    if (taskType === "handoff" && assistant.handoff_enabled !== 1) {
      throw failure("support_handoff_disabled", "Human handoff is disabled for this assistant", 422);
    }
  }
  if (conversationId) {
    const conversation = await c.env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND project_id = ?")
      .bind(conversationId, projectId).first();
    if (!conversation) throw failure("support_conversation_not_found", "Support conversation not found", 404);
  }
  if (!c.env.SUPPORT_AI_QUEUE) {
    throw failure("support_ai_unavailable", "Support intelligence processing is not configured", 503);
  }
  await c.env.DB.prepare(
    `INSERT INTO support_assistant_tasks
      (id, project_id, assistant_id, conversation_id, task_type, input_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, projectId,
    assistantId, conversationId,
    taskType, input, actorId(c.req.raw),
  ).run();
  try {
    await c.env.SUPPORT_AI_QUEUE.send({ type: "support.captain.task.v1", projectId, taskId: id }, { contentType: "json" });
  } catch {
    await c.env.DB.prepare(`UPDATE support_assistant_tasks SET status = 'failed',
      last_error = 'queue_unavailable', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?`).bind(id, projectId).run();
    throw failure("support_ai_unavailable", "Support intelligence processing is temporarily unavailable", 503);
  }
  await audit(c.env.DB, projectId, "captain/tasks", id, "queued", actorId(c.req.raw));
  return c.json({ data: { id, project_id: projectId, task_type: taskType, status: "queued" } }, 202);
});

native.get("/:projectId/captain/tasks", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const page = cursorRequest(c.req.query("cursor"), c.req.query("limit"));
  const rows = await c.env.DB.prepare(`SELECT * FROM support_assistant_tasks
    WHERE project_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(
      projectId, page.cursor?.createdAt ?? null, page.cursor?.createdAt ?? null,
      page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1,
    ).all<Record<string, unknown>>();
  const hasMore = rows.results.length > page.limit;
  const selected = rows.results.slice(0, page.limit);
  const last = selected.at(-1);
  return c.json({
    data: selected.map(captainTaskShape),
    pagination: {
      limit: page.limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(String(last.created_at), String(last.id)) : null,
    },
  });
});

native.get("/:projectId/captain/tasks/:id", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const row = await c.env.DB.prepare("SELECT * FROM support_assistant_tasks WHERE id = ? AND project_id = ?")
    .bind(identifier(c.req.param("id")), projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_task_not_found", "Support assistant task not found", 404);
  return c.json({ data: captainTaskShape(row) });
});

native.get("/:projectId/captain/assistant-inboxes", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const rows = await c.env.DB.prepare(`SELECT link.*, inbox.name inbox_name, assistant.name assistant_name
    FROM support_assistant_inboxes link
    INNER JOIN support_inboxes inbox ON inbox.id = link.inbox_id AND inbox.project_id = link.project_id
    INNER JOIN support_assistants assistant ON assistant.id = link.assistant_id AND assistant.project_id = link.project_id
    WHERE link.project_id = ? ORDER BY link.created_at DESC`).bind(projectId).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map((row) => ({ ...row, automatic_enabled: Number(row.automatic_enabled) === 1 })) });
});

native.put("/:projectId/captain/assistants/:assistantId/inboxes/:inboxId", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const assistantId = identifier(c.req.param("assistantId"));
  const inboxId = identifier(c.req.param("inboxId"));
  const body = await readJsonObject(c.req.raw);
  const automatic = body.automatic_enabled === true;
  const [assistant, inbox] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id FROM support_assistants WHERE id = ? AND project_id = ? AND active = 1").bind(assistantId, projectId),
    c.env.DB.prepare("SELECT id FROM support_inboxes WHERE id = ? AND project_id = ? AND status = 'active'").bind(inboxId, projectId),
  ]);
  if (!assistant.results.length || !inbox.results.length) {
    throw failure("support_assistant_inbox_invalid", "Active assistant and inbox are required", 422);
  }
  await c.env.DB.prepare(`INSERT INTO support_assistant_inboxes
      (project_id, assistant_id, inbox_id, automatic_enabled, configured_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(assistant_id, inbox_id) DO UPDATE SET automatic_enabled = excluded.automatic_enabled,
      configured_by = excluded.configured_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(projectId, assistantId, inboxId, automatic ? 1 : 0, actorId(c.req.raw)).run();
  await audit(c.env.DB, projectId, "captain/assistant-inboxes", `${assistantId}:${inboxId}`,
    automatic ? "automatic_enabled" : "linked", actorId(c.req.raw));
  return c.json({ data: { assistant_id: assistantId, inbox_id: inboxId, automatic_enabled: automatic } });
});

native.get("/:projectId/reports", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const from = optionalTimestamp(c.req.query("from"));
  const to = optionalTimestamp(c.req.query("to"));
  const rows = await c.env.DB.prepare(
    `SELECT
      COUNT(*) conversations,
      SUM(CASE WHEN status != 'closed' THEN 1 ELSE 0 END) backlog,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) resolved,
      ROUND(AVG(CASE WHEN first_reply_at IS NOT NULL THEN
        (julianday(first_reply_at) - julianday(created_at)) * 86400 END), 2) first_response_seconds,
      ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN
        (julianday(resolved_at) - julianday(created_at)) * 86400 END), 2) resolution_seconds
     FROM conversations WHERE project_id = ?
       AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)`,
  ).bind(projectId, from, from, to, to).first<Record<string, unknown>>();
  const [byInbox, byAgent, byTeam, byLabel, byChannel, byProvider, sla, csat, campaigns] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(inbox.name, 'Unassigned') dimension, COUNT(*) conversations
      FROM conversations conversation LEFT JOIN support_inboxes inbox
        ON inbox.id = conversation.inbox_id AND inbox.project_id = conversation.project_id
      WHERE conversation.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY conversation.inbox_id, inbox.name ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT COALESCE(membership.display_name, 'Unassigned') dimension, COUNT(*) conversations
      FROM conversations conversation LEFT JOIN support_memberships membership
        ON membership.id = conversation.assigned_user_id AND membership.project_id = conversation.project_id
      WHERE conversation.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY conversation.assigned_user_id, membership.display_name ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT COALESCE(team.name, 'Unassigned') dimension, COUNT(*) conversations
      FROM conversations conversation LEFT JOIN support_teams team
        ON team.id = conversation.assigned_team_id AND team.project_id = conversation.project_id
      WHERE conversation.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY conversation.assigned_team_id, team.name ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT label.name dimension, COUNT(DISTINCT linked.conversation_id) conversations
      FROM support_conversation_labels linked INNER JOIN support_labels label ON label.id = linked.label_id
      INNER JOIN conversations conversation ON conversation.id = linked.conversation_id
      WHERE linked.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY linked.label_id, label.name ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT COALESCE(inbox.channel_type, 'api') dimension, COUNT(*) conversations
      FROM conversations conversation LEFT JOIN support_inboxes inbox
        ON inbox.id = conversation.inbox_id AND inbox.project_id = conversation.project_id
      WHERE conversation.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY inbox.channel_type ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT endpoint.provider dimension, COUNT(DISTINCT conversation.id) conversations
      FROM conversations conversation INNER JOIN support_provider_endpoints endpoint
        ON endpoint.inbox_id = conversation.inbox_id AND endpoint.project_id = conversation.project_id
      WHERE conversation.project_id = ? AND (? IS NULL OR conversation.created_at >= ?)
        AND (? IS NULL OR conversation.created_at < ?)
      GROUP BY endpoint.provider ORDER BY conversations DESC`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT status, COUNT(*) count FROM support_applied_slas
      WHERE project_id = ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      GROUP BY status`).bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT COUNT(*) responses, ROUND(AVG(rating), 2) average FROM support_csat_responses
      WHERE project_id = ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)`)
      .bind(projectId, from, from, to, to),
    c.env.DB.prepare(`SELECT status, COUNT(*) count FROM support_campaign_deliveries
      WHERE project_id = ? AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)
      GROUP BY status`).bind(projectId, from, from, to, to),
  ]);
  return c.json({ data: {
    period: { from, to }, totals: rows || {},
    dimensions: {
      inbox: byInbox.results,
      agent: byAgent.results,
      team: byTeam.results,
      label: byLabel.results,
      channel: byChannel.results,
      provider: byProvider.results,
    },
    sla: sla.results,
    csat: csat.results[0] || { responses: 0, average: null },
    proactive_support: campaigns.results,
  } });
});

native.post("/:projectId/reports/exports", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const filters = jsonValue(body.filters || {}, "filters", 16_000);
  const queue = c.env.SUPPORT_BULK_QUEUE;
  if (!queue) throw failure("support_bulk_unavailable", "Support export processing is not configured", 503);
  await c.env.DB.prepare(
    `INSERT INTO support_export_jobs (id, project_id, resource_type, filters_json, created_by)
     VALUES (?, ?, 'reports', ?, ?)`,
  ).bind(id, projectId, filters, actorId(c.req.raw)).run();
  try {
    await queue.send({ type: "support.export.requested.v1", projectId, exportId: id }, { contentType: "json" });
  } catch {
    await c.env.DB.prepare(`UPDATE support_export_jobs SET status = 'failed', last_error = 'queue_unavailable',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`)
      .bind(id, projectId).run();
    throw failure("support_bulk_unavailable", "Support export processing is temporarily unavailable", 503);
  }
  return c.json({ data: { id, status: "queued" } }, 202);
});

native.get("/:projectId/reports/exports", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const page = cursorRequest(c.req.query("cursor"), c.req.query("limit"));
  const rows = await c.env.DB.prepare(`SELECT id, status, filters_json, result_json, last_error,
      created_at, updated_at FROM support_export_jobs
    WHERE project_id = ? AND resource_type = 'reports'
      AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))
    ORDER BY updated_at DESC, id DESC LIMIT ?`).bind(
      projectId, page.cursor?.createdAt ?? null, page.cursor?.createdAt ?? null,
      page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1,
    ).all<Record<string, unknown>>();
  const hasMore = rows.results.length > page.limit;
  const selected = rows.results.slice(0, page.limit);
  const last = selected.at(-1);
  return c.json({
    data: selected.map(reportExportShape),
    pagination: {
      limit: page.limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(String(last.updated_at), String(last.id)) : null,
    },
  });
});

native.get("/:projectId/reports/exports/:id", async (c) => {
  const row = await reportExport(c.env.DB, projectIdFrom(c.req.param("projectId")), c.req.param("id"));
  return c.json({ data: reportExportShape(row) });
});

native.get("/:projectId/reports/exports/:id/download", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const row = await reportExport(c.env.DB, projectId, c.req.param("id"));
  if (row.status !== "completed" || typeof row.storage_key !== "string" || !row.storage_key) {
    throw failure("support_report_export_not_ready", "Support report export is not ready", 409);
  }
  const object = await c.env.ATTACHMENTS.get(row.storage_key);
  if (!object) throw failure("support_report_export_unavailable", "Support report export is temporarily unavailable", 503);
  return new Response(object.body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="support-report-${String(row.id)}.json"`,
      "content-type": object.httpMetadata?.contentType || "application/json",
      "x-content-type-options": "nosniff",
    },
  });
});

native.get("/:projectId/settings/operations", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const [deadLetters, scheduled, providerFailures, knowledge, imports, exports] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM support_dead_letters GROUP BY status"),
    c.env.DB.prepare("SELECT queue_name, status, COUNT(*) count FROM support_scheduled_jobs WHERE project_id = ? GROUP BY queue_name, status").bind(projectId),
    c.env.DB.prepare("SELECT provider, status, COUNT(*) count FROM support_provider_events WHERE project_id = ? GROUP BY provider, status").bind(projectId),
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM support_knowledge_documents WHERE project_id = ? GROUP BY status").bind(projectId),
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM support_import_jobs WHERE project_id = ? GROUP BY status").bind(projectId),
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM support_export_jobs WHERE project_id = ? GROUP BY status").bind(projectId),
  ]);
  return c.json({ data: {
    queues: scheduled.results,
    dead_letters: deadLetters.results,
    providers: providerFailures.results,
    knowledge: knowledge.results,
    imports: imports.results,
    exports: exports.results,
  } });
});

native.get("/:projectId/settings/operations/dead-letters", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const page = cursorRequest(c.req.query("cursor"), c.req.query("limit"));
  const rows = await c.env.DB.prepare(`SELECT id, source_queue, message_id, job_type,
      replayable, attempts, status, received_at, received_at updated_at
    FROM support_dead_letters
    WHERE json_extract(payload_json, '$.projectId') = ?
      AND (? IS NULL OR received_at < ? OR (received_at = ? AND id < ?))
    ORDER BY received_at DESC, id DESC LIMIT ?`).bind(
      projectId, page.cursor?.createdAt ?? null, page.cursor?.createdAt ?? null,
      page.cursor?.createdAt ?? null, page.cursor?.id ?? null, page.limit + 1,
    ).all<Record<string, unknown>>();
  const hasMore = rows.results.length > page.limit;
  const selected = rows.results.slice(0, page.limit);
  const last = selected.at(-1);
  return c.json({
    data: selected.map((row) => ({ ...row, replayable: Number(row.replayable) === 1, updated_at: undefined })),
    pagination: {
      limit: page.limit,
      has_more: hasMore,
      next_cursor: hasMore && last ? encodeCursor(String(last.received_at), String(last.id)) : null,
    },
  });
});

native.post("/:projectId/settings/operations/dead-letters/:id/replay", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const id = identifier(c.req.param("id"));
  const row = await c.env.DB.prepare(`SELECT id, source_queue, payload_json, payload_sha256
    FROM support_dead_letters WHERE id = ? AND status = 'quarantined' AND replayable = 1
      AND json_extract(payload_json, '$.projectId') = ?`).bind(id, projectId)
    .first<{ id: string; source_queue: string; payload_json: string; payload_sha256: string }>();
  if (!row) throw failure("support_dead_letter_not_found", "Replayable Support job not found", 404);
  if (await sha256(row.payload_json) !== row.payload_sha256) {
    throw failure("support_dead_letter_integrity_invalid", "Support job integrity check failed", 409);
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(row.payload_json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Number((parsed as Record<string, unknown>).projectId) !== projectId) {
      throw new Error();
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    throw failure("support_dead_letter_payload_invalid", "Support job payload is invalid", 409);
  }
  const lower = row.source_queue.toLowerCase();
  const queue = lower.includes("ai")
    ? c.env.SUPPORT_AI_QUEUE
    : lower.includes("bulk")
      ? c.env.SUPPORT_BULK_QUEUE
      : c.env.SUPPORT_QUEUE;
  await queue.send(payload, { contentType: "json" });
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE support_dead_letters SET status = 'discarded' WHERE id = ? AND status = 'quarantined'").bind(id),
    c.env.DB.prepare(`INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
      VALUES (?, ?, 'dead_letter', ?, 'replayed', ?, ?)`)
      .bind(crypto.randomUUID(), projectId, id, actorId(c.req.raw), JSON.stringify({ source_queue: row.source_queue })),
  ]);
  return c.json({ data: { id, replayed: true } }, 202);
});

native.post("/:projectId/settings/operations/dead-letters/:id/discard", async (c) => {
  const projectId = projectIdFrom(c.req.param("projectId"));
  const id = identifier(c.req.param("id"));
  const row = await c.env.DB.prepare(`UPDATE support_dead_letters SET status = 'discarded'
    WHERE id = ? AND status = 'quarantined' AND json_extract(payload_json, '$.projectId') = ?
    RETURNING id`).bind(id, projectId).first<{ id: string }>();
  if (!row) throw failure("support_dead_letter_not_found", "Support job not found", 404);
  await audit(c.env.DB, projectId, "dead_letter", id, "discarded", actorId(c.req.raw));
  return c.json({ data: { id, discarded: true } });
});

async function reportExport(db: D1Database, projectId: number, value: string) {
  const id = identifier(value);
  const row = await db.prepare(`SELECT id, project_id, status, filters_json, result_json,
      storage_key, last_error, created_at, updated_at FROM support_export_jobs
    WHERE id = ? AND project_id = ? AND resource_type = 'reports'`)
    .bind(id, projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_report_export_not_found", "Support report export not found", 404);
  return row;
}

function reportExportShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    project_id: row.project_id,
    status: row.status,
    filters: parseJson(row.filters_json),
    result: parseJson(row.result_json),
    error_code: row.last_error ? "processing_failed" : null,
    download_ref: row.status === "completed" ? row.id : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function captainTaskShape(row: Record<string, unknown>) {
  return {
    id: row.id,
    project_id: row.project_id,
    assistant_id: row.assistant_id,
    conversation_id: row.conversation_id,
    task_type: row.task_type,
    status: row.status,
    input: parseJson(row.input_json),
    result: parseJson(row.result_json),
    error_code: row.last_error ? String(row.last_error).slice(0, 128) : null,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mutationFields(resource: Resource, body: Record<string, unknown>, create: boolean) {
  const values = new Map<string, unknown>();
  for (const [publicName, field] of Object.entries(resource.fields)) {
    if (!create && field.createOnly) continue;
    if (!(publicName in body)) {
      if (create && field.required) throw failure("support_field_required", `${publicName} is required`, 422);
      continue;
    }
    values.set(field.column || publicName, fieldValue(body[publicName], publicName, field));
  }
  const unknown = Object.keys(body).filter((key) => !resource.fields[key]);
  if (unknown.length) throw failure("support_field_unknown", `Unsupported fields: ${unknown.slice(0, 5).join(", ")}`, 422);
  return values;
}

function fieldValue(value: unknown, name: string, field: Field): unknown {
  if (value == null) {
    if (field.nullable) return null;
    throw failure("support_field_invalid", `${name} cannot be null`, 422);
  }
  if (field.kind === "boolean") {
    if (typeof value !== "boolean") throw failure("support_field_invalid", `${name} must be a boolean`, 422);
    return value ? 1 : 0;
  }
  if (field.kind === "integer") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || (field.max != null && number > field.max)) {
      throw failure("support_field_invalid", `${name} must be a bounded integer`, 422);
    }
    return number;
  }
  if (field.kind === "json") return jsonValue(value, name, field.max || 32_000);
  if (field.kind === "timestamp") return timestamp(value, name, field.nullable === true);
  const resolved = text(value, name, field.max || 255, field.nullable === true);
  if (field.kind === "enum" && !field.values?.includes(resolved)) {
    throw failure("support_field_invalid", `${name} has an unsupported value`, 422);
  }
  return resolved;
}

function serializeRow(resource: Resource, row: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  const reverse = new Map(Object.entries(resource.fields).map(([name, field]) => [field.column || name, { name, field }]));
  for (const [column, value] of Object.entries(row)) {
    if (resource.redactColumns?.includes(column)) {
      result[reverse.get(column)?.name || column] = value ? { configured: true } : {};
      continue;
    }
    const mapped = reverse.get(column);
    if (mapped?.field.kind === "json") {
      result[mapped.name] = parseJson(value);
    } else if (mapped?.field.kind === "boolean") {
      result[mapped.name] = Boolean(value);
    } else {
      result[mapped?.name || column] = value;
    }
  }
  return result;
}

async function resourceRow(db: D1Database, resource: Resource, projectId: number, value: string) {
  const id = identifier(value);
  const row = await db.prepare(`SELECT * FROM ${resource.table} WHERE id = ? AND project_id = ?`)
    .bind(id, projectId).first<Record<string, unknown>>();
  if (!row) throw failure("support_resource_not_found", "Support resource not found", 404);
  return row;
}

async function activeWorkforceResource(
  db: D1Database,
  table: "support_memberships" | "support_teams" | "support_inboxes",
  projectId: number,
  id: string,
) {
  const activeClause = table === "support_inboxes" ? "status = 'active'" : "active = 1";
  const row = await db.prepare(`SELECT id FROM ${table}
    WHERE id = ? AND project_id = ? AND ${activeClause} LIMIT 1`)
    .bind(id, projectId).first();
  if (!row) throw failure("support_workforce_resource_not_found", "Active Support workforce resource not found", 404);
}

async function enqueueCreatedResource(
  env: NativeEnv,
  path: string,
  projectId: number,
  id: string,
  row: Record<string, unknown>,
) {
  if (path === "help-center/articles" && row.status === "published") {
    await queueKnowledgeDocument(env, projectId, id, row, String(row.author_id || "system"));
  }
}

async function queueKnowledgeDocument(
  env: NativeEnv,
  projectId: number,
  articleId: string,
  row: Record<string, unknown>,
  actor: string,
) {
  const hash = await sha256(`${row.title || ""}\n${row.content || ""}`);
  const documentId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO support_knowledge_documents
      (id, project_id, source_type, source_id, title, content_hash, vector_namespace, status, created_by)
     VALUES (?, ?, 'article', ?, ?, ?, ?, 'queued', ?)
     ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET title = excluded.title,
       content_hash = excluded.content_hash, status = 'queued', last_error = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(documentId, projectId, articleId, String(row.title || "Article"), hash, `project:${projectId}`, actor).run();
  if (!env.SUPPORT_AI_QUEUE) throw failure("support_ai_unavailable", "Support knowledge indexing is not configured", 503);
  try {
    await env.SUPPORT_AI_QUEUE.send({ type: "support.knowledge.index.v1", projectId, sourceType: "article", sourceId: articleId }, { contentType: "json" });
  } catch {
    await env.DB.prepare(`UPDATE support_knowledge_documents SET status = 'failed',
      last_error = 'queue_unavailable', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND source_type = 'article' AND source_id = ?`).bind(projectId, articleId).run();
    throw failure("support_ai_unavailable", "Support knowledge indexing is temporarily unavailable", 503);
  }
}

function validateProviderCredentials(provider: string, credentials: Record<string, unknown>) {
  const required: Record<string, string[]> = {
    widget: ["widget_key", "signing_secret", "allowed_domains"],
    email_google: ["client_id", "client_secret"],
    email_microsoft: ["client_id", "client_secret"],
    smtp: ["host", "username", "password", "from_email"],
    whatsapp_cloud: ["access_token", "verify_token", "app_secret", "phone_number_id"],
    facebook_messenger: ["page_access_token", "verify_token", "app_secret", "page_id"],
    instagram: ["access_token", "verify_token", "app_secret", "instagram_id"],
    twilio_sms: ["account_sid", "auth_token", "from_number"],
    twilio_voice: ["account_sid", "auth_token", "from_number", "status_callback_url"],
    whatsapp_calls: ["access_token", "app_secret", "phone_number_id"],
    telegram: ["bot_token", "webhook_secret"],
    line: ["channel_access_token", "channel_secret"],
    tiktok: ["client_key", "client_secret"],
    twitter: ["client_id", "client_secret"],
    slack: ["client_id", "client_secret", "signing_secret"],
    linear: ["client_id", "client_secret"],
    notion: ["client_id", "client_secret"],
    shopify: ["client_id", "client_secret"],
    dyte: ["organization_id", "api_key"],
    webhook: ["signing_secret"],
  };
  const missing = (required[provider] || []).filter((key) => !String(credentials[key] || "").trim());
  if (missing.length) {
    throw failure("configuration_required", `Provider configuration is missing required fields: ${missing.join(", ")}`, 422);
  }
  if (provider === "widget") {
    const widgetKey = String(credentials.widget_key || "");
    const signingSecret = String(credentials.signing_secret || "");
    const domains = Array.isArray(credentials.allowed_domains)
      ? credentials.allowed_domains
      : String(credentials.allowed_domains || "").split(",");
    if (widgetKey.length < 16 || widgetKey.length > 255 ||
      signingSecret.length < 32 || signingSecret.length > 512 ||
      !domains.some((domain) => String(domain).trim())) {
      throw failure("support_provider_credentials_invalid", "Widget credentials or allowed domains are invalid", 422);
    }
  }
  if (provider === "smtp") {
    const email = String(credentials.from_email || "").trim();
    const port = credentials.port == null || credentials.port === "" ? 587 : Number(credentials.port);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 320 ||
      !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw failure("support_provider_credentials_invalid", "SMTP sender or port is invalid", 422);
    }
  }
  if (["whatsapp_cloud", "whatsapp_calls"].includes(provider) &&
    !/^\d{5,32}$/u.test(String(credentials.phone_number_id || ""))) {
    throw failure("support_provider_credentials_invalid", "Provider phone number identifier is invalid", 422);
  }
  if (provider === "facebook_messenger" && !/^\d{5,32}$/u.test(String(credentials.page_id || ""))) {
    throw failure("support_provider_credentials_invalid", "Provider page identifier is invalid", 422);
  }
  if (provider === "instagram" && !/^\d{5,32}$/u.test(String(credentials.instagram_id || ""))) {
    throw failure("support_provider_credentials_invalid", "Provider account identifier is invalid", 422);
  }
  if (["twilio_sms", "twilio_voice"].includes(provider) &&
    !/^\+[1-9]\d{6,14}$/u.test(String(credentials.from_number || ""))) {
    throw failure("support_provider_credentials_invalid", "Provider sender number must use E.164 format", 422);
  }
  if (provider === "twilio_voice" &&
    !isSafePublicHttpsUrl(String(credentials.status_callback_url || ""))) {
    throw failure("support_provider_credentials_invalid", "Voice status callback must use public HTTPS", 422);
  }
  const serialized = JSON.stringify(credentials);
  if (serialized.length > 64_000 || Object.keys(credentials).length > 50) {
    throw failure("support_provider_credentials_invalid", "Provider credentials exceed supported limits", 422);
  }
}

async function validateProviderInbox(
  db: D1Database,
  projectId: number,
  inboxInput: unknown,
  providerInput: unknown,
) {
  const inboxId = identifier(inboxInput);
  const provider = String(providerInput || "").trim();
  const inbox = await db.prepare(`SELECT id FROM support_inboxes
    WHERE id = ? AND project_id = ? AND status = 'active' AND channel_type = ?
    LIMIT 1`).bind(inboxId, projectId, provider).first();
  if (!inbox) {
    throw failure(
      "support_provider_inbox_invalid",
      "Provider must be attached to an active matching Support inbox",
      422,
    );
  }
}

function oauthProviderConfiguration(
  provider: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  const tenant = String(settings.tenant || "common").replace(/[^A-Za-z0-9._-]/g, "");
  const shop = String(settings.shop_domain || credentials.shop_domain || "").toLowerCase();
  const entries: Record<string, { authorizationUrl: string; scope: string; pkce: boolean; extra?: Record<string, string> }> = {
    email_google: { authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", scope: "openid email https://www.googleapis.com/auth/gmail.modify", pkce: true, extra: { access_type: "offline", prompt: "consent" } },
    email_microsoft: { authorizationUrl: `https://login.microsoftonline.com/${tenant || "common"}/oauth2/v2.0/authorize`, scope: "offline_access openid email Mail.ReadWrite Mail.Send", pkce: true },
    facebook_messenger: { authorizationUrl: "https://www.facebook.com/v22.0/dialog/oauth", scope: "pages_manage_metadata pages_messaging pages_read_engagement", pkce: false },
    instagram: { authorizationUrl: "https://www.facebook.com/v22.0/dialog/oauth", scope: "instagram_basic instagram_manage_messages pages_show_list", pkce: false },
    slack: { authorizationUrl: "https://slack.com/oauth/v2/authorize", scope: "chat:write channels:read users:read", pkce: false },
    linear: { authorizationUrl: "https://linear.app/oauth/authorize", scope: "read,write", pkce: true, extra: { prompt: "consent" } },
    notion: { authorizationUrl: "https://api.notion.com/v1/oauth/authorize", scope: "", pkce: false, extra: { owner: "user" } },
    tiktok: { authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/", scope: "user.info.basic", pkce: true },
    twitter: { authorizationUrl: "https://x.com/i/oauth2/authorize", scope: "dm.read dm.write tweet.read users.read offline.access", pkce: true },
    shopify: { authorizationUrl: shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) ? `https://${shop}/admin/oauth/authorize` : "", scope: "read_customers,write_customers,read_orders", pkce: false },
  };
  const resolved = entries[provider];
  if (!resolved?.authorizationUrl) throw failure("configuration_required", "OAuth is not configured for this Support provider", 422);
  return { ...resolved, extra: resolved.extra || {} };
}

function cursorRequest(cursorValue: string | undefined, limitValue: string | undefined) {
  const limit = limitValue == null || limitValue === "" ? 50 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw failure("pagination_limit_invalid", "limit must be between 1 and 100", 422);
  }
  if (!cursorValue) return { limit, cursor: null as null | { createdAt: string; id: string } };
  try {
    const json = atob(cursorValue.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(cursorValue.length / 4) * 4, "="));
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) => typeof item !== "string")) throw new Error("invalid");
    return { limit, cursor: { createdAt: parsed[0], id: parsed[1] } };
  } catch {
    throw failure("pagination_cursor_invalid", "cursor is invalid", 422);
  }
}

function encodeCursor(createdAt: string, id: string) {
  return btoa(JSON.stringify([createdAt, id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function escapeLike(value: string) { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }
function projectIdFrom(value: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw failure("project_id_invalid", "A valid Support project id is required", 422);
  return id;
}
function actorId(request: Request) {
  const value = String(request.headers.get("x-actor-id") || request.headers.get("x-opengrow-agent-id") || "").trim();
  if (!value || value.length > 255) throw failure("support_actor_invalid", "A signed Support actor is required", 401);
  return value;
}
function identifier(value: unknown) {
  const id = String(value || "").trim();
  if (!id || id.length > 255) throw failure("support_identifier_invalid", "Support identifier is invalid", 422);
  return id;
}
function nullableIdentifier(value: unknown) { return value == null || value === "" ? null : identifier(value); }
function text(value: unknown, name: string, max: number, nullable: boolean) {
  if (value == null && nullable) return null as never;
  const result = String(value || "").trim();
  if (!result || result.length > max) throw failure("support_field_invalid", `${name} must contain between 1 and ${max} characters`, 422);
  return result;
}
function timestamp(value: unknown, name: string, nullable: boolean) {
  if ((value == null || value === "") && nullable) return null;
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) throw failure("support_field_invalid", `${name} must be an ISO-8601 timestamp`, 422);
  return date.toISOString();
}
function optionalTimestamp(value: string | undefined) { return !value ? null : timestamp(value, "period", false); }
function jsonValue(value: unknown, name: string, max: number) {
  if (value == null || typeof value !== "object") throw failure("support_field_invalid", `${name} must be a JSON object or array`, 422);
  const serialized = JSON.stringify(value);
  if (serialized.length > max) throw failure("support_field_invalid", `${name} exceeds its size limit`, 422);
  return serialized;
}
function parseJson(value: unknown) { try { return JSON.parse(String(value || "null")); } catch { return null; } }
async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256Base64Url(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function audit(db: D1Database, projectId: number, type: string, id: string, action: string, actor: string) {
  await db.prepare(
    `INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, '{}')`,
  ).bind(crypto.randomUUID(), projectId, type.slice(0, 128), id, action.slice(0, 128), actor).run();
}
function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}

export default native;
