import type {
  FlowGraph,
  FlowWorkflowFrequency,
} from "@superboard/contracts/flows";
import type { FlowContext, SqlRow } from "../d1/helpers";
import {
  actorId,
  audit,
  isoNow,
  parseJsonArray,
  parseJsonObject,
  projectId,
  requireWorkflow,
  sha256,
} from "../d1/helpers";
import { failure } from "../http/errors";
import { flowWorkflowInstanceId } from "./instance-id";
import {
  identifier,
  optionalString,
  assertPublishableFlowGraph,
  parseFlowGraph,
  requiredString,
} from "../http/validation";

export async function listWorkflows(
  context: FlowContext,
) {
  const url = new URL(context.req.url);
  const status = url.searchParams.get("status")?.trim() || "";
  const origin = url.searchParams.get("origin")?.trim() || "";
  const search = url.searchParams.get("search")?.trim() || "";
  const conditions = ["w.project_id = ?"];
  const bindings: unknown[] = [projectId(context)];
  if (status) {
    conditions.push("w.status = ?");
    bindings.push(status);
  } else {
    conditions.push("w.status != 'archived'");
  }
  if (origin) {
    conditions.push("w.origin = ?");
    bindings.push(origin);
  }
  if (search) {
    conditions.push("(w.name LIKE ? ESCAPE '\\' OR w.identifier LIKE ? ESCAPE '\\')");
    const query = `%${escapeLike(search)}%`;
    bindings.push(query, query);
  }
  const rows = await context.env.DB.prepare(
    `SELECT w.*,
       (SELECT MAX(v.version) FROM flow_workflow_versions v
        WHERE v.project_id = w.project_id AND v.workflow_id = w.id) AS latest_version,
       (SELECT COUNT(*) FROM flow_environment_releases r
        WHERE r.project_id = w.project_id AND r.workflow_id = w.id
          AND r.active = 1) AS active_environments
     FROM flow_workflows w
     WHERE ${conditions.join(" AND ")}
     ORDER BY w.updated_at DESC, w.id DESC LIMIT 500`,
  )
    .bind(...bindings)
    .all<SqlRow>();
  return { items: rows.results };
}

