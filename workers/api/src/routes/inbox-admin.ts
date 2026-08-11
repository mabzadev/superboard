import { Hono } from "hono";
import { getOrCreateProject, parseProjectExternalId } from "../lib/db";
import { readTextLimited } from "../lib/http-limits";
import { errorEnvelope, purchasesError } from "../lib/purchases-v2";
import { authMiddleware } from "../middleware/auth";
import type { AppVariables, Env } from "../types";

type InboxItem = {
  id: string;
  source_type: "conversation" | "refund_case";
  source_id: string;
  title: string;
  preview: string;
  status: "open" | "pending" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  customer_reference: string | null;
  updated_at: string;
  destination: string;
  capabilities: string[];
  source: Record<string, unknown>;
};

const inbox = new Hono<{ Bindings: Env; Variables: AppVariables }>();
inbox.use("*", authMiddleware);

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param("projectId"));
  const access = (await c.env.DB.prepare(
    "SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1",
  )
    .bind(c.get("userId"), parsed.instanceId)
    .first()) as { role: string } | null;
  if (!access)
    throw purchasesError("project_not_found", "Project not found", 404);
  const project = await getOrCreateProject(
    c.env.DB,
    parsed.instanceId,
    parsed.kind,
  );
  return { ...project, id: String(project.id), role: access.role };
}

inbox.get("/:projectId/items", async (c) => {
  try {
    const project = await projectFor(c);
    const selectedType = String(c.req.query("type") || "all");
    const selectedStatus = String(c.req.query("status") || "");
    if (!["all", "conversation", "refund_case"].includes(selectedType)) {
      throw purchasesError("inbox_type_invalid", "Unsupported Inbox item type");
    }
    if (
      selectedStatus &&
      !["open", "pending", "closed"].includes(selectedStatus)
    ) {
      throw purchasesError("inbox_status_invalid", "Unsupported Inbox status");
    }
    const degradedSources: Array<{
      source_type: string;
      code: string;
      message: string;
    }> = [];
    const [conversations, refunds] = await Promise.all([
      selectedType === "all" || selectedType === "conversation"
        ? conversationItems(c.env, project.id, degradedSources)
        : Promise.resolve([]),
      selectedType === "all" || selectedType === "refund_case"
        ? refundItems(c.env.DB, project.id)
        : Promise.resolve([]),
    ]);
    const priority = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
    const data = [...conversations, ...refunds]
      .filter((item) => !selectedStatus || item.status === selectedStatus)
      .sort(
        (left, right) =>
          priority[left.priority] - priority[right.priority] ||
          right.updated_at.localeCompare(left.updated_at),
      )
      .slice(0, 500);
    return c.json({
      data,
      degraded_sources: degradedSources,
      projection: true,
    });
  } catch (error) {
    return c.json(
      errorEnvelope(error, c.req.header("cf-ray") || crypto.randomUUID()),
      (error as any)?.status || 422,
    );
  }
});

async function conversationItems(
  env: Env,
  projectId: string,
  degraded: Array<{ source_type: string; code: string; message: string }>,
): Promise<InboxItem[]> {
  if (!env.MESSAGING || !env.MESSAGING_INTERNAL_TOKEN) {
    degraded.push({
      source_type: "conversation",
      code: "messaging_unavailable",
      message: "Messaging is not configured",
    });
    return [];
  }
  try {
    const response = await env.MESSAGING.fetch(
      new Request(
        `https://messaging.internal/internal/projects/${projectId}/conversations`,
        {
          headers: {
            "X-SuperBoard-Internal-Token": env.MESSAGING_INTERNAL_TOKEN,
            "X-OpenGrow-Internal-Token": env.MESSAGING_INTERNAL_TOKEN,
          },
        },
      ),
    );
    const text = await readTextLimited(
      response,
      1_048_576,
      "Messaging response is too large",
    );
    const payload = text
      ? (JSON.parse(text) as {
          data?: Array<Record<string, unknown>>;
          code?: string;
          message?: string;
        })
      : {};
    if (!response.ok)
      throw Object.assign(
        new Error(String(payload.message || "Messaging request failed")),
        { code: payload.code },
      );
    return (payload.data || []).map(mapConversationItem);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "inbox_messaging_projection_failed",
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    degraded.push({
      source_type: "conversation",
      code: String(
        (error as { code?: string })?.code || "messaging_unavailable",
      ),
      message: "Messaging is temporarily unavailable",
    });
    return [];
  }
}

