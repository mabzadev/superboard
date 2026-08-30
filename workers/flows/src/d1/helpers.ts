import type { Context } from "hono";
import type { FlowApp } from "../http/auth";
import { failure } from "../http/errors";

export type FlowContext = Context<FlowApp>;
export type SqlRow = Record<string, unknown>;

export function projectId(context: FlowContext): number {
  return context.get("project").projectId;
}

export function actorId(context: FlowContext): string {
  return String(context.get("project").actorId);
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function requireWorkflow(
  context: FlowContext,
  workflowId: string,
): Promise<SqlRow> {
  const row = await context.env.DB.prepare(
    `SELECT w.* FROM flow_workflows w
     WHERE w.project_id = ? AND w.id = ?`,
  )
    .bind(projectId(context), workflowId)
    .first<SqlRow>();
  if (!row) {
    throw failure("flow_workflow_not_found", "Workflow not found", 404);
  }
  return row;
}

export async function audit(
  context: FlowContext,
  action: string,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const project = context.get("project");
  await context.env.DB.prepare(
    `INSERT INTO flow_audit_events
       (id, project_id, project_ref, actor_id, action,
        entity_type, entity_id, payload_json, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      project.projectId,
      project.projectRef,
      String(project.actorId),
      action,
      entityType,
      entityId,
      JSON.stringify(payload),
      project.requestId,
    )
    .run();
}

export function isoNow(): string {
  return new Date().toISOString();
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