export async function createWorkflow(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const name = requiredString(body.name, "name", 180);
  const key = identifier(body.identifier, "identifier");
  const frequency = parseFrequency(body.frequency);
  const origin = parseOrigin(body.origin);
  const graph = await stampNewComponentVersions(
    context,
    body.graph == null ? defaultGraph(id) : parseFlowGraph(body.graph),
  );
  const now = isoNow();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_workflows
        (id, project_id, identifier, name, description,
         frequency, status, origin, legacy_id, draft_revision, created_by,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, 1, ?, ?, ?)`,
    ).bind(
      id,
      projectId(context),
      key,
      name,
      optionalString(body.description, "description", 2_000),
      frequency,
      origin,
      optionalString(body.legacy_id, "legacy_id", 192),
      actorId(context),
      now,
      now,
    ),
    context.env.DB.prepare(
      `INSERT INTO flow_workflow_drafts
        (workflow_id, project_id, revision, graph_json,
         validation_json, updated_by, updated_at)
       VALUES (?, ?, 1, ?, '{"valid":true,"issues":[]}', ?, ?)`,
    ).bind(id, projectId(context), JSON.stringify(graph), actorId(context), now),
  ]);
  await audit(context, "flows.workflow.created", "workflow", id, { identifier: key, origin });
  return {
    id,
    identifier: key,
    name,
    description: optionalString(body.description, "description", 2_000),
    frequency,
    status: "draft",
    origin,
    draft_revision: 1,
    graph,
    created_at: now,
    updated_at: now,
  };
}

export async function getWorkflow(
  context: FlowContext,
  workflowId: string,
) {
  const workflow = await requireWorkflow(context, workflowId);
  const [draft, versions, releases, translations] = await Promise.all([
    context.env.DB.prepare(
      `SELECT revision, graph_json, validation_json, updated_by, updated_at
       FROM flow_workflow_drafts
       WHERE workflow_id = ? AND project_id = ?`,
    ).bind(workflowId, projectId(context)).first<SqlRow>(),
    context.env.DB.prepare(
      `SELECT id, version, changelog, checksum_sha256, migration_strategy,
        published_by, published_at
       FROM flow_workflow_versions
       WHERE workflow_id = ? AND project_id = ?
       ORDER BY version DESC`,
    ).bind(workflowId, projectId(context)).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT r.environment_id, e.name AS environment_name, e.key AS environment_key,
        r.workflow_version_id, v.version, r.use_draft, r.active, r.activated_at
       FROM flow_environment_releases r
       JOIN flow_environments e ON e.id = r.environment_id
       LEFT JOIN flow_workflow_versions v ON v.id = r.workflow_version_id
       WHERE r.workflow_id = ? AND r.project_id = ?
       ORDER BY e.created_at`,
    ).bind(workflowId, projectId(context)).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT block_key, property_key, locale, value_json, updated_at
       FROM flow_translations WHERE workflow_id = ? AND project_id = ?
       ORDER BY block_key, property_key, locale`,
    ).bind(workflowId, projectId(context)).all<SqlRow>(),
  ]);
  return {
    ...workflow,
    draft: draft
      ? {
          ...draft,
          graph: parseJsonObject(draft.graph_json),
          validation: parseJsonObject(draft.validation_json),
          graph_json: undefined,
          validation_json: undefined,
        }
      : null,
    versions: versions.results,
    releases: releases.results,
    translations: translations.results.map((row) => ({
      ...row,
      value: parseUnknownJson(row.value_json),
      value_json: undefined,
    })),
  };
}

export async function updateWorkflow(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  const existing = await requireWorkflow(context, workflowId);
  const name = body.name == null ? String(existing.name) : requiredString(body.name, "name", 180);
  const description = body.description === undefined
    ? optionalString(existing.description, "description", 2_000)
    : optionalString(body.description, "description", 2_000);
  const frequency = body.frequency == null
    ? parseFrequency(existing.frequency)
    : parseFrequency(body.frequency);
  const status = body.status == null ? String(existing.status) : requiredString(body.status, "status", 32);
  if (!new Set(["draft", "active", "paused", "archived"]).has(status)) {
    throw failure("flow_workflow_status_invalid", "Workflow status is invalid", 422);
  }
  const now = isoNow();
  await context.env.DB.prepare(
    `UPDATE flow_workflows SET name = ?, description = ?, frequency = ?, status = ?,
       updated_at = ?, archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END
     WHERE id = ? AND project_id = ?`,
  ).bind(name, description, frequency, status, now, status, now, workflowId, projectId(context)).run();
  await audit(context, "flows.workflow.updated", "workflow", workflowId, { name, frequency, status });
  return { id: workflowId, name, description, frequency, status, updated_at: now };
}

export async function saveDraft(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  await requireWorkflow(context, workflowId);
  const graph = await stampNewComponentVersions(
    context,
    parseFlowGraph(body.graph),
  );
  const expectedRevision =
    typeof body.revision === "number" && Number.isInteger(body.revision)
      ? body.revision
      : null;
  if (expectedRevision == null || expectedRevision < 1) {
    throw failure("flow_draft_revision_required", "Draft revision is required", 422);
  }
  const nextRevision = expectedRevision + 1;
  const now = isoNow();
  const result = await context.env.DB.prepare(
    `UPDATE flow_workflow_drafts
     SET revision = ?, graph_json = ?, validation_json = '{"valid":true,"issues":[]}',
       updated_by = ?, updated_at = ?
     WHERE workflow_id = ? AND project_id = ? AND revision = ?`,
  ).bind(nextRevision, JSON.stringify(graph), actorId(context), now, workflowId, projectId(context), expectedRevision).run();
  if (!result.meta.changes) {
    throw failure(
      "flow_draft_revision_conflict",
      "Draft changed in another session; reload before saving",
      409,
    );
  }
  await context.env.DB.prepare(
    `UPDATE flow_workflows SET draft_revision = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  ).bind(nextRevision, now, workflowId, projectId(context)).run();
  await audit(context, "flows.workflow.draft-saved", "workflow", workflowId, { revision: nextRevision });
  return { workflow_id: workflowId, revision: nextRevision, graph, validation: { valid: true, issues: [] }, updated_at: now };
}

