import type { FlowContext, SqlRow } from "../d1/helpers";
import type { FlowGraph } from "@superboard/contracts/flows";
import {
  actorId,
  audit,
  isoNow,
  parseJsonArray,
  parseJsonObject,
  projectId,
} from "../d1/helpers";
import { failure } from "../http/errors";
import {
  identifier,
  requiredString,
} from "../http/validation";

export async function listComponents(context: FlowContext) {
  const [libraries, definitions] = await Promise.all([
    context.env.DB.prepare(
      `SELECT * FROM flow_component_libraries
       WHERE project_id = ? ORDER BY created_at`,
    ).bind(projectId(context)).all<SqlRow>(),
    context.env.DB.prepare(
      `SELECT d.*, l.name AS library_name, l.identifier AS library_identifier,
        (SELECT COUNT(*) FROM flow_workflow_drafts wd,
          json_each(wd.graph_json, '$.blocks') block
         WHERE wd.project_id = d.project_id
           AND (json_extract(block.value, '$.componentType') = d.component_type
             OR json_extract(block.value, '$.componentType') = d.key
             OR json_extract(block.value, '$.data.componentKey') = d.key)
           AND (json_extract(d.schema_json, '$.template_type') IS NULL
             OR json_extract(block.value, '$.type') =
               CASE json_extract(d.schema_json, '$.template_type')
                 WHEN 'survey-component' THEN 'survey'
                 ELSE json_extract(d.schema_json, '$.template_type') END)
           AND (json_extract(block.value, '$.componentLibraryName') IS NULL
             OR lower(replace(json_extract(block.value, '$.componentLibraryName'), ' ', '-'))
               IN (lower(replace(l.name, ' ', '-')), lower(l.identifier)))) AS instance_count,
        (SELECT COUNT(*) FROM flow_workflow_drafts wd,
          json_each(wd.graph_json, '$.blocks') block
         WHERE wd.project_id = d.project_id
           AND (json_extract(block.value, '$.componentType') = d.component_type
             OR json_extract(block.value, '$.componentType') = d.key
             OR json_extract(block.value, '$.data.componentKey') = d.key)
           AND (json_extract(d.schema_json, '$.template_type') IS NULL
             OR json_extract(block.value, '$.type') =
               CASE json_extract(d.schema_json, '$.template_type')
                 WHEN 'survey-component' THEN 'survey'
                 ELSE json_extract(d.schema_json, '$.template_type') END)
           AND (json_extract(block.value, '$.componentLibraryName') IS NULL
             OR lower(replace(json_extract(block.value, '$.componentLibraryName'), ' ', '-'))
               IN (lower(replace(l.name, ' ', '-')), lower(l.identifier)))
           AND COALESCE(CAST(json_extract(block.value, '$.data.componentVersion') AS INTEGER), 0)
             < d.current_version) AS outdated_instances
       FROM flow_component_definitions d
       JOIN flow_component_libraries l ON l.id = d.library_id
       WHERE d.project_id = ?
       ORDER BY l.created_at, d.name`,
    ).bind(projectId(context)).all<SqlRow>(),
  ]);
  return {
    libraries: libraries.results,
    items: definitions.results.map(componentView),
  };
}

export async function createLibrary(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const name = requiredString(body.name, "name", 180);
  const key = identifier(body.identifier, "identifier");
  const now = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO flow_component_libraries
      (id, project_id, name, identifier, enabled, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 'custom', ?, ?)`,
  ).bind(id, projectId(context), name, key, now, now).run();
  await audit(context, "flows.component-library.created", "component_library", id, { identifier: key });
  return { id, name, identifier: key, enabled: true, source: "custom", created_at: now };
}

export async function updateLibrary(
  context: FlowContext,
  libraryId: string,
  body: Record<string, unknown>,
) {
  const name = requiredString(body.name, "name", 180);
  const enabled = body.enabled !== false;
  const now = isoNow();
  const result = await context.env.DB.prepare(
    `UPDATE flow_component_libraries SET name = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  ).bind(name, enabled ? 1 : 0, now, libraryId, projectId(context)).run();
  if (!result.meta.changes) throw failure("flow_component_library_not_found", "Component library not found", 404);
  await audit(context, "flows.component-library.updated", "component_library", libraryId, { enabled });
  return { id: libraryId, name, enabled, updated_at: now };
}

