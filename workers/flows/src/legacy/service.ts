import type { Context } from "hono";
import type { FlowGraph, FlowQueueEvent } from "@superboard/contracts/flows";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { FlowApp } from "../http/auth";
import { failure } from "../http/errors";
import { readJsonObject } from "../http/validation";
import { hashFlowUserId } from "../services/crypto";
import {
  legacyEventName,
  legacyTargetingToConditions,
  normalizeLegacyDimensions,
  onboardingDefinitionToGraph,
  paywallDefinitionToGraph,
} from "./conversion";
import { matchesTargeting } from "../runtime/targeting";
import { sha256 } from "../d1/helpers";

type LegacyContext = Context<FlowApp>;
type Source = "paywalls" | "onboardings";
type Row = Record<string, unknown>;

export async function legacyRequest(
  context: LegacyContext,
  source: Source,
): Promise<Response> {
  const response = await routeLegacyRequest(context, source);
  if (["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method) && response.ok) {
    await auditLegacyResponse(context, source, response.clone());
  }
  return response;
}

async function routeLegacyRequest(
  context: LegacyContext,
  source: Source,
): Promise<Response> {
  const prefix = `/internal/v1/legacy/${source}`;
  const pathname = new URL(context.req.url).pathname;
  const path = pathname.slice(prefix.length) || "/";
  const method = context.req.method;

  if (method === "GET" && path === "/health") {
    return Response.json({
      ok: true,
      service: source,
      runtime: "flows",
      compatibility: true,
    });
  }

  if (method === "GET" && (path === "/" || path === "/paywalls")) {
    return legacyData(await listLegacyWorkflows(context, source));
  }
  if (method === "POST" && (path === "/" || path === "/paywalls")) {
    return legacyData(
      await createLegacyWorkflow(
        context,
        source,
        await readJsonObject(context.req.raw),
      ),
      201,
    );
  }
  if (path === "/resolve" || path === "/placements/resolve") {
    const request = await readJsonObject(context.req.raw);
    const resolved = await resolveLegacyPlacement(
      context,
      source,
      request,
    );
    if (source === "paywalls") {
      return Response.json(
        {
          data: resolved,
          meta: resolved
            ? { resolved_at: new Date().toISOString() }
            : {
                placement: request.placement ?? null,
                reason: "no_active_match",
              },
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return legacyData(resolved);
  }
  if (path === "/events" && method === "POST") {
    return legacyData(
      await ingestLegacyEvents(
        context,
        source,
        await readJsonObject(context.req.raw, 2_359_296),
      ),
      202,
    );
  }
  if (path === "/statistics" && method === "GET") {
    return legacyData(await legacyStatistics(context, source));
  }
  if (path === "/placements" || path.startsWith("/placements/")) {
    return legacyPlacements(context, source, path, method);
  }
  if (path === "/experiences" || path.startsWith("/experiences/")) {
    return legacyExperiences(context, source, path, method);
  }
  if (
    source === "onboardings" &&
    (path === "/targeting-rules" || path.startsWith("/targeting-rules/"))
  ) {
    return legacyTargetingRules(context, path, method);
  }

  const versionMatch = source === "paywalls"
    ? /^\/paywalls\/([^/]+)\/versions(?:\/([^/]+)(?:\/(publish|archive))?)?$/u.exec(path)
    : /^\/([^/]+)\/versions$/u.exec(path);
  if (versionMatch) {
    return legacyVersions(
      context,
      source,
      versionMatch[1]!,
      versionMatch[2] ?? null,
      versionMatch[3] ?? null,
      method,
    );
  }
  const onboardingPublish =
    source === "onboardings" ? /^\/([^/]+)\/publish$/u.exec(path) : null;
  if (onboardingPublish && method === "POST") {
    const body = await readJsonObject(context.req.raw);
    return legacyData(
      await publishLegacyVersion(
        context,
        source,
        onboardingPublish[1]!,
        text(body.version_id, "version_id"),
      ),
    );
  }
  const workflowMatch = source === "paywalls"
    ? /^\/paywalls\/([^/]+)$/u.exec(path)
    : /^\/([^/]+)$/u.exec(path);
  if (workflowMatch) {
    return legacyWorkflowById(
      context,
      source,
      workflowMatch[1]!,
      method,
    );
  }
  throw failure(
    source === "paywalls"
      ? "paywalls_route_not_found"
      : "onboardings_route_not_found",
    `${source === "paywalls" ? "Paywalls" : "Onboardings"} route was not found`,
    404,
  );
}

async function listLegacyWorkflows(
  context: LegacyContext,
  source: Source,
) {
  const rows = await context.env.DB.prepare(
    `SELECT w.id, w.legacy_id, w.identifier, w.name, w.description, w.created_at, w.updated_at,
      w.status, w.archived_at,
      (SELECT COUNT(*) FROM flow_legacy_versions v
       WHERE v.project_id = w.project_id AND v.source_module = ?
         AND v.workflow_id = w.id) AS version_count,
      (SELECT MAX(v.version) FROM flow_legacy_versions v
       WHERE v.project_id = w.project_id AND v.source_module = ?
         AND v.workflow_id = w.id AND v.status = 'published') AS published_version,
      (SELECT COALESCE(v.legacy_id, v.id) FROM flow_legacy_versions v
       WHERE v.project_id = w.project_id AND v.source_module = ?
         AND v.workflow_id = w.id AND v.status = 'published'
       ORDER BY v.version DESC LIMIT 1) AS active_version_id
     FROM flow_workflows w
     WHERE w.project_id = ? AND w.origin = ?
       AND w.status != 'archived'
     ORDER BY w.updated_at DESC`,
  )
    .bind(
      source,
      source,
      source,
      context.get("project").projectId,
      source,
    )
    .all<Row>();
  return rows.results.map((row) => legacyWorkflowView(row, source));
}

async function createLegacyWorkflow(
  context: LegacyContext,
  source: Source,
  body: Row,
) {
  const project = context.get("project");
  const id = crypto.randomUUID();
  const identifier = slug(body.identifier, "identifier");
  const name = text(body.display_name ?? body.name, "display_name");
  const duplicate = await context.env.DB.prepare(
    `SELECT id FROM flow_workflows WHERE project_id = ?
      AND origin = ? AND identifier = ? AND status != 'archived'`,
  )
    .bind(project.projectId, source, identifier)
    .first<{ id: string }>();
  if (duplicate) {
    throw failure(
      `${singular(source)}_identifier_conflict`,
      `${singular(source)} identifier already exists`,
      409,
      { identifier },
    );
  }
  const now = new Date().toISOString();
  const graph = source === "paywalls"
    ? paywallDefinitionToGraph(id, {})
    : onboardingDefinitionToGraph(id, { screens: [] });
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_workflows
        (id, project_id, identifier, name, description,
         frequency, status, origin, legacy_id, draft_revision, created_by,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'once', 'draft', ?, ?, 1, ?, ?, ?)`,
    ).bind(
      id,
      project.projectId,
      identifier,
      name,
      optionalText(body.description),
      source,
      id,
      String(project.actorId),
      now,
      now,
    ),
    context.env.DB.prepare(
      `INSERT INTO flow_workflow_drafts
        (workflow_id, project_id, revision, graph_json,
         validation_json, updated_by, updated_at)
       VALUES (?, ?, 1, ?, '{"valid":true,"issues":[]}', ?, ?)`,
    ).bind(
      id,
      project.projectId,
      JSON.stringify(graph),
      String(project.actorId),
      now,
    ),
    context.env.DB.prepare(
      `INSERT INTO flow_legacy_mappings
        (project_id, source_module, source_type, source_id, flow_type,
         flow_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'workflow', ?, '{}', ?)`,
    ).bind(project.projectId, source, singular(source), id, id, now),
  ]);
  const workflow = legacyWorkflowView(
    {
      id,
      identifier,
      name,
      description: optionalText(body.description),
      created_at: now,
      updated_at: now,
      version_count: 0,
      active_version_id: null,
      published_version: null,
    },
    source,
  );
  if (source === "onboardings" && body.configuration !== undefined) {
    const definition = record(body.configuration);
    const draftVersion = await createLegacyVersionRecord(
      context,
      source,
      id,
      definition,
      optionalText(body.changelog),
    );
    return { ...workflow, version_count: 1, draft_version: draftVersion };
  }
  return workflow;
}

async function legacyWorkflowById(
  context: LegacyContext,
  source: Source,
  workflowId: string,
  method: string,
): Promise<Response> {
  const existing = await ownWorkflow(context, source, workflowId);
  workflowId = String(existing.id);
  if (method === "GET") return legacyData(legacyWorkflowView(existing, source));
  if (method === "PUT" || method === "PATCH") {
    const body = await readJsonObject(context.req.raw);
    const name = text(body.display_name ?? body.name ?? existing.name, "display_name");
    const description = body.description === undefined
      ? optionalText(existing.description)
      : optionalText(body.description);
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE flow_workflows SET name = ?, description = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND origin = ?`,
    )
      .bind(
        name,
        description,
        now,
        context.get("project").projectId,
        workflowId,
        source,
      )
      .run();
    return legacyData({ id: workflowId, display_name: name, description, updated_at: now });
  }
  if (method === "DELETE") {
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE flow_workflows SET status = 'archived', archived_at = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND origin = ?`,
    )
      .bind(
        now,
        now,
        context.get("project").projectId,
        workflowId,
        source,
      )
      .run();
    return legacyData({ id: workflowId, archived: true });
  }
  throw legacyMethod(source);
}

async function legacyVersions(
  context: LegacyContext,
  source: Source,
  workflowId: string,
  versionId: string | null,
  action: string | null,
  method: string,
): Promise<Response> {
  workflowId = String((await ownWorkflow(context, source, workflowId)).id);
  const projectId = context.get("project").projectId;
  if (method === "GET" && !versionId) {
    const rows = await context.env.DB.prepare(
      `SELECT id, legacy_id, version, status, definition_json, changelog, created_at,
        published_at, archived_at FROM flow_legacy_versions
       WHERE project_id = ? AND source_module = ?
         AND workflow_id = ? ORDER BY version DESC`,
    )
      .bind(projectId, source, workflowId)
      .all<Row>();
    return legacyData(rows.results.map(legacyVersionView));
  }
  if (method === "POST" && !versionId) {
    const body = await readJsonObject(context.req.raw);
    const definition = source === "paywalls"
      ? record(body.definition)
      : record(body.configuration ?? body.definition);
    return legacyData(
      await createLegacyVersionRecord(
        context,
        source,
        workflowId,
        definition,
        optionalText(body.changelog),
      ),
      201,
    );
  }
  if (method === "POST" && versionId && action === "publish") {
    versionId = String(
      (await ownLegacyVersion(context, source, workflowId, versionId)).id,
    );
    return legacyData(
      await publishLegacyVersion(
        context,
        source,
        workflowId,
        versionId,
      ),
    );
  }
  if (method === "POST" && versionId && action === "archive") {
    const version = await ownLegacyVersion(
      context,
      source,
      workflowId,
      versionId,
    );
    const publicVersionId = String(version.legacy_id ?? version.id);
    versionId = String(version.id);
    const now = new Date().toISOString();
    const inUse = await context.env.DB.prepare(
      `SELECT 1 AS present
       WHERE EXISTS (
         SELECT 1 FROM flow_legacy_placements p
         WHERE p.project_id = ?
           AND p.source_module = ? AND p.active = 1
           AND p.active_legacy_version_id = ?
       ) OR EXISTS (
         SELECT 1 FROM flow_legacy_variants v
         JOIN flow_legacy_experiments e ON e.id = v.experiment_id
         WHERE v.project_id = ?
           AND e.source_module = ? AND e.status IN ('running', 'paused')
           AND v.active = 1 AND v.legacy_version_id = ?
       )`,
    )
      .bind(
        projectId, source, versionId,
        projectId, source, versionId,
      )
      .first<{ present: number }>();
    if (inUse) {
      throw failure(
        "version_in_use",
        "A version used by an active placement or experience cannot be archived",
        409,
      );
    }
    const result = await context.env.DB.prepare(
      `UPDATE flow_legacy_versions SET status = 'archived', archived_at = ?
       WHERE id = ? AND project_id = ?
         AND source_module = ? AND workflow_id = ?`,
    )
      .bind(now, versionId, projectId, source, workflowId)
      .run();
    if (!result.meta.changes) throw failure("version_not_found", "Version not found", 404);
    return legacyData({ id: publicVersionId, status: "archived", archived_at: now });
  }
  throw legacyMethod(source);
}

async function createLegacyVersionRecord(
  context: LegacyContext,
  source: Source,
  workflowId: string,
  definition: Row,
  changelog: string | null,
): Promise<Row> {
  validateLegacyDefinition(source, definition);
  const project = context.get("project");
  const max = await context.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version
     FROM flow_legacy_versions WHERE project_id = ? AND source_module = ?
       AND workflow_id = ?`,
  )
    .bind(project.projectId, source, workflowId)
    .first<{ version: number }>();
  const id = crypto.randomUUID();
  const version = Number(max?.version ?? 1);
  const now = new Date().toISOString();
  const graph = definitionGraph(source, workflowId, definition);
  const current = await context.env.DB.prepare(
    `SELECT revision FROM flow_workflow_drafts
     WHERE project_id = ? AND workflow_id = ?`,
  ).bind(project.projectId, workflowId).first<{ revision: number }>();
  const revision = Number(current?.revision ?? 0) + 1;
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_legacy_versions
        (id, legacy_id, project_id, source_module, workflow_id,
         version, status, definition_json, changelog, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    ).bind(
      id,
      id,
      project.projectId,
      source,
      workflowId,
      version,
      JSON.stringify(definition),
      changelog,
      now,
    ),
    context.env.DB.prepare(
      `UPDATE flow_workflow_drafts SET revision = ?, graph_json = ?,
        updated_by = ?, updated_at = ? WHERE workflow_id = ?
          AND project_id = ?`,
    ).bind(
      revision,
      JSON.stringify(graph),
      String(project.actorId),
      now,
      workflowId,
      project.projectId,
    ),
    context.env.DB.prepare(
      `UPDATE flow_workflows SET draft_revision = ?, updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(revision, now, workflowId, project.projectId),
  ]);
  return legacyVersionView({
    id,
    legacy_id: id,
    version,
    status: "draft",
    definition_json: JSON.stringify(definition),
    changelog,
    created_at: now,
    published_at: null,
  });
}

async function publishLegacyVersion(
  context: LegacyContext,
  source: Source,
  workflowId: string,
  legacyVersionId: string,
) {
  const project = context.get("project");
  workflowId = String((await ownWorkflow(context, source, workflowId)).id);
  legacyVersionId = String(
    (await ownLegacyVersion(
      context,
      source,
      workflowId,
      legacyVersionId,
    )).id,
  );
  const legacy = await context.env.DB.prepare(
    `SELECT id, legacy_id, version, definition_json, changelog FROM flow_legacy_versions
     WHERE id = ? AND project_id = ?
       AND source_module = ? AND workflow_id = ? AND status != 'archived'`,
  )
    .bind(legacyVersionId, project.projectId, source, workflowId)
    .first<{ id: string; legacy_id: string; version: number; definition_json: string; changelog: string | null }>();
  if (!legacy) throw failure("version_not_found", "Version not found", 404);
  const graph = definitionGraph(source, workflowId, parseRecord(legacy.definition_json));
  const flowMax = await context.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version
     FROM flow_workflow_versions WHERE project_id = ? AND workflow_id = ?`,
  ).bind(project.projectId, workflowId).first<{ version: number }>();
  const flowVersion = crypto.randomUUID();
  const now = new Date().toISOString();
  const checksum = await sha256(JSON.stringify(graph));
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_workflow_versions
        (id, project_id, workflow_id, version, graph_json,
         changelog, checksum_sha256, migration_strategy, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'finish-current', ?, ?)`,
    ).bind(
      flowVersion,
      project.projectId,
      workflowId,
      Number(flowMax?.version ?? 1),
      JSON.stringify(graph),
      legacy.changelog,
      checksum,
      String(project.actorId),
      now,
    ),
    context.env.DB.prepare(
      `UPDATE flow_legacy_versions SET status = 'published',
        flow_version_id = ?, published_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(flowVersion, now, legacy.id, project.projectId),
    context.env.DB.prepare(
      `UPDATE flow_workflows SET status = 'active', updated_at = ?
       WHERE id = ? AND project_id = ?`,
    ).bind(now, workflowId, project.projectId),
  ]);
  await synchronizeLegacyWorkflow(context, source, workflowId);
  return {
    id: legacy.legacy_id ?? legacy.id,
    version: legacy.version,
    status: "published",
    published_at: now,
    flow_version_id: flowVersion,
  };
}