export async function publishWorkflow(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  await requireWorkflow(context, workflowId);
  const draft = await context.env.DB.prepare(
    `SELECT revision, graph_json FROM flow_workflow_drafts
     WHERE workflow_id = ? AND project_id = ?`,
  ).bind(workflowId, projectId(context)).first<{ revision: number; graph_json: string }>();
  if (!draft) throw failure("flow_draft_not_found", "Workflow draft not found", 404);
  const graph = parseFlowGraph(parseUnknownJson(draft.graph_json));
  assertPublishableFlowGraph(graph);
  await assertWorkflowTriggerTargets(
    context,
    workflowId,
    graph,
  );
  const strategy = parseMigrationStrategy(body.migration_strategy);
  const translationRows = await context.env.DB.prepare(
    `SELECT block_key, property_key, locale, value_json
     FROM flow_translations
     WHERE project_id = ? AND workflow_id = ?
     ORDER BY block_key, property_key, locale`,
  ).bind(projectId(context), workflowId).all<{
    block_key: string;
    property_key: string;
    locale: string;
    value_json: string;
  }>();
  const versionRow = await context.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM flow_workflow_versions WHERE project_id = ? AND workflow_id = ?`,
  ).bind(projectId(context), workflowId).first<{ next_version: number }>();
  const version = Number(versionRow?.next_version ?? 1);
  const id = crypto.randomUUID();
  const checksum = await sha256(
    JSON.stringify({ graph, translations: translationRows.results }),
  );
  const now = isoNow();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(
      `INSERT INTO flow_workflow_versions
        (id, project_id, workflow_id, version, graph_json,
         changelog, checksum_sha256, migration_strategy, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      projectId(context),
      workflowId,
      version,
      JSON.stringify(graph),
      optionalString(body.changelog, "changelog", 2_000),
      checksum,
      strategy,
      actorId(context),
      now,
    ),
    context.env.DB.prepare(
      `UPDATE flow_workflows SET status = 'active', updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(now, workflowId, projectId(context)),
  ];
  for (const translation of translationRows.results) {
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO flow_version_translations
          (id, project_id, workflow_id, workflow_version_id,
           block_key, property_key, locale, value_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        projectId(context),
        workflowId,
        id,
        translation.block_key,
        translation.property_key,
        translation.locale,
        translation.value_json,
        now,
      ),
    );
  }
  await context.env.DB.batch(statements);
  await audit(context, "flows.workflow.published", "workflow_version", id, { workflow_id: workflowId, version, migration_strategy: strategy });
  return { id, workflow_id: workflowId, version, checksum_sha256: checksum, migration_strategy: strategy, published_at: now };
}

export async function getVersion(
  context: FlowContext,
  workflowId: string,
  versionId: string,
) {
  await requireWorkflow(context, workflowId);
  const [row, translations] = await Promise.all([
    context.env.DB.prepare(
    `SELECT * FROM flow_workflow_versions
     WHERE id = ? AND workflow_id = ? AND project_id = ?`,
    ).bind(versionId, workflowId, projectId(context)).first<SqlRow>(),
    context.env.DB.prepare(
      `SELECT block_key, property_key, locale, value_json, created_at
       FROM flow_version_translations
       WHERE workflow_version_id = ? AND workflow_id = ? AND project_id = ?
       ORDER BY block_key, property_key, locale`,
    ).bind(versionId, workflowId, projectId(context)).all<SqlRow>(),
  ]);
  if (!row) throw failure("flow_version_not_found", "Workflow version not found", 404);
  return {
    ...row,
    graph: parseUnknownJson(row.graph_json),
    translations: translations.results.map((translation) => ({
      ...translation,
      value: parseUnknownJson(translation.value_json),
      value_json: undefined,
    })),
    graph_json: undefined,
  };
}

export async function activateWorkflow(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  await requireWorkflow(context, workflowId);
  const environmentId = requiredString(body.environment_id, "environment_id", 192);
  const useDraft = body.use_draft === true;
  const environment = await context.env.DB.prepare(
    `SELECT id, allow_draft FROM flow_environments
     WHERE id = ? AND project_id = ? AND active = 1`,
  ).bind(environmentId, projectId(context)).first<{ id: string; allow_draft: number }>();
  if (!environment) throw failure("flow_environment_not_found", "Environment not found", 404);
  if (useDraft && Number(environment.allow_draft) !== 1) {
    throw failure("flow_environment_draft_forbidden", "This environment does not allow draft releases", 409);
  }
  let versionId: string | null = null;
  let runtimeVersionId: string;
  let releaseGraph: FlowGraph;
  if (!useDraft) {
    versionId = requiredString(body.version_id, "version_id", 192);
    const version = await context.env.DB.prepare(
      `SELECT id, graph_json FROM flow_workflow_versions
       WHERE id = ? AND workflow_id = ? AND project_id = ?`,
    ).bind(versionId, workflowId, projectId(context)).first<{
      id: string;
      graph_json: string;
    }>();
    if (!version) throw failure("flow_version_not_found", "Workflow version not found", 404);
    releaseGraph = parseFlowGraph(parseUnknownJson(version.graph_json));
    runtimeVersionId = version.id;
  } else {
    const draft = await context.env.DB.prepare(
      `SELECT graph_json, revision FROM flow_workflow_drafts
       WHERE workflow_id = ? AND project_id = ?`,
    ).bind(workflowId, projectId(context)).first<{
      graph_json: string;
      revision: number;
    }>();
    if (!draft) throw failure("flow_draft_not_found", "Workflow draft not found", 404);
    releaseGraph = parseFlowGraph(parseUnknownJson(draft.graph_json));
    runtimeVersionId = `draft:${Number(draft.revision)}`;
  }
  const triggerTargets = releaseGraph.blocks.filter(
    (block) => block.type === "workflow-trigger",
  );
  for (const trigger of triggerTargets) {
    const targetId = String(trigger.data.workflowId);
    const blockKey = String(trigger.data.blockKey ?? "");
    const targetReleaseGraph = await effectiveReleaseGraph(
      context,
      environmentId,
      targetId,
    );
    if (!targetReleaseGraph) {
      throw failure(
        "flow_workflow_trigger_release_missing",
        "Every triggered workflow must be active in the selected environment",
        409,
        { workflow_id: targetId, environment_id: environmentId },
      );
    }
    if (!targetReleaseGraph.blocks.some(
      (block) => block.type === "manual-start" && block.key === blockKey,
    )) {
      throw failure(
        "flow_workflow_trigger_manual_start_not_found",
        "The triggered workflow release does not expose the selected Manual Start block",
        409,
        {
          workflow_id: targetId,
          environment_id: environmentId,
          block_key: blockKey,
        },
      );
    }
  }
  const now = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO flow_environment_releases
      (project_id, environment_id, workflow_id,
       workflow_version_id, use_draft, active, activated_by, activated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(environment_id, workflow_id) DO UPDATE SET
       workflow_version_id = excluded.workflow_version_id,
       use_draft = excluded.use_draft,
       active = 1,
       activated_by = excluded.activated_by,
       activated_at = excluded.activated_at
     WHERE flow_environment_releases.project_id = excluded.project_id`,
  ).bind(projectId(context), environmentId, workflowId, versionId, useDraft ? 1 : 0, actorId(context), now).run();
  const migrationBusinessId = [
    projectId(context),
    environmentId,
    workflowId,
    runtimeVersionId,
    now,
  ].join(":");
  const migrationExecutionId = await flowWorkflowInstanceId(
    "flow-release",
    migrationBusinessId,
  );
  await context.env.FLOW_MAINTENANCE_EXECUTION.create({
    id: migrationExecutionId,
    params: {
      id: migrationExecutionId,
      projectId: projectId(context),
      operation: "migrate-release",
      environmentId,
      workflowId,
      workflowVersionId: runtimeVersionId,
      useDraft,
    },
  });
  await audit(context, "flows.workflow.activated", "workflow", workflowId, {
    environment_id: environmentId,
    version_id: versionId,
    runtime_version_id: runtimeVersionId,
    use_draft: useDraft,
    migration_execution_id: migrationExecutionId,
  });
  return {
    workflow_id: workflowId,
    environment_id: environmentId,
    version_id: versionId,
    runtime_version_id: runtimeVersionId,
    use_draft: useDraft,
    active: true,
    activated_at: now,
    migration_execution_id: migrationExecutionId,
  };
}