export async function createComponent(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const libraryId = requiredString(body.library_id, "library_id", 192);
  const library = await context.env.DB.prepare(
    `SELECT id FROM flow_component_libraries
     WHERE id = ? AND project_id = ?`,
  ).bind(libraryId, projectId(context)).first();
  if (!library) throw failure("flow_component_library_not_found", "Component library not found", 404);
  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const name = requiredString(body.name, "name", 180);
  const key = identifier(body.key, "key");
  const componentType = identifier(body.component_type, "component_type");
  const schema = object(body.schema);
  const exitNodes = stringArray(body.exit_nodes, "exit_nodes");
  const cssVariables = object(body.css_variables);
  const now = isoNow();
  const definition = { name, key, component_type: componentType, schema, exit_nodes: exitNodes, css_variables: cssVariables };
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_component_definitions
        (id, project_id, library_id, name, key, component_type,
         schema_json, exit_nodes_json, css_variables_json, current_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(id, projectId(context), libraryId, name, key, componentType, JSON.stringify(schema), JSON.stringify(exitNodes), JSON.stringify(cssVariables), now, now),
    context.env.DB.prepare(
      `INSERT INTO flow_component_versions
        (id, project_id, component_id, version, definition_json, created_by, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(versionId, projectId(context), id, JSON.stringify(definition), actorId(context), now),
  ]);
  await audit(context, "flows.component.created", "component", id, { key });
  return { id, library_id: libraryId, ...definition, current_version: 1, created_at: now };
}

export async function updateComponent(
  context: FlowContext,
  componentId: string,
  body: Record<string, unknown>,
) {
  const existing = await context.env.DB.prepare(
    `SELECT * FROM flow_component_definitions
     WHERE id = ? AND project_id = ?`,
  ).bind(componentId, projectId(context)).first<SqlRow>();
  if (!existing) throw failure("flow_component_not_found", "Component not found", 404);
  const version = Number(existing.current_version) + 1;
  const name = body.name == null ? String(existing.name) : requiredString(body.name, "name", 180);
  const schema = body.schema == null ? parseJsonObject(existing.schema_json) : object(body.schema);
  const exitNodes = body.exit_nodes == null ? parseJsonArray(existing.exit_nodes_json).map(String) : stringArray(body.exit_nodes, "exit_nodes");
  const cssVariables = body.css_variables == null ? parseJsonObject(existing.css_variables_json) : object(body.css_variables);
  const definition = { name, key: String(existing.key), component_type: String(existing.component_type), schema, exit_nodes: exitNodes, css_variables: cssVariables };
  const now = isoNow();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE flow_component_definitions
       SET name = ?, schema_json = ?, exit_nodes_json = ?, css_variables_json = ?,
         current_version = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(name, JSON.stringify(schema), JSON.stringify(exitNodes), JSON.stringify(cssVariables), version, now, componentId, projectId(context)),
    context.env.DB.prepare(
      `INSERT INTO flow_component_versions
        (id, project_id, component_id, version, definition_json, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), projectId(context), componentId, version, JSON.stringify(definition), actorId(context), now),
  ]);
  await audit(context, "flows.component.version-created", "component", componentId, { version });
  return { id: componentId, ...definition, current_version: version, updated_at: now, instances_require_sync: true };
}

