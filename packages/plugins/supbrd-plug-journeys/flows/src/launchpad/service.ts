import type { FlowContext, SqlRow } from "../d1/helpers";
import {
  audit,
  isoNow,
  projectId,
  requireWorkflow,
} from "../d1/helpers";
import { failure } from "../http/errors";
import { requiredString } from "../http/validation";

export async function getLaunchpad(context: FlowContext) {
  const groups = await context.env.DB.prepare(
    `SELECT g.*, e.name AS environment_name, e.key AS environment_key
     FROM flow_launchpad_groups g
     JOIN flow_environments e ON e.id = g.environment_id
     WHERE g.project_id = ?
     ORDER BY g.position, g.created_at`,
  ).bind(projectId(context)).all<SqlRow>();
  const associations = await context.env.DB.prepare(
    `SELECT lw.group_id, lw.workflow_id, lw.priority, w.name, w.identifier, w.status
     FROM flow_launchpad_workflows lw
     JOIN flow_launchpad_groups g ON g.id = lw.group_id
     JOIN flow_workflows w ON w.id = lw.workflow_id
     WHERE g.project_id = ?
     ORDER BY g.position, lw.priority DESC, w.name`,
  ).bind(projectId(context)).all<SqlRow>();
  return {
    groups: groups.results.map((group) => ({
      ...group,
      workflows: associations.results.filter((entry) => entry.group_id === group.id),
    })),
  };
}

export async function createLaunchpadGroup(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const environmentId = requiredString(body.environment_id, "environment_id", 192);
  const environment = await context.env.DB.prepare(
    `SELECT id FROM flow_environments
     WHERE id = ? AND project_id = ?`,
  ).bind(environmentId, projectId(context)).first();
  if (!environment) throw failure("flow_environment_not_found", "Environment not found", 404);
  const id = crypto.randomUUID();
  const position = integer(body.position ?? 0, "position", 0, 10_000);
  const concurrency = body.concurrency_limit == null
    ? null
    : integer(body.concurrency_limit, "concurrency_limit", 1, 100_000);
  const name = requiredString(body.name, "name", 180);
  const now = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO flow_launchpad_groups
      (id, project_id, environment_id, name, position,
       concurrency_limit, paused, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, projectId(context), environmentId, name, position, concurrency, body.paused === true ? 1 : 0, now, now).run();
  await audit(context, "flows.launchpad-group.created", "launchpad_group", id, { environment_id: environmentId });
  return { id, environment_id: environmentId, name, position, concurrency_limit: concurrency, paused: body.paused === true, created_at: now };
}

export async function updateLaunchpadGroup(
  context: FlowContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const existing = await context.env.DB.prepare(
    `SELECT * FROM flow_launchpad_groups
     WHERE id = ? AND project_id = ?`,
  ).bind(groupId, projectId(context)).first<SqlRow>();
  if (!existing) throw failure("flow_launchpad_group_not_found", "Launchpad group not found", 404);
  const name = body.name == null ? String(existing.name) : requiredString(body.name, "name", 180);
  const position = body.position == null ? Number(existing.position) : integer(body.position, "position", 0, 10_000);
  const concurrency = body.concurrency_limit === undefined
    ? existing.concurrency_limit == null ? null : Number(existing.concurrency_limit)
    : body.concurrency_limit == null ? null : integer(body.concurrency_limit, "concurrency_limit", 1, 100_000);
  const paused = body.paused === undefined ? Number(existing.paused) === 1 : body.paused === true;
  const now = isoNow();
  await context.env.DB.prepare(
    `UPDATE flow_launchpad_groups SET name = ?, position = ?, concurrency_limit = ?, paused = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  ).bind(name, position, concurrency, paused ? 1 : 0, now, groupId, projectId(context)).run();
  await audit(context, "flows.launchpad-group.updated", "launchpad_group", groupId, { position, concurrency_limit: concurrency, paused });
  return { id: groupId, name, position, concurrency_limit: concurrency, paused, updated_at: now };
}

export async function setLaunchpadWorkflows(
  context: FlowContext,
  groupId: string,
  body: Record<string, unknown>,
) {
  const group = await context.env.DB.prepare(
    `SELECT id FROM flow_launchpad_groups
     WHERE id = ? AND project_id = ?`,
  ).bind(groupId, projectId(context)).first();
  if (!group) throw failure("flow_launchpad_group_not_found", "Launchpad group not found", 404);
  if (!Array.isArray(body.workflows) || body.workflows.length > 500) {
    throw failure("flow_launchpad_workflows_invalid", "Launchpad workflows are invalid", 422);
  }
  const parsed: Array<{ workflowId: string; priority: number }> = [];
  for (const entry of body.workflows) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw failure("flow_launchpad_workflows_invalid", "Launchpad workflow is invalid", 422);
    }
    const row = entry as Record<string, unknown>;
    const workflowId = requiredString(row.workflow_id, "workflow_id", 192);
    await requireWorkflow(context, workflowId);
    parsed.push({ workflowId, priority: integer(row.priority ?? 0, "priority", -100_000, 100_000) });
  }
  await context.env.DB.batch([
    context.env.DB.prepare(
      `DELETE FROM flow_launchpad_workflows
       WHERE group_id IN (
         SELECT id FROM flow_launchpad_groups WHERE id = ? AND project_id = ?
       )`,
    ).bind(groupId, projectId(context)),
    ...parsed.map((entry) => context.env.DB.prepare(
      `INSERT INTO flow_launchpad_workflows (group_id, workflow_id, priority)
       SELECT g.id, w.id, ? FROM flow_launchpad_groups g
       JOIN flow_workflows w ON w.project_id = g.project_id
       WHERE g.id = ? AND g.project_id = ? AND w.id = ?`,
    ).bind(entry.priority, groupId, projectId(context), entry.workflowId)),
    context.env.DB.prepare(
      `DELETE FROM flow_launchpad_assignments
       WHERE project_id = ? AND group_id = ?
         AND workflow_id NOT IN (
           SELECT workflow_id FROM flow_launchpad_workflows WHERE group_id = ?
         )`,
    ).bind(projectId(context), groupId, groupId),
  ]);
  await audit(context, "flows.launchpad-group.workflows-set", "launchpad_group", groupId, { count: parsed.length });
  return { id: groupId, workflows: parsed.map((entry) => ({ workflow_id: entry.workflowId, priority: entry.priority })) };
}

export async function deleteLaunchpadGroup(
  context: FlowContext,
  groupId: string,
): Promise<void> {
  const result = await context.env.DB.prepare(
    `DELETE FROM flow_launchpad_groups
     WHERE id = ? AND project_id = ?`,
  ).bind(groupId, projectId(context)).run();
  if (!result.meta.changes) throw failure("flow_launchpad_group_not_found", "Launchpad group not found", 404);
  await audit(context, "flows.launchpad-group.deleted", "launchpad_group", groupId);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw failure("validation_failed", `${field} must be an integer between ${minimum} and ${maximum}`, 422);
  }
  return value;
}