async function effectiveReleaseGraph(
  context: FlowContext,
  environmentId: string,
  workflowId: string,
): Promise<FlowGraph | null> {
  const release = await context.env.DB.prepare(
    `SELECT r.workflow_version_id, r.use_draft
     FROM flow_environment_releases r
     JOIN flow_workflows w
       ON w.id = r.workflow_id AND w.project_id = r.project_id
     WHERE r.project_id = ? AND r.environment_id = ?
       AND r.workflow_id = ? AND r.active = 1 AND w.status = 'active'`,
  ).bind(
    projectId(context),
    environmentId,
    workflowId,
  ).first<{ workflow_version_id: string | null; use_draft: number }>();
  if (!release) return null;
  if (Number(release.use_draft) === 1) {
    const draft = await context.env.DB.prepare(
      `SELECT graph_json FROM flow_workflow_drafts
       WHERE project_id = ? AND workflow_id = ?`,
    ).bind(projectId(context), workflowId).first<{ graph_json: string }>();
    return draft ? parseFlowGraph(parseUnknownJson(draft.graph_json)) : null;
  }
  if (!release.workflow_version_id) return null;
  const version = await context.env.DB.prepare(
    `SELECT graph_json FROM flow_workflow_versions
     WHERE project_id = ? AND workflow_id = ? AND id = ?`,
  ).bind(
    projectId(context),
    workflowId,
    release.workflow_version_id,
  ).first<{ graph_json: string }>();
  return version ? parseFlowGraph(parseUnknownJson(version.graph_json)) : null;
}