export function mapConversationItem(row: Record<string, unknown>): InboxItem {
  return {
    id: `conversation:${row.id}`,
    source_type: "conversation",
    source_id: String(row.id),
    title: String(row.subject || "Support conversation").slice(0, 255),
    preview: String(row.last_message_preview || "No messages").slice(0, 1000),
    status: conversationStatus(row.status),
    priority: itemPriority(row.priority),
    customer_reference: row.external_user_id
      ? String(row.external_user_id)
      : null,
    updated_at: isoDate(
      row.last_message_at || row.updated_at || row.created_at,
    ),
    destination: `/inbox?type=conversation&id=${encodeURIComponent(String(row.id))}`,
    capabilities: ["reply", "assign", "set_priority", "set_status"],
    source: row,
  };
}

async function refundItems(
  db: D1Database,
  projectId: string,
): Promise<InboxItem[]> {
  const rows = await db
    .prepare(
      `
    SELECT rc.id, rc.provider, rc.case_type, rc.status, rc.reason, rc.deadline_at, rc.updated_at,
      bc.primary_app_user_id,
      (SELECT COUNT(*) FROM billing_refund_provider_actions action WHERE action.case_id = rc.id AND action.status = 'draft') AS actions_requiring_approval
    FROM billing_refund_cases rc
    LEFT JOIN billing_customers bc ON bc.id = rc.customer_id
    WHERE rc.project_id = ? AND rc.status NOT IN ('won', 'lost', 'closed')
    ORDER BY CASE WHEN rc.deadline_at IS NULL THEN 1 ELSE 0 END, rc.deadline_at, rc.updated_at DESC LIMIT 250
  `,
    )
    .bind(projectId)
    .all<Record<string, unknown>>();
  return rows.results.map(mapRefundItem);
}

export function mapRefundItem(row: Record<string, unknown>): InboxItem {
  const deadline = row.deadline_at
    ? new Date(String(row.deadline_at)).getTime()
    : NaN;
  const hoursRemaining = Number.isFinite(deadline)
    ? (deadline - Date.now()) / 3_600_000
    : Infinity;
  const actions = Number(row.actions_requiring_approval || 0);
  return {
    id: `refund_case:${row.id}`,
    source_type: "refund_case",
    source_id: String(row.id),
    title:
      `${providerName(row.provider)} ${humanize(row.case_type || "refund case")}`.slice(
        0,
        255,
      ),
    preview: String(
      row.reason ||
        (actions
          ? `${actions} provider action(s) require approval`
          : "Refund case requires review"),
    ).slice(0, 1000),
    status: row.status === "submitted" ? "pending" : "open",
    priority:
      hoursRemaining <= 24
        ? "urgent"
        : hoursRemaining <= 72 || actions > 0
          ? "high"
          : "normal",
    customer_reference: row.primary_app_user_id
      ? String(row.primary_app_user_id)
      : null,
    updated_at: isoDate(row.updated_at),
    destination: `/purchases?section=refunds&case=${encodeURIComponent(String(row.id))}`,
    capabilities: [
      "review_evidence",
      "approve_provider_action",
      "send_provider_action",
    ],
    source: row,
  } satisfies InboxItem;
}

function conversationStatus(value: unknown): InboxItem["status"] {
  return value === "closed"
    ? "closed"
    : value === "pending"
      ? "pending"
      : "open";
}

function itemPriority(value: unknown): InboxItem["priority"] {
  return ["low", "normal", "high", "urgent"].includes(String(value))
    ? (value as InboxItem["priority"])
    : "normal";
}

function isoDate(value: unknown): string {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date(0).toISOString();
}

function providerName(value: unknown): string {
  return value === "apple"
    ? "Apple"
    : value === "google"
      ? "Google Play"
      : "Provider";
}

function humanize(value: unknown): string {
  return String(value)
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export default inbox;