async function legacyPlacements(
  context: LegacyContext,
  source: Source,
  path: string,
  method: string,
): Promise<Response> {
  const projectId = context.get("project").projectId;
  const id = /^\/placements\/([^/]+)$/u.exec(path)?.[1] ?? null;
  const existingPlacement = id ? await ownPlacement(context, source, id) : null;
  if (method === "GET" && !id) {
    const rows = await context.env.DB.prepare(
      `SELECT p.*, w.identifier AS workflow_identifier, w.name AS workflow_name,
        w.legacy_id AS workflow_legacy_id,
        lv.legacy_id AS active_version_legacy_id,
        e.legacy_id AS experience_legacy_id
       FROM flow_legacy_placements p JOIN flow_workflows w ON w.id = p.workflow_id
       LEFT JOIN flow_legacy_versions lv ON lv.id = p.active_legacy_version_id
       LEFT JOIN flow_legacy_experiments e ON e.id = p.experience_id
       WHERE p.project_id = ? AND p.source_module = ?
       ORDER BY p.priority DESC, p.key`,
    ).bind(projectId, source).all<Row>();
    return legacyData(rows.results.map((row) => legacyPlacementView(row, source)));
  }
  if ((method === "POST" && !id) || ((method === "PUT" || method === "PATCH") && id)) {
    const body = await readJsonObject(context.req.raw);
    const workflow = await ownWorkflow(context, source, text(
      body[source === "paywalls" ? "paywall_id" : "onboarding_id"],
      source === "paywalls" ? "paywall_id" : "onboarding_id",
    ));
    const workflowId = String(workflow.id);
    const placementId = existingPlacement ? String(existingPlacement.id) : crypto.randomUUID();
    const publicPlacementId = existingPlacement
      ? String(existingPlacement.legacy_id ?? existingPlacement.id)
      : placementId;
    const key = slug(body.key, "key");
    const activeVersion = optionalText(body.active_version_id);
    const activeVersionId = activeVersion
      ? String((await ownLegacyVersion(context, source, workflowId, activeVersion, true)).id)
      : null;
    const experienceId = optionalText(body.experience_id)
      ? String((await ownExperiment(context, source, String(body.experience_id))).id)
      : null;
    const targeting = record(body.targeting);
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO flow_legacy_placements
        (id, legacy_id, project_id, source_module, key, workflow_id,
         active_legacy_version_id, experience_id, targeting_json, priority,
         active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET key = excluded.key,
         workflow_id = excluded.workflow_id,
         active_legacy_version_id = excluded.active_legacy_version_id,
         experience_id = excluded.experience_id,
         targeting_json = excluded.targeting_json, priority = excluded.priority,
         active = excluded.active, updated_at = excluded.updated_at
       WHERE flow_legacy_placements.project_id = excluded.project_id
         AND flow_legacy_placements.source_module = excluded.source_module`,
    ).bind(
      placementId,
      publicPlacementId,
      projectId,
      source,
      key,
      workflowId,
      activeVersionId,
      experienceId,
      JSON.stringify(targeting),
      integer(body.priority, source === "paywalls" ? 0 : 100, -100_000, 100_000),
      boolean(body.active, true) ? 1 : 0,
      now,
      now,
    ).run();
    await synchronizeLegacyWorkflow(context, source, workflowId);
    return legacyData({ id: publicPlacementId }, id ? 200 : 201);
  }
  if (method === "GET" && id) {
    const row = existingPlacement!;
    return legacyData(legacyPlacementView(row, source));
  }
  if (method === "DELETE" && id) {
    const placementId = String(existingPlacement!.id);
    const result = source === "paywalls"
      ? await context.env.DB.prepare(
          `UPDATE flow_legacy_placements SET active = 0, updated_at = ?
           WHERE id = ? AND project_id = ?
             AND source_module = ?`,
        ).bind(new Date().toISOString(), placementId, projectId, source).run()
      : await context.env.DB.prepare(
          `DELETE FROM flow_legacy_placements WHERE id = ? AND project_id = ? AND source_module = ?`,
        ).bind(placementId, projectId, source).run();
    if (!result.meta.changes) throw failure("placement_not_found", "Placement not found", 404);
    await synchronizeLegacyWorkflow(
      context,
      source,
      String(existingPlacement!.workflow_id),
    );
    return legacyData({ id, deleted: source === "onboardings", active: false });
  }
  throw legacyMethod(source);
}

async function legacyExperiences(
  context: LegacyContext,
  source: Source,
  path: string,
  method: string,
): Promise<Response> {
  const projectId = context.get("project").projectId;
  const match = /^\/experiences\/([^/]+)(?:\/(status))?$/u.exec(path);
  const id = match?.[1] ?? null;
  const existingExperiment = id ? await ownExperiment(context, source, id) : null;
  if (method === "GET" && !id) {
    const rows = await context.env.DB.prepare(
      `SELECT e.*, w.legacy_id AS workflow_legacy_id,
        p.legacy_id AS placement_legacy_id
       FROM flow_legacy_experiments e
       JOIN flow_workflows w ON w.id = e.workflow_id
       LEFT JOIN flow_legacy_placements p ON p.id = e.placement_id
       WHERE e.project_id = ? AND e.source_module = ? ORDER BY e.created_at DESC`,
    ).bind(projectId, source).all<Row>();
    const variants = await context.env.DB.prepare(
      `SELECT v.*, e.legacy_id AS experiment_legacy_id,
        lv.legacy_id AS version_legacy_id
       FROM flow_legacy_variants v
       JOIN flow_legacy_experiments e ON e.id = v.experiment_id
       JOIN flow_legacy_versions lv ON lv.id = v.legacy_version_id
       WHERE e.project_id = ? AND e.source_module = ?
       ORDER BY v.experiment_id, v.key`,
    ).bind(projectId, source).all<Row>();
    return legacyData(rows.results.map((row) => ({
      ...legacyExperienceView(row, source),
      variants: variants.results.filter((variant) => variant.experiment_id === row.id).map(legacyVariantView),
    })));
  }
  if ((method === "POST" && !id) || ((method === "PUT" || method === "PATCH") && id)) {
    const body = await readJsonObject(context.req.raw);
    const placement = optionalText(body.placement_id)
      ? await ownPlacement(context, source, String(body.placement_id))
      : null;
    const workflow = source === "paywalls"
      ? await ownWorkflow(context, source, text(body.paywall_id, "paywall_id"))
      : await ownWorkflow(context, source, String(placement?.workflow_id ?? ""));
    const workflowId = String(workflow.id);
    const placementId = placement ? String(placement.id) : null;
    const variants = array(body.variants).map((entry, index) => {
      const value = record(entry);
      return {
        id: optionalText(value.id) ?? crypto.randomUUID(),
        key: slug(value.key ?? value.name ?? `variant-${index + 1}`, "variant.key"),
        versionId: text(value.version_id, "variant.version_id"),
        weight: integer(value.weight, 1, 1, 100_000),
        active: boolean(value.active, true),
      };
    });
    if (!variants.length) throw failure("variants_invalid", "Variants are required", 422);
    for (const variant of variants) {
      variant.versionId = String(
        (await ownLegacyVersion(context, source, workflowId, variant.versionId, true)).id,
      );
    }
    const experimentId = existingExperiment
      ? String(existingExperiment.id)
      : crypto.randomUUID();
    const publicExperimentId = existingExperiment
      ? String(existingExperiment.legacy_id ?? existingExperiment.id)
      : experimentId;
    const now = new Date().toISOString();
    const status = enumText(body.status, ["draft", "running", "paused", "completed", "archived"], "draft");
    const trafficBasisPoints = source === "onboardings"
      ? integer(body.traffic_percentage, 10_000, 0, 10_000)
      : integer(body.traffic_percent, 100, 0, 100) * 100;
    const trafficPercent = Math.round(trafficBasisPoints / 100);
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO flow_legacy_experiments
          (id, legacy_id, project_id, source_module, workflow_id,
           placement_id, name, status, traffic_percent, traffic_basis_points,
           starts_at, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name,
           status = excluded.status, traffic_percent = excluded.traffic_percent,
           traffic_basis_points = excluded.traffic_basis_points,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at,
           updated_at = excluded.updated_at
         WHERE flow_legacy_experiments.project_id = excluded.project_id`,
      ).bind(
        experimentId, publicExperimentId, projectId, source, workflowId,
        placementId, text(body.name, "name"), status, trafficPercent,
        trafficBasisPoints,
        optionalText(body.starts_at), optionalText(body.ends_at), now, now,
      ),
      context.env.DB.prepare(
        `DELETE FROM flow_legacy_variants
         WHERE project_id = ? AND experiment_id = ?`,
      ).bind(projectId, experimentId),
      ...variants.map((variant) => context.env.DB.prepare(
        `INSERT INTO flow_legacy_variants
          (id, legacy_id, project_id, source_module, experiment_id, legacy_version_id,
           key, weight, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        variant.id, variant.id, projectId, source, experimentId, variant.versionId,
        variant.key, variant.weight, variant.active ? 1 : 0, now, now,
      )),
    ]);
    await synchronizeLegacyWorkflow(context, source, workflowId);
    return legacyData({ id: publicExperimentId, variants }, id ? 200 : 201);
  }
  if (method === "GET" && id) {
    const row = await ownExperiment(context, source, id);
    const variants = await context.env.DB.prepare(
      `SELECT v.*, e.legacy_id AS experiment_legacy_id,
        lv.legacy_id AS version_legacy_id
       FROM flow_legacy_variants v
       JOIN flow_legacy_experiments e ON e.id = v.experiment_id
       JOIN flow_legacy_versions lv ON lv.id = v.legacy_version_id
       WHERE v.project_id = ? AND v.experiment_id = ? ORDER BY v.key`,
    ).bind(projectId, existingExperiment!.id).all<Row>();
    return legacyData({
      ...legacyExperienceView(row, source),
      variants: variants.results.map(legacyVariantView),
    });
  }
  if (method === "POST" && id && match?.[2] === "status") {
    const body = await readJsonObject(context.req.raw);
    const status = enumText(body.status, ["draft", "running", "paused", "completed", "archived"], "draft");
    const result = await context.env.DB.prepare(
      `UPDATE flow_legacy_experiments SET status = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND source_module = ?`,
    ).bind(status, new Date().toISOString(), existingExperiment!.id, projectId, source).run();
    if (!result.meta.changes) throw failure("experience_not_found", "Experience not found", 404);
    await synchronizeLegacyWorkflow(
      context,
      source,
      String(existingExperiment!.workflow_id),
    );
    return legacyData({ id, status });
  }
  if (method === "DELETE" && id) {
    const result = await context.env.DB.prepare(
      `UPDATE flow_legacy_experiments SET status = 'archived', updated_at = ?
       WHERE id = ? AND project_id = ? AND source_module = ?`,
    ).bind(new Date().toISOString(), existingExperiment!.id, projectId, source).run();
    if (!result.meta.changes) throw failure("experience_not_found", "Experience not found", 404);
    await synchronizeLegacyWorkflow(
      context,
      source,
      String(existingExperiment!.workflow_id),
    );
    return legacyData({ id, archived: true });
  }
  throw legacyMethod(source);
}

async function legacyTargetingRules(
  context: LegacyContext,
  path: string,
  method: string,
): Promise<Response> {
  const projectId = context.get("project").projectId;
  const id = /^\/targeting-rules\/([^/]+)$/u.exec(path)?.[1] ?? null;
  if (method === "GET" && !id) {
    const rows = await context.env.DB.prepare(
      `SELECT r.*, p.legacy_id AS placement_legacy_id
       FROM flow_legacy_targeting_rules r
       JOIN flow_legacy_placements p ON p.id = r.placement_id
       WHERE r.project_id = ? AND r.source_module = 'onboardings'
       ORDER BY r.priority DESC`,
    ).bind(projectId).all<Row>();
    return legacyData(rows.results.map((row) => ({
      ...row,
      id: row.legacy_id ?? row.id,
      placement_id: row.placement_legacy_id ?? row.placement_id,
      conditions: parseRecord(String(row.conditions_json)),
      conditions_json: undefined,
      active: Boolean(row.active),
    })));
  }
  if (method === "POST" && !id) {
    const body = await readJsonObject(context.req.raw);
    const placement = await ownPlacement(
      context,
      "onboardings",
      text(body.placement_id, "placement_id"),
    );
    const placementId = String(placement.id);
    const ruleId = crypto.randomUUID();
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `INSERT INTO flow_legacy_targeting_rules
        (id, legacy_id, project_id, source_module, placement_id, conditions_json,
         priority, active, created_at, updated_at)
       VALUES (?, ?, ?, 'onboardings', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ruleId, ruleId, projectId, placementId,
      JSON.stringify(record(body.conditions)), integer(body.priority, 100, 0, 10_000),
      boolean(body.active, true) ? 1 : 0, now, now,
    ).run();
    await synchronizeLegacyWorkflow(
      context,
      "onboardings",
      String(placement.workflow_id),
    );
    return legacyData({ id: ruleId }, 201);
  }
  if (method === "DELETE" && id) {
    const existing = await context.env.DB.prepare(
      `SELECT id, legacy_id, placement_id FROM flow_legacy_targeting_rules
       WHERE (id = ? OR legacy_id = ?) AND project_id = ?
         AND source_module = 'onboardings'`,
    ).bind(id, id, projectId).first<{
      id: string;
      legacy_id: string;
      placement_id: string;
    }>();
    if (!existing) throw failure("targeting_rule_not_found", "Targeting rule not found", 404);
    const result = await context.env.DB.prepare(
      `DELETE FROM flow_legacy_targeting_rules WHERE id = ? AND project_id = ?`,
    ).bind(existing.id, projectId).run();
    if (!result.meta.changes) throw failure("targeting_rule_not_found", "Targeting rule not found", 404);
    const placement = await context.env.DB.prepare(
      `SELECT workflow_id FROM flow_legacy_placements
       WHERE id = ? AND project_id = ?`,
    ).bind(existing.placement_id, projectId).first<{ workflow_id: string }>();
    if (placement) {
      await synchronizeLegacyWorkflow(
        context,
        "onboardings",
        placement.workflow_id,
      );
    }
    return legacyData({ deleted: true });
  }
  throw legacyMethod("onboardings");
}

async function resolveLegacyPlacement(
  context: LegacyContext,
  source: Source,
  body: Row,
) {
  const project = context.get("project");
  if (body.project_id != null && String(body.project_id) !== String(project.projectId)) {
    throw failure("project_context_mismatch", "Project context mismatch", 403);
  }
  const placementKey = slug(body.placement, "placement");
  const candidates = await context.env.DB.prepare(
    `SELECT p.*, w.legacy_id AS workflow_legacy_id,
      lv.legacy_id AS active_version_legacy_id,
      e.legacy_id AS experience_legacy_id
     FROM flow_legacy_placements p
     JOIN flow_workflows w ON w.id = p.workflow_id
     LEFT JOIN flow_legacy_versions lv ON lv.id = p.active_legacy_version_id
     LEFT JOIN flow_legacy_experiments e ON e.id = p.experience_id
     WHERE p.project_id = ? AND p.source_module = ? AND p.key = ? AND p.active = 1
     ORDER BY p.priority DESC, p.updated_at DESC`,
  ).bind(project.projectId, source, placementKey).all<Row>();
  const properties = normalizeLegacyDimensions({
    ...record(body.attributes),
    platform: body.platform,
    locale: body.locale,
    country: body.country,
    app_version: body.app_version,
  });
  for (const placement of candidates.results) {
    if (!matchesTargeting(legacyTargetingToConditions(parseRecord(String(placement.targeting_json))), properties)) continue;
    if (source === "onboardings" && !(await matchesLegacyRules(context, placement, properties))) continue;
    const selected = await selectLegacyVersion(
      context,
      source,
      placement,
      String(body.subject_id ?? body.customer_id ?? body.anonymous_id ?? body.session_id ?? `${placementKey}:anonymous`),
    );
    if (!selected) continue;
    const definition = parseRecord(selected.definition_json);
    return source === "paywalls"
      ? {
          placement_id: placement.legacy_id ?? placement.id,
          placement: placement.key,
          paywall_id: placement.workflow_legacy_id ?? placement.workflow_id,
          version_id: selected.id,
          version: selected.version,
          experience_id: selected.experienceId,
          variant_id: selected.variantId,
          variant: selected.variantKey,
          definition,
        }
      : {
          onboarding_id: placement.workflow_legacy_id ?? placement.workflow_id,
          placement_id: placement.legacy_id ?? placement.id,
          placement: placement.key,
          version_id: selected.id,
          version: selected.version,
          experience_id: selected.experienceId,
          variant_id: selected.variantId,
          definition,
        };
  }
  return null;
}

async function selectLegacyVersion(
  context: LegacyContext,
  source: Source,
  placement: Row,
  subject: string,
) {
  const now = new Date().toISOString();
  const experienceId = optionalText(placement.experience_id);
  if (experienceId) {
    const experience = await context.env.DB.prepare(
      `SELECT * FROM flow_legacy_experiments WHERE id = ? AND project_id = ? AND source_module = ? AND status = 'running'
        AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)`,
    ).bind(
      experienceId, context.get("project").projectId, source, now, now,
    ).first<Row>();
    if (
      experience &&
      await legacyTrafficEligible(
        source,
        context.get("project").projectId,
        placement.id as string,
        subject,
        Number(experience.traffic_basis_points ?? Number(experience.traffic_percent) * 100),
      )
    ) {
      const variants = await context.env.DB.prepare(
        `SELECT v.id, v.legacy_id AS variant_legacy_id, v.key, v.weight,
          l.id AS version_internal_id, l.legacy_id AS version_id, l.version,
          l.definition_json FROM flow_legacy_variants v
         JOIN flow_legacy_versions l ON l.id = v.legacy_version_id
         WHERE v.experiment_id = ? AND v.project_id = ?
           AND v.active = 1 AND l.status = 'published' ORDER BY v.key`,
      ).bind(experienceId, context.get("project").projectId).all<{
        id: string; variant_legacy_id: string; key: string; weight: number;
        version_internal_id: string; version_id: string;
        version: number; definition_json: string;
      }>();
      const total = variants.results.reduce((sum, variant) => sum + Number(variant.weight), 0);
      const bucket = await legacyVariantBucket(
        source,
        context.get("project").projectId,
        experienceId,
        subject,
        Math.max(1, total),
      );
      let cursor = 0;
      for (const variant of variants.results) {
        cursor += Number(variant.weight);
        if (bucket < cursor) return {
          id: variant.version_id, version: variant.version,
          definition_json: variant.definition_json,
          experienceId: experience.legacy_id ?? experienceId,
          variantId: variant.variant_legacy_id ?? variant.id,
          variantKey: variant.key,
        };
      }
    }
  }
  const versionId = optionalText(placement.active_legacy_version_id);
  if (!versionId) return null;
  const version = await context.env.DB.prepare(
    `SELECT COALESCE(legacy_id, id) AS id, version, definition_json FROM flow_legacy_versions
     WHERE id = ? AND project_id = ?
       AND source_module = ? AND workflow_id = ? AND status = 'published'`,
  ).bind(
    versionId, context.get("project").projectId, source,
    placement.workflow_id,
  ).first<{ id: string; version: number; definition_json: string }>();
  return version ? {
    ...version, experienceId: null, variantId: null, variantKey: null,
  } : null;
}

async function ingestLegacyEvents(
  context: LegacyContext,
  source: Source,
  body: Row,
) {
  const project = context.get("project");
  if (body.project_id != null && String(body.project_id) !== String(project.projectId)) {
    throw failure("project_context_mismatch", "Project context mismatch", 403);
  }
  const events = array(body.events);
  if (!events.length || events.length > 100) {
    throw failure("events_invalid", "events must contain 1 to 100 items", 422);
  }
  const ids = new Set<string>();
  const queuedEvents: FlowQueueEvent[] = [];
  for (const [index, raw] of events.entries()) {
    const event = record(raw);
    const id = text(event.id, `events[${index}].id`);
    if (ids.has(id)) throw failure("event_id_duplicate", "Event identifiers must be unique", 422);
    ids.add(id);
    const type = text(event.type, `events[${index}].type`);
    const userId = String(
      event.customer_id ?? event.anonymous_id ?? event.session_id ?? `${source}:anonymous`,
    );
    const rawWorkflowId = optionalText(event.paywall_id ?? event.onboarding_id);
    const workflow = rawWorkflowId
      ? await ownWorkflow(context, source, rawWorkflowId)
      : null;
    const rawVersionId = optionalText(event.version_id);
    const version = rawVersionId && workflow
      ? await ownLegacyVersion(
          context,
          source,
          String(workflow.id),
          rawVersionId,
        )
      : null;
    const rawPlacementId = optionalText(event.placement_id);
    const placement = rawPlacementId
      ? await ownPlacement(context, source, rawPlacementId)
      : null;
    const canonicalBlockId = workflow && placement
      ? canonicalLegacyBlockId(
          source,
          String(workflow.id),
          String(placement.legacy_id ?? placement.id),
          optionalText(event.variant_id),
        )
      : optionalText(event.step_id);
    queuedEvents.push({
      schemaVersion: 1,
      eventId: `legacy:${source}:${id}`,
      projectId: project.projectId,
      projectRef: project.projectRef,
      environmentId: `legacy:${String(event.platform ?? "unknown")}`,
      userIdHash: await hashFlowUserId(context.env, project.projectRef, userId),
      name: legacyEventName(source, type),
      occurredAt: iso(event.occurred_at, `events[${index}].occurred_at`),
      ...(workflow
        ? { workflowId: String(workflow.id) }
        : {}),
      ...(version?.flow_version_id
        ? { workflowVersionId: String(version.flow_version_id) }
        : {}),
      ...(canonicalBlockId
        ? { blockId: canonicalBlockId }
        : {}),
      properties: {
        legacy: {
          source,
          type,
          placement: event.placement,
          platform: event.platform,
          placement_id: event.placement_id,
          workflow_id: event.paywall_id ?? event.onboarding_id,
          version_id: event.version_id,
          experience_id: event.experience_id,
          variant_id: event.variant_id,
          step_id: event.step_id,
          revenue_micros: safeMicros(event.revenue_micros),
          currency: event.currency,
          authoritative_purchase: false,
        },
        payload: record(event.payload),
      },
      legacyEventType: type,
      sourceEventId: id,
      legacySourceModule: source,
      // Legacy telemetry must never fabricate authoritative purchase, revenue
      // or installation counts.
    });
  }
  let accepted = 0;
  let duplicates = 0;
  for (const queued of queuedEvents) {
    const projected = await context.env.DB.prepare(
      `SELECT 1 AS present FROM flow_analytics_events
       WHERE source_event_id = ? AND source_module = ?
         AND project_id = ?`,
    )
      .bind(
        queued.sourceEventId,
        source,
        project.projectId,
      )
      .first<{ present: number }>();
    if (projected) {
      duplicates += 1;
      continue;
    }
    const claim = await context.env.DB.prepare(
      `INSERT OR IGNORE INTO flow_legacy_event_claims
        (event_id, project_id, source_module, claimed_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(
        queued.sourceEventId,
        project.projectId,
        source,
        new Date().toISOString(),
      )
      .run();
    if (!claim.meta.changes) {
      duplicates += 1;
      continue;
    }
    try {
      await context.env.FLOW_EVENTS.send(queued, { contentType: "json" });
      accepted += 1;
    } catch (error) {
      await context.env.DB.prepare(
        `DELETE FROM flow_legacy_event_claims
         WHERE event_id = ? AND source_module = ?
           AND project_id = ?`,
      )
        .bind(
          queued.sourceEventId,
          source,
          project.projectId,
        )
        .run();
      throw error;
    }
  }
  return { accepted, duplicates };
}

function canonicalLegacyBlockId(
  source: Source,
  workflowId: string,
  placementId: string,
  variantId: string | null,
): string {
  const suffix = source === "paywalls" ? "commerce" : "onboarding-tour";
  return variantId
    ? `${workflowId}:placement:${placementId}:variant:${variantId}:${suffix}`
    : `${workflowId}:placement:${placementId}:${suffix}`;
}

async function legacyStatistics(
  context: LegacyContext,
  source: Source,
) {
  const url = new URL(context.req.url);
  const timezone = validateTimeZone(url.searchParams.get("timezone") ?? "UTC");
  const to = queryDateBoundary(url.searchParams.get("to"), true) ?? new Date();
  const from = queryDateBoundary(url.searchParams.get("from"), false) ??
    new Date(to.getTime() - 30 * 86_400_000);
  const placementParameter = url.searchParams.get("placement_id");
  let placementFilter = placementParameter;
  if (placementParameter) {
    const placement = await context.env.DB.prepare(
      `SELECT key FROM flow_legacy_placements WHERE id = ? AND project_id = ? AND source_module = ?`,
    )
      .bind(
        placementParameter,
        context.get("project").projectId,
        source,
      )
      .first<{ key: string }>();
    placementFilter = placement?.key ?? placementParameter;
  }
  const rows = await context.env.DB.prepare(
    `SELECT event_id, legacy_event_type, occurred_at, properties_json
     FROM flow_analytics_events WHERE project_id = ?
       AND occurred_at >= ? AND occurred_at < ? AND legacy_event_type IS NOT NULL
     ORDER BY occurred_at`,
  ).bind(
    context.get("project").projectId,
    from.toISOString(),
    to.toISOString(),
  ).all<{ event_id: string; legacy_event_type: string; occurred_at: string; properties_json: string }>();
  const filtered = rows.results.map((row) => ({ row, properties: parseRecord(row.properties_json) }))
    .filter(({ properties }) => record(properties.legacy).source === source)
    .filter(({ properties }) => {
      const legacy = record(properties.legacy);
      return matchesOptional(url, "platform", legacy.platform) &&
        (!placementFilter || String(legacy.placement ?? "") === placementFilter) &&
        matchesOptional(url, "version_id", legacy.version_id) &&
        matchesOptional(url, "experience_id", legacy.experience_id) &&
        matchesOptional(url, "variant_id", legacy.variant_id);
    });
  const totals: Record<string, number> = {};
  const revenueByCurrency: Record<string, number> = {};
  const series = new Map<string, Row>();
  const funnel: Record<string, number> = {};
  for (const { row, properties } of filtered) {
    const legacy = record(properties.legacy);
    const unverifiedPurchase =
      row.legacy_event_type === "purchase" && legacy.authoritative_purchase === false;
    const metricType = unverifiedPurchase ? "unverified_purchase" : row.legacy_event_type;
    totals[metricType] = (totals[metricType] ?? 0) + 1;
    if (row.legacy_event_type === "step_view" && typeof legacy.step_id === "string") {
      funnel[legacy.step_id] = (funnel[legacy.step_id] ?? 0) + 1;
    }
    const micros = unverifiedPurchase ? 0 : safeMicros(legacy.revenue_micros);
    if (micros && typeof legacy.currency === "string") {
      revenueByCurrency[legacy.currency] = (revenueByCurrency[legacy.currency] ?? 0) + micros;
    }
    const bucket = legacyStatisticsBucket(
      row.occurred_at,
      url.searchParams.get("interval") === "hour" ? "hour" : "day",
      timezone,
    );
    const key = [bucket, metricType, legacy.platform, legacy.placement, legacy.step_id].join("|");
    const entry = series.get(key) ?? {
      [source === "paywalls" ? "bucket" : "date"]: bucket,
      event_type: metricType,
      platform: legacy.platform ?? null,
      placement: legacy.placement ?? null,
      version_id: legacy.version_id ?? null,
      experience_id: legacy.experience_id ?? null,
      variant_id: legacy.variant_id ?? null,
      ...(source === "onboardings" ? { step_id: legacy.step_id ?? null } : {}),
      count: 0,
      revenue_micros: 0,
    };
    entry.count = Number(entry.count) + 1;
    entry.revenue_micros = Number(entry.revenue_micros) + micros;
    series.set(key, entry);
  }
  if (source === "paywalls") {
    const views = totals.view ?? totals.impression ?? 0;
    const purchases = totals.purchase ?? 0;
    return {
      filters: Object.fromEntries(url.searchParams),
      totals: {
        ...totals,
        revenue_micros: Object.keys(revenueByCurrency).length <= 1
          ? Object.values(revenueByCurrency)[0] ?? 0
          : null,
        revenue_by_currency: revenueByCurrency,
        conversion_rate: views ? purchases / views : 0,
      },
      series: [...series.values()],
    };
  }
  return {
    filters: Object.fromEntries(url.searchParams),
    totals,
    series: [...series.values()],
    funnel: Object.entries(funnel).map(([step, count]) => ({ step, count })),
    completion_rate: totals.impression ? (totals.complete ?? 0) / totals.impression : 0,
    drop_off_rate: totals.impression
      ? Math.max(0, totals.impression - (totals.complete ?? 0)) / totals.impression
      : 0,
  };
}

async function matchesLegacyRules(
  context: LegacyContext,
  placement: Row,
  properties: Row,
): Promise<boolean> {
  const rows = await context.env.DB.prepare(
    `SELECT conditions_json FROM flow_legacy_targeting_rules
     WHERE project_id = ? AND placement_id = ? AND active = 1
     ORDER BY priority DESC`,
  ).bind(context.get("project").projectId, placement.id).all<{ conditions_json: string }>();
  if (!rows.results.length) return true;
  return rows.results.some((row) =>
    matchesTargeting(legacyTargetingToConditions(parseRecord(row.conditions_json)), properties),
  );
}

async function ownWorkflow(
  context: LegacyContext,
  source: Source,
  id: string,
): Promise<Row> {
  const row = await context.env.DB.prepare(
    `SELECT * FROM flow_workflows
     WHERE (id = ? OR legacy_id = ?) AND project_id = ? AND origin = ?`,
  ).bind(id, id, context.get("project").projectId, source).first<Row>();
  if (!row) throw failure(`${singular(source)}_not_found`, `${singular(source)} not found`, 404);
  return row;
}

async function ownPlacement(
  context: LegacyContext,
  source: Source,
  id: string,
): Promise<Row> {
  const row = await context.env.DB.prepare(
    `SELECT * FROM flow_legacy_placements
     WHERE (id = ? OR legacy_id = ?) AND project_id = ? AND source_module = ?`,
  ).bind(id, id, context.get("project").projectId, source).first<Row>();
  if (!row) throw failure("placement_not_found", "Placement not found", 404);
  return row;
}

async function ownExperiment(
  context: LegacyContext,
  source: Source,
  id: string,
): Promise<Row> {
  const row = await context.env.DB.prepare(
    `SELECT * FROM flow_legacy_experiments
     WHERE (id = ? OR legacy_id = ?) AND project_id = ? AND source_module = ?`,
  ).bind(id, id, context.get("project").projectId, source).first<Row>();
  if (!row) throw failure("experience_not_found", "Experience not found", 404);
  return row;
}

async function ownLegacyVersion(
  context: LegacyContext,
  source: Source,
  workflowId: string,
  versionId: string,
  published = false,
): Promise<Row> {
  const row = await context.env.DB.prepare(
    `SELECT * FROM flow_legacy_versions WHERE (id = ? OR legacy_id = ?)
      AND project_id = ? AND source_module = ? AND workflow_id = ?
      ${published ? "AND status = 'published'" : ""}`,
  ).bind(
    versionId, versionId, context.get("project").projectId, source, workflowId,
  ).first<Row>();
  if (!row) throw failure("version_not_found", "Version not found", 404);
  return row;
}

function legacyWorkflowView(row: Row, source: Source): Row {
  return {
    id: row.legacy_id ?? row.id,
    identifier: row.identifier,
    ...(source === "paywalls"
      ? { display_name: row.name }
      : { display_name: row.name, active_version: row.published_version ?? null }),
    description: row.description ?? null,
    active_version_id: row.active_version_id ?? null,
    version_count: Number(row.version_count ?? 0),
    published_version: row.published_version ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function legacyVersionView(row: Row): Row {
  return {
    id: row.legacy_id ?? row.id,
    version: Number(row.version),
    status: row.status,
    state: row.status,
    definition: parseRecord(String(row.definition_json)),
    configuration: parseRecord(String(row.definition_json)),
    changelog: row.changelog ?? null,
    created_at: row.created_at,
    published_at: row.published_at ?? null,
    archived_at: row.archived_at ?? null,
  };
}

function legacyPlacementView(row: Row, source: Source): Row {
  return {
    id: row.legacy_id ?? row.id,
    key: row.key,
    ...(source === "paywalls"
      ? { paywall_id: row.workflow_legacy_id ?? row.workflow_id }
      : { onboarding_id: row.workflow_legacy_id ?? row.workflow_id, name: row.key }),
    active_version_id: row.active_version_legacy_id ?? row.active_legacy_version_id ?? null,
    experience_id: row.experience_legacy_id ?? row.experience_id ?? null,
    targeting: parseRecord(String(row.targeting_json)),
    priority: Number(row.priority),
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function legacyExperienceView(row: Row, source: Source): Row {
  return {
    ...row,
    id: row.legacy_id ?? row.id,
    ...(source === "paywalls"
      ? {
          paywall_id: row.workflow_legacy_id ?? row.workflow_id,
          placement_id: row.placement_legacy_id ?? row.placement_id,
          traffic_percent: Number(row.traffic_percent),
        }
      : {
          placement_id: row.placement_legacy_id ?? row.placement_id,
          traffic_percentage: Number(
            row.traffic_basis_points ?? Number(row.traffic_percent) * 100,
          ),
        }),
  };
}

function legacyVariantView(row: Row): Row {
  return {
    id: row.legacy_id ?? row.id,
    experience_id: row.experiment_legacy_id ?? row.experiment_id,
    key: row.key,
    name: row.key,
    version_id: row.version_legacy_id ?? row.legacy_version_id,
    weight: Number(row.weight),
    active: Boolean(row.active),
  };
}

function definitionGraph(source: Source, workflowId: string, definition: Row) {
  return source === "paywalls"
    ? paywallDefinitionToGraph(workflowId, definition)
    : onboardingDefinitionToGraph(workflowId, definition);
}

/** Rebuild the active canonical release after every successful legacy write. */
async function synchronizeLegacyWorkflow(
  context: LegacyContext,
  source: Source,
  workflowId: string,
): Promise<void> {
  const project = context.get("project");
  const placements = await context.env.DB.prepare(
    `SELECT p.*, lv.definition_json, lv.legacy_id AS version_legacy_id
     FROM flow_legacy_placements p
     LEFT JOIN flow_legacy_versions lv ON lv.id = p.active_legacy_version_id
     WHERE p.project_id = ? AND p.source_module = ?
       AND p.workflow_id = ? AND p.active = 1
     ORDER BY p.priority DESC, p.id`,
  ).bind(project.projectId, source, workflowId).all<Row>();
  if (!placements.results.length) return;
  const experiments = await context.env.DB.prepare(
    `SELECT * FROM flow_legacy_experiments
     WHERE project_id = ? AND source_module = ? AND workflow_id = ?
       AND status = 'running'
     ORDER BY created_at DESC`,
  ).bind(project.projectId, source, workflowId).all<Row>();
  const experimentById = new Map(
    experiments.results.map((row) => [String(row.id), row]),
  );
  const variants = await context.env.DB.prepare(
    `SELECT v.*, lv.definition_json AS variant_definition_json,
      lv.legacy_id AS variant_version_legacy_id
     FROM flow_legacy_variants v
     JOIN flow_legacy_versions lv
       ON lv.project_id = v.project_id AND lv.id = v.legacy_version_id
     WHERE v.project_id = ? AND v.source_module = ? AND v.active = 1
     ORDER BY v.experiment_id, v.key, v.id`,
  ).bind(project.projectId, source).all<Row>();
  const variantsByExperiment = new Map<string, Row[]>();
  for (const row of variants.results) {
    const values = variantsByExperiment.get(String(row.experiment_id)) ?? [];
    values.push(row);
    variantsByExperiment.set(String(row.experiment_id), values);
  }
  const targetingRules = source === "onboardings"
    ? await context.env.DB.prepare(
        `SELECT * FROM flow_legacy_targeting_rules
         WHERE project_id = ? AND source_module = 'onboardings' AND active = 1
         ORDER BY priority DESC, id`,
      ).bind(project.projectId).all<Row>()
    : { results: [] as Row[] };
  const blocks: FlowGraph["blocks"] = [];
  const paths: FlowGraph["paths"] = [];
  for (const [index, placement] of placements.results.entries()) {
    if (!placement.definition_json) continue;
    const placementId = String(placement.legacy_id ?? placement.id);
    const placementKey = String(placement.key);
    const priority = Number(placement.priority ?? 0);
    const definition = parseRecord(String(placement.definition_json));
    const placementRules = targetingRules.results.filter(
      (rule) => String(rule.placement_id) === String(placement.id),
    );
    const starts = placementRules.length
      ? placementRules.map((rule, ruleIndex) => ({
          id: `${workflowId}:placement:${placementId}:rule:${String(rule.legacy_id ?? rule.id)}:start`,
          conditions: legacyTargetingToConditions(
            parseRecord(String(rule.conditions_json)),
          ),
          rulePriority: Number(rule.priority ?? 0),
          y: 80 + index * 260 + ruleIndex * 44,
        }))
      : [{
          id: `${workflowId}:placement:${placementId}:start`,
          conditions: legacyTargetingToConditions(
            parseRecord(String(placement.targeting_json)),
          ),
          rulePriority: null,
          y: 80 + index * 260,
        }];
    for (const start of starts) {
      blocks.push({
        id: start.id,
        key: `start-${placementKey}-${start.id}`,
        type: "start",
        name: `Start: ${placementKey}`,
        data: {
          legacy_source: source,
          legacy_project_id: project.projectId,
          legacy_placement_id: placementId,
          legacy_priority: priority,
          ...(start.rulePriority == null
            ? {}
            : { legacy_rule_priority: start.rulePriority }),
        },
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: start.y },
        conditions: start.conditions,
      });
    }

    const experiment = placement.experience_id
      ? experimentById.get(String(placement.experience_id))
      : experiments.results.find(
          (row) => String(row.placement_id ?? "") === String(placement.id),
        );
    const activeComponentId = canonicalLegacyBlockId(
      source,
      workflowId,
      placementId,
      null,
    );
    const addComponent = (
      id: string,
      componentDefinition: Row,
      extraData: Row,
      yOffset: number,
    ) => {
      const template = definitionGraph(source, workflowId, componentDefinition).blocks.find(
        (block) => source === "paywalls"
          ? block.componentType === "superboard-commerce"
          : block.type === "tour",
      );
      if (!template) return false;
      blocks.push({
        ...template,
        id,
        data: {
          ...template.data,
          placement: placementKey,
          placement_id: placementId,
          legacy_source: source,
          legacy_priority: priority,
          ...extraData,
        },
        slotId: placementKey,
        position: { x: 560, y: 80 + index * 260 + yOffset },
      });
      return true;
    };
    if (!experiment) {
      if (!addComponent(activeComponentId, definition, {
        active_legacy_version_id: placement.version_legacy_id,
      }, 0)) continue;
      for (const start of starts) {
        paths.push({
          id: `${start.id}:component`,
          sourceBlockId: start.id,
          sourceExitNode: "default",
          targetBlockId: activeComponentId,
        });
      }
      continue;
    }

    const sourceVariants = variantsByExperiment.get(String(experiment.id)) ?? [];
    if (!sourceVariants.length) continue;
    if (sourceVariants.some((variant) => String(variant.key) === "holdout")) {
      throw failure(
        "legacy_experiment_variant_invalid",
        "The variant key holdout is reserved",
        422,
      );
    }
    const splitId = `${workflowId}:placement:${placementId}:experiment:${String(experiment.legacy_id ?? experiment.id)}:split`;
    blocks.push({
      id: splitId,
      key: `traffic-${String(experiment.legacy_id ?? experiment.id)}-${placementId}`,
      type: "traffic-split",
      name: String(experiment.name ?? "Legacy experiment"),
      data: {
        variants: sourceVariants.map((variant) => ({
          key: String(variant.key),
          weight: Math.max(1, Number(variant.weight ?? 1)),
        })),
        legacy_source: source,
        legacy_project_id: project.projectId,
        legacy_placement_id: placementId,
        legacy_experience_id: String(experiment.legacy_id ?? experiment.id),
        traffic_basis_points: Number(
          experiment.traffic_basis_points ?? Number(experiment.traffic_percent ?? 100) * 100,
        ),
      },
      propertyMeta: [],
      exitNodes: [...sourceVariants.map((variant) => String(variant.key)), "holdout"],
      position: { x: 280, y: 80 + index * 260 },
    });
    for (const start of starts) {
      paths.push({
        id: `${start.id}:split`,
        sourceBlockId: start.id,
        sourceExitNode: "default",
        targetBlockId: splitId,
      });
    }
    for (const [variantIndex, variant] of sourceVariants.entries()) {
      const variantId = String(variant.legacy_id ?? variant.id);
      const componentId = canonicalLegacyBlockId(
        source,
        workflowId,
        placementId,
        variantId,
      );
      if (!addComponent(
        componentId,
        parseRecord(String(variant.variant_definition_json)),
        {
          experience_id: String(experiment.legacy_id ?? experiment.id),
          variant_id: variantId,
          active_legacy_version_id: variant.variant_version_legacy_id,
        },
        variantIndex * 44,
      )) continue;
      paths.push({
        id: `${splitId}:${String(variant.key)}:${componentId}`,
        sourceBlockId: splitId,
        sourceExitNode: String(variant.key),
        targetBlockId: componentId,
      });
    }
    addComponent(activeComponentId, definition, {
      active_legacy_version_id: placement.version_legacy_id,
      legacy_holdout: true,
    }, sourceVariants.length * 44);
    paths.push({
      id: `${splitId}:holdout:${activeComponentId}`,
      sourceBlockId: splitId,
      sourceExitNode: "holdout",
      targetBlockId: activeComponentId,
    });
  }
  if (!blocks.length) return;
  const graph: FlowGraph = { schemaVersion: 1, blocks, paths };
  const now = new Date().toISOString();
  const max = await context.env.DB.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version
     FROM flow_workflow_versions WHERE project_id = ? AND workflow_id = ?`,
  ).bind(project.projectId, workflowId).first<{ version: number }>();
  const versionId = crypto.randomUUID();
  const checksum = await sha256(JSON.stringify(graph));
  const environments = await context.env.DB.prepare(
    `SELECT id FROM flow_environments
     WHERE project_id = ? AND active = 1`,
  ).bind(project.projectId).all<{ id: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO flow_workflow_versions
        (id, project_id, workflow_id, version, graph_json, changelog,
         checksum_sha256, migration_strategy, published_by, published_at)
       VALUES (?, ?, ?, ?, ?, 'Legacy compatibility synchronization', ?,
         'finish-current', ?, ?)`,
    ).bind(
      versionId,
      project.projectId,
      workflowId,
      Number(max?.version ?? 1),
      JSON.stringify(graph),
      checksum,
      String(project.actorId),
      now,
    ),
    context.env.DB.prepare(
      `UPDATE flow_workflows SET status = 'active', updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).bind(now, project.projectId, workflowId),
    ...environments.results.map((environment) => context.env.DB.prepare(
      `INSERT INTO flow_environment_releases
        (project_id, environment_id, workflow_id, workflow_version_id,
         use_draft, active, activated_by, activated_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)
       ON CONFLICT(environment_id, workflow_id) DO UPDATE SET
         workflow_version_id = excluded.workflow_version_id,
         use_draft = 0, active = 1, activated_by = excluded.activated_by,
         activated_at = excluded.activated_at
       WHERE flow_environment_releases.project_id = excluded.project_id`,
    ).bind(
      project.projectId,
      environment.id,
      workflowId,
      versionId,
      String(project.actorId),
      now,
    )),
  ]);
}

function validateLegacyDefinition(source: Source, definition: Row): void {
  const entries = source === "paywalls"
    ? array(definition.components)
    : array(definition.screens);
  if (source === "onboardings" && (!entries.length || entries.length > 100)) {
    throw failure("definition_invalid", "definition must contain 1 to 100 screens", 422);
  }
  if (source === "paywalls" && entries.length > 200) {
    throw failure("components_too_many", "definition.components is limited to 200 items", 422);
  }
}

function legacyData(value: unknown, status = 200): Response {
  return Response.json({ data: value }, { status, headers: { "cache-control": "no-store" } });
}

async function auditLegacyResponse(
  context: LegacyContext,
  source: Source,
  response: Response,
): Promise<void> {
  const project = context.get("project");
  let responseData: Row = {};
  try {
    responseData = record(
      (await readJsonObjectLimited(response, 1_048_576)).data,
    );
  } catch {
    // A successful empty response is still audited with the route as entity.
  }
  const pathname = new URL(context.req.url).pathname;
  const entityId = optionalText(responseData.id) ??
    context.req.header("idempotency-key") ?? pathname;
  await context.env.DB.prepare(
    `INSERT INTO flow_audit_events
      (id, project_id, project_ref, actor_id, action,
       entity_type, entity_id, payload_json, request_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      project.projectId,
      project.projectRef,
      String(project.actorId),
      `legacy.${source}.${context.req.method.toLowerCase()}`,
      singular(source),
      entityId,
      JSON.stringify({ route: pathname, status: response.status }),
      project.requestId,
      new Date().toISOString(),
    )
    .run();
}

function legacyMethod(source: Source) {
  return failure("method_not_allowed", `${source} method is not supported`, 404);
}

function singular(source: Source): "paywall" | "onboarding" {
  return source === "paywalls" ? "paywall" : "onboarding";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseRecord(value: string): Row {
  try { return record(JSON.parse(value) as unknown); } catch { return {}; }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw failure("validation_failed", `${field} is required`, 422, { field });
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slug(value: unknown, field: string): string {
  const result = text(value, field).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(result)) {
    throw failure("validation_failed", `${field} is invalid`, 422, { field });
  }
  return result;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw failure("validation_failed", "Integer value is invalid", 422);
  }
  return value;
}

function enumText<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : fallback;
}

function iso(value: unknown, field: string): string {
  const raw = text(value, field);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw failure("validation_failed", `${field} is invalid`, 422);
  return date.toISOString();
}

function queryDateBoundary(value: string | null, exclusiveEnd: boolean): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw failure("date_invalid", "Statistics date is invalid", 422);
  }
  if (exclusiveEnd && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function validateTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw failure("timezone_invalid", "timezone must be a valid IANA timezone", 422);
  }
}

function legacyStatisticsBucket(
  value: string,
  interval: "hour" | "day",
  timezone: string,
): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "00";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return interval === "hour" ? `${day}T${part("hour")}:00` : day;
}

function safeMicros(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function stableBucket(value: string, modulo: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % modulo;
}

export async function legacyTrafficEligible(
  source: Source,
  projectId: number,
  placementId: string,
  subject: string,
  trafficBasisPoints: number,
): Promise<boolean> {
  if (source === "onboardings") {
    return stableBucket(subject, 10_000) < trafficBasisPoints;
  }
  const percent = Math.round(trafficBasisPoints / 100);
  return (await sha256Bucket(`${projectId}:${placementId}:${subject}`, 100)) < percent;
}

export async function legacyVariantBucket(
  source: Source,
  projectId: number,
  experienceId: string,
  subject: string,
  modulo: number,
): Promise<number> {
  if (source === "onboardings") {
    // The removed Onboardings Worker reused the same subject bucket for both
    // traffic selection and the variant cursor.
    return stableBucket(subject, 10_000) % modulo;
  }
  return sha256Bucket(`${projectId}:${experienceId}:${subject}`, modulo);
}

async function sha256Bucket(value: string, modulo: number): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return (
    (((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0) %
    Math.max(1, modulo)
  );
}

function matchesOptional(url: URL, key: string, actual: unknown): boolean {
  const expected = url.searchParams.get(key);
  return !expected || String(actual ?? "") === expected;
}