export async function deactivateWorkflow(
  context: FlowContext,
  workflowId: string,
  environmentId: string,
): Promise<void> {
  await requireWorkflow(context, workflowId);
  const result = await context.env.DB.prepare(
    `UPDATE flow_environment_releases SET active = 0, activated_at = ?
     WHERE project_id = ? AND environment_id = ? AND workflow_id = ?`,
  ).bind(isoNow(), projectId(context), environmentId, workflowId).run();
  if (!result.meta.changes) throw failure("flow_release_not_found", "Workflow release not found", 404);
  await audit(context, "flows.workflow.deactivated", "workflow", workflowId, { environment_id: environmentId });
}

export async function duplicateWorkflow(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  const original = await requireWorkflow(context, workflowId);
  const draftRow = await context.env.DB.prepare(
    `SELECT graph_json FROM flow_workflow_drafts
     WHERE workflow_id = ? AND project_id = ?`,
  ).bind(workflowId, projectId(context)).first<{ graph_json: string }>();
  return createWorkflow(context, {
    name: body.name ?? `${String(original.name)} copy`,
    identifier: body.identifier,
    description: original.description,
    frequency: original.frequency,
    graph: draftRow ? parseUnknownJson(draftRow.graph_json) : undefined,
  });
}

export async function saveTranslations(
  context: FlowContext,
  workflowId: string,
  body: Record<string, unknown>,
) {
  await requireWorkflow(context, workflowId);
  if (!Array.isArray(body.items) || body.items.length > 5_000) {
    throw failure("flow_translations_invalid", "Translation items are invalid", 422);
  }
  const now = isoNow();
  const statements = body.items.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw failure("flow_translations_invalid", "Translation item is invalid", 422);
    }
    const item = entry as Record<string, unknown>;
    return context.env.DB.prepare(
      `INSERT INTO flow_translations
        (id, project_id, workflow_id, block_key,
         property_key, locale, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id, block_key, property_key, locale) DO UPDATE SET
         value_json = excluded.value_json, updated_at = excluded.updated_at
       WHERE flow_translations.project_id = excluded.project_id`,
    ).bind(
      crypto.randomUUID(),
      projectId(context),
      workflowId,
      identifier(item.block_key, "block_key"),
      identifier(item.property_key, "property_key"),
      requiredString(item.locale, "locale", 64),
      JSON.stringify(item.value ?? null),
      now,
    );
  });
  if (statements.length) await context.env.DB.batch(statements);
  await audit(context, "flows.workflow.translations-saved", "workflow", workflowId, { count: statements.length });
  return { workflow_id: workflowId, count: statements.length, updated_at: now };
}

