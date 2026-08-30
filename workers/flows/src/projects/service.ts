import { FLOW_BASICS_V2_COMPONENTS } from "../components/basics-v2.generated";
import type { FlowContext, SqlRow } from "../d1/helpers";
import {
  audit,
  isoNow,
  parseJsonArray,
  parseJsonObject,
  projectId,
  sha256,
} from "../d1/helpers";
import { failure } from "../http/errors";
import {
  identifier,
  optionalString,
  requiredString,
} from "../http/validation";

export type FlowProjectProvision = {
  projectId: number;
  projectRef: string;
  createdAt: string;
  defaultEnvironment: {
    id: string;
    key: "production" | "test";
    sdkKey?: string;
  };
};

/**
 * Provision the project-owned Flows resources. SuperBoard's signed project
 * context is the sole tenant and access authority; Flows deliberately adds no
 * parallel tenant or access model of its own.
 */
export async function ensureFlowProject(
  context: FlowContext,
): Promise<FlowProjectProvision> {
  const project = context.get("project");
  const now = isoNow();
  const environmentKey = project.environment === "test" ? "test" : "production";
  const environmentName = environmentKey === "test" ? "Test" : "Production";
  const environmentId = stableResourceId(project.projectId, "environment", environmentKey);
  const languageGroupId = stableResourceId(project.projectId, "language-group", "default");
  const libraryId = stableResourceId(project.projectId, "library", "basics-v2");
  const sdkKey = randomToken();

  await context.env.DB.prepare(
    `INSERT OR IGNORE INTO flow_projects
      (project_id, project_ref, sdk_identifier, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    project.projectId,
    project.projectRef,
    project.projectRef,
    String(project.actorId),
    now,
    now,
  ).run();

  const stored = await context.env.DB.prepare(
    `SELECT project_ref, sdk_identifier, created_at
     FROM flow_projects WHERE project_id = ?`,
  ).bind(project.projectId).first<{
    project_ref: string;
    sdk_identifier: string;
    created_at: string;
  }>();
  if (!stored || stored.project_ref !== project.projectRef) {
    throw failure(
      "flow_project_context_mismatch",
      "Flows project identity does not match the signed project context",
      409,
    );
  }

  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(
      `INSERT OR IGNORE INTO flow_environments
        (id, project_id, name, key, kind, sdk_key_hash, active, allow_draft,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      environmentId,
      project.projectId,
      environmentName,
      environmentKey,
      environmentKey,
      await sha256(sdkKey),
      environmentKey === "test" ? 1 : 0,
      now,
      now,
    ),
    context.env.DB.prepare(
      `INSERT OR IGNORE INTO flow_language_groups
        (id, project_id, name, default_locale, locales_json, fallbacks_json,
         created_at, updated_at)
       VALUES (?, ?, 'Default', 'en', '["en"]', '{}', ?, ?)`,
    ).bind(languageGroupId, project.projectId, now, now),
    context.env.DB.prepare(
      `INSERT OR IGNORE INTO flow_component_libraries
        (id, project_id, name, identifier, enabled, source, created_at, updated_at)
       VALUES (?, ?, 'Basics V2', 'basics-v2', 1, 'basics-v2', ?, ?)`,
    ).bind(libraryId, project.projectId, now, now),
  ];

  for (const component of FLOW_BASICS_V2_COMPONENTS) {
    const componentId = stableResourceId(project.projectId, "component", component.key);
    const definition = {
      name: component.name,
      key: component.key,
      component_type: component.componentType,
      schema: {
        template_type: component.templateType,
        source_key: component.sourceKey,
        icon: component.icon,
        description: component.description,
        slottable: component.slottable,
        properties: component.properties,
      },
      exit_nodes: component.exitNodes,
      css_variables: component.cssVariables,
    };
    statements.push(
      context.env.DB.prepare(
        `INSERT OR IGNORE INTO flow_component_definitions
          (id, project_id, library_id, name, key, component_type, schema_json,
           exit_nodes_json, css_variables_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        componentId,
        project.projectId,
        libraryId,
        component.name,
        component.key,
        component.componentType,
        JSON.stringify(definition.schema),
        JSON.stringify(component.exitNodes),
        JSON.stringify(component.cssVariables),
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT OR IGNORE INTO flow_component_versions
          (id, project_id, component_id, version, definition_json,
           created_by, created_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        stableResourceId(project.projectId, "component-version", `${component.key}:1`),
        project.projectId,
        componentId,
        JSON.stringify(definition),
        String(project.actorId),
        now,
      ),
    );
  }

  const results = await context.env.DB.batch(statements);
  const environmentCreated = Number(results[0]?.meta.changes ?? 0) > 0;
  return {
    projectId: project.projectId,
    projectRef: project.projectRef,
    createdAt: stored.created_at,
    defaultEnvironment: {
      id: environmentId,
      key: environmentKey,
      ...(environmentCreated ? { sdkKey } : {}),
    },
  };
}

export async function getFlowProject(context: FlowContext) {
  const provision = context.get("flowProject");
  return {
    project_ref: provision.projectRef,
    sdk_identifier: provision.projectRef,
    created_at: provision.createdAt,
    default_environment: {
      id: provision.defaultEnvironment.id,
      key: provision.defaultEnvironment.key,
      ...(provision.defaultEnvironment.sdkKey
        ? { sdk_key: provision.defaultEnvironment.sdkKey }
        : {}),
    },
  };
}

export async function listEnvironments(context: FlowContext) {
  const rows = await context.env.DB.prepare(
    `SELECT id, name, key, kind, active, allow_draft, created_at, updated_at
     FROM flow_environments WHERE project_id = ? ORDER BY created_at`,
  ).bind(projectId(context)).all<SqlRow>();
  return { items: rows.results };
}

export async function createEnvironment(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const id = crypto.randomUUID();
  const key = identifier(body.key, "key");
  const name = requiredString(body.name, "name", 160);
  const kind = requiredString(body.kind ?? "test", "kind", 32);
  if (!new Set(["production", "test", "development"]).has(kind)) {
    throw failure("flow_environment_kind_invalid", "Environment kind is invalid", 422);
  }
  const sdkKey = randomToken();
  const now = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO flow_environments
      (id, project_id, name, key, kind, sdk_key_hash, active, allow_draft,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(
    id,
    projectId(context),
    name,
    key,
    kind,
    await sha256(sdkKey),
    body.allow_draft === true ? 1 : 0,
    now,
    now,
  ).run();
  await audit(context, "flows.environment.created", "environment", id, {
    key,
    kind,
  });
  return {
    id,
    key,
    name,
    kind,
    sdk_key: sdkKey,
    active: true,
    allow_draft: body.allow_draft === true,
  };
}

export async function rotateEnvironmentKey(
  context: FlowContext,
  environmentId: string,
) {
  const sdkKey = randomToken();
  const result = await context.env.DB.prepare(
    `UPDATE flow_environments SET sdk_key_hash = ?, updated_at = ?
     WHERE id = ? AND project_id = ?`,
  ).bind(
    await sha256(sdkKey),
    isoNow(),
    environmentId,
    projectId(context),
  ).run();
  if (!result.meta.changes) {
    throw failure("flow_environment_not_found", "Environment not found", 404);
  }
  await audit(context, "flows.environment.key-rotated", "environment", environmentId);
  return { id: environmentId, sdk_key: sdkKey };
}

export async function listLanguageGroups(context: FlowContext) {
  const rows = await context.env.DB.prepare(
    `SELECT * FROM flow_language_groups
     WHERE project_id = ? ORDER BY created_at`,
  ).bind(projectId(context)).all<SqlRow>();
  return {
    items: rows.results.map((row) => ({
      ...row,
      locales: parseJsonArray(row.locales_json),
      fallbacks: parseJsonObject(row.fallbacks_json),
      locales_json: undefined,
      fallbacks_json: undefined,
    })),
  };
}

export async function saveLanguageGroup(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const locales = Array.isArray(body.locales)
    ? body.locales.map((locale) => requiredString(locale, "locale", 64))
    : [];
  const defaultLocale = requiredString(body.default_locale, "default_locale", 64);
  if (!locales.includes(defaultLocale)) locales.unshift(defaultLocale);
  const id = optionalString(body.id, "id", 192) ?? crypto.randomUUID();
  const name = requiredString(body.name, "name", 160);
  const fallbacks =
    typeof body.fallbacks === "object" &&
    body.fallbacks !== null &&
    !Array.isArray(body.fallbacks)
      ? body.fallbacks
      : {};
  const now = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO flow_language_groups
      (id, project_id, name, default_locale, locales_json, fallbacks_json,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       default_locale = excluded.default_locale,
       locales_json = excluded.locales_json,
       fallbacks_json = excluded.fallbacks_json,
       updated_at = excluded.updated_at
     WHERE flow_language_groups.project_id = excluded.project_id`,
  ).bind(
    id,
    projectId(context),
    name,
    defaultLocale,
    JSON.stringify(locales),
    JSON.stringify(fallbacks),
    now,
    now,
  ).run();
  await audit(context, "flows.localization.saved", "language_group", id, {
    locales,
    default_locale: defaultLocale,
  });
  return {
    id,
    name,
    default_locale: defaultLocale,
    locales,
    fallbacks,
    updated_at: now,
  };
}

function stableResourceId(
  projectIdValue: number,
  resource: string,
  key: string,
): string {
  return `flow-project-${projectIdValue}-${resource}-${key}`;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