export async function syncComponentInstances(
  context: FlowContext,
  componentId: string,
) {
  const component = await context.env.DB.prepare(
    `SELECT d.key, d.component_type, d.current_version, d.schema_json,
      d.exit_nodes_json, l.name AS library_name, l.identifier AS library_identifier
     FROM flow_component_definitions d
     JOIN flow_component_libraries l ON l.id = d.library_id
     WHERE d.id = ? AND d.project_id = ?`,
  ).bind(componentId, projectId(context)).first<{
    key: string;
    component_type: string;
    current_version: number;
    schema_json: string;
    exit_nodes_json: string;
    library_name: string;
    library_identifier: string;
  }>();
  if (!component) throw failure("flow_component_not_found", "Component not found", 404);
  const drafts = await context.env.DB.prepare(
    `SELECT workflow_id, revision, graph_json FROM flow_workflow_drafts
     WHERE project_id = ?`,
  ).bind(projectId(context)).all<{
    workflow_id: string;
    revision: number;
    graph_json: string;
  }>();
  const statements: D1PreparedStatement[] = [];
  let instances = 0;
  const now = isoNow();
  for (const draft of drafts.results) {
    const graph = JSON.parse(draft.graph_json) as FlowGraph;
    let changed = false;
    const nextGraph: FlowGraph = {
      ...graph,
      blocks: graph.blocks.map((block) => {
        if (!componentMatches(block, component)) return block;
        const currentVersion = Number(block.data.componentVersion ?? 0);
        if (currentVersion >= Number(component.current_version)) return block;
        changed = true;
        instances += 1;
        return {
          ...block,
          componentType: component.component_type,
          componentLibraryName: component.library_name,
          data: {
            ...block.data,
            componentKey: component.key,
            componentVersion: Number(component.current_version),
          },
          exitNodes: parseJsonArray(component.exit_nodes_json).map(String),
          slottable: parseJsonObject(component.schema_json).slottable === true,
        };
      }),
    };
    if (!changed) continue;
    statements.push(
      context.env.DB.prepare(
        `UPDATE flow_workflow_drafts
         SET graph_json = ?, revision = revision + 1, updated_by = ?, updated_at = ?
         WHERE workflow_id = ? AND project_id = ?
           AND revision = ?`,
      ).bind(
        JSON.stringify(nextGraph),
        actorId(context),
        now,
        draft.workflow_id,
        projectId(context),
        draft.revision,
      ),
    );
    statements.push(
      context.env.DB.prepare(
        `UPDATE flow_workflows SET draft_revision = ?,
          updated_at = ?
         WHERE id = ? AND project_id = ?`,
      ).bind(
        Number(draft.revision) + 1,
        now,
        draft.workflow_id,
        projectId(context),
      ),
    );
  }
  if (statements.length) await context.env.DB.batch(statements);
  await audit(context, "flows.component.instances-synchronized", "component", componentId, { version: component.current_version, instances });
  return { id: componentId, component_key: component.key, version: component.current_version, synchronized: true, instances };
}

function componentMatches(
  block: FlowGraph["blocks"][number],
  component: {
    key: string;
    component_type: string;
    schema_json: string;
    library_name: string;
    library_identifier: string;
  },
): boolean {
  const templateType = parseJsonObject(component.schema_json).template_type;
  const expectedBlockType = templateType === "survey-component"
    ? "survey"
    : templateType;
  if (typeof expectedBlockType === "string" && block.type !== expectedBlockType) {
    return false;
  }
  const typeMatches =
    block.componentType === component.component_type ||
    block.componentType === component.key ||
    block.data.componentKey === component.key;
  if (!typeMatches) return false;
  if (!block.componentLibraryName) return true;
  const normalized = normalizeLibrary(block.componentLibraryName);
  return normalized === normalizeLibrary(component.library_name) ||
    normalized === normalizeLibrary(component.library_identifier);
}

function normalizeLibrary(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

function componentView(row: SqlRow) {
  return {
    ...row,
    schema: parseJsonObject(row.schema_json),
    exit_nodes: parseJsonArray(row.exit_nodes_json),
    css_variables: parseJsonObject(row.css_variables_json),
    schema_json: undefined,
    exit_nodes_json: undefined,
    css_variables_json: undefined,
  };
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw failure("validation_failed", `${field} must be an array`, 422);
  }
  return value.map((entry) => identifier(entry, field));
}