function defaultGraph(workflowId: string): FlowGraph {
  const startId = `${workflowId}:start`;
  const componentId = `${workflowId}:component`;
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: startId,
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 120 },
      },
      {
        id: componentId,
        key: "welcome_card",
        type: "component",
        name: "Welcome card",
        componentType: "BasicsV2Card",
        componentLibraryName: "Basics V2",
        data: {
          title: "Welcome",
          body: "Build your first SuperBoard Flow.",
          dismissible: true,
        },
        propertyMeta: [
          {
            key: "primaryButton",
            type: "action",
            value: { label: "Continue", exitNode: "continue" },
          },
        ],
        exitNodes: ["continue", "close"],
        slottable: true,
        slotId: "default",
        slotIndex: 0,
        position: { x: 320, y: 120 },
      },
    ],
    paths: [
      {
        id: `${workflowId}:path:start`,
        sourceBlockId: startId,
        sourceExitNode: "default",
        targetBlockId: componentId,
      },
    ],
  };
}

async function stampNewComponentVersions(
  context: FlowContext,
  graph: FlowGraph,
): Promise<FlowGraph> {
  const definitions = await context.env.DB.prepare(
    `SELECT d.key, d.component_type, d.current_version, d.schema_json,
      d.exit_nodes_json, l.name AS library_name, l.identifier AS library_identifier
     FROM flow_component_definitions d
     JOIN flow_component_libraries l ON l.id = d.library_id
     WHERE d.project_id = ? AND l.enabled = 1
     ORDER BY l.created_at, d.created_at`,
  ).bind(projectId(context)).all<{
    key: string;
    component_type: string;
    current_version: number;
    schema_json: string;
    exit_nodes_json: string;
    library_name: string;
    library_identifier: string;
  }>();
  return {
    ...graph,
    blocks: graph.blocks.map((block) => {
      if (
        !new Set(["component", "tour-component", "survey"]).has(block.type) ||
        Number.isInteger(block.data.componentVersion)
      ) {
        return block;
      }
      const definition = definitions.results.find((candidate) => {
        const schema = parseJsonObject(candidate.schema_json);
        const templateType = schema.template_type === "survey-component"
          ? "survey"
          : schema.template_type;
        if (typeof templateType === "string" && templateType !== block.type) {
          return false;
        }
        const typeMatches =
          block.componentType === candidate.component_type ||
          block.componentType === candidate.key ||
          block.data.componentKey === candidate.key;
        if (!typeMatches) return false;
        if (!block.componentLibraryName) return true;
        const library = normalizeLibrary(block.componentLibraryName);
        return library === normalizeLibrary(candidate.library_name) ||
          library === normalizeLibrary(candidate.library_identifier);
      });
      if (!definition) return block;
      const schema = parseJsonObject(definition.schema_json);
      return {
        ...block,
        componentType: definition.component_type,
        componentLibraryName: definition.library_name,
        data: {
          ...block.data,
          componentKey: definition.key,
          componentVersion: Number(definition.current_version),
        },
        exitNodes: parseJsonArray(definition.exit_nodes_json).map(String),
        slottable: schema.slottable === true,
      };
    }),
  };
}

function normalizeLibrary(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

async function assertWorkflowTriggerTargets(
  context: FlowContext,
  rootWorkflowId: string,
  rootGraph: FlowGraph,
): Promise<void> {
  const completed = new Set<string>();
  const visit = async (
    workflowId: string,
    graph: FlowGraph,
    active: ReadonlySet<string>,
    depth: number,
  ): Promise<void> => {
    if (depth > 8) {
      throw failure(
        "flow_workflow_trigger_depth_invalid",
        "Workflow trigger chains cannot exceed eight workflows",
        422,
      );
    }
    const nextActive = new Set(active).add(workflowId);
    for (const block of graph.blocks.filter(
      (entry) => entry.type === "workflow-trigger",
    )) {
      const targetId = String(block.data.workflowId);
      if (nextActive.has(targetId)) {
        throw failure(
          "flow_workflow_trigger_cycle_invalid",
          "Workflow triggers cannot form a cycle",
          422,
        );
      }
      if (completed.has(targetId)) continue;
      const target = await context.env.DB.prepare(
        `SELECT d.graph_json FROM flow_workflows w
         JOIN flow_workflow_drafts d
           ON d.project_id = w.project_id
             AND d.workflow_id = w.id
         WHERE w.id = ? AND w.project_id = ?
           AND w.status != 'archived'`,
      ).bind(
        targetId,
        projectId(context),
      ).first<{ graph_json: string }>();
      if (!target) {
        throw failure(
          "flow_workflow_trigger_target_not_found",
          `Workflow trigger ${block.key} references an unavailable workflow`,
          422,
        );
      }
      const targetGraph = parseFlowGraph(parseUnknownJson(target.graph_json));
      const manualStartKey = String(block.data.blockKey ?? "");
      if (!targetGraph.blocks.some(
        (entry) => entry.type === "manual-start" && entry.key === manualStartKey,
      )) {
        throw failure(
          "flow_workflow_trigger_manual_start_not_found",
          `Workflow trigger ${block.key} references an unavailable Manual Start block`,
          422,
        );
      }
      await visit(
        targetId,
        targetGraph,
        nextActive,
        depth + 1,
      );
      completed.add(targetId);
    }
  };
  await visit(rootWorkflowId, rootGraph, new Set(), 1);
}

function parseFrequency(value: unknown): FlowWorkflowFrequency {
  return value === "every-time" ? "every-time" : "once";
}

function parseOrigin(value: unknown): "flows" | "paywalls" | "onboardings" {
  return value === "paywalls" || value === "onboardings" ? value : "flows";
}

function parseMigrationStrategy(value: unknown) {
  const strategy = typeof value === "string" ? value : "finish-current";
  if (!new Set(["finish-current", "restart-current", "restart-all"]).has(strategy)) {
    throw failure("flow_migration_strategy_invalid", "Migration strategy is invalid", 422);
  }
  return strategy as "finish-current" | "restart-current" | "restart-all";
}

function parseUnknownJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
