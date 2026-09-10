import { createHash } from "node:crypto";
import { canonicalJson, sha256 } from "./core-primitives.mjs";

const SOURCES = Object.freeze(["paywalls", "onboardings"]);

export function transformLegacySnapshot(snapshot, options) {
  const normalized = validateSourceSnapshot(snapshot);
  const environmentId = requiredId(options.environmentId, "environmentId");
  const actorId = String(options.actorId || "flows-cutover");
  const project = normalized.project;
  const capturedAt = normalized.captured_at;
  const rowsByEntity = Object.fromEntries(
    options.entityIds?.map((id) => [id, []]) ?? [],
  );
  const allRows = {};
  const workflowIdentifiers = workflowIdentifierIndex(normalized.sources);
  const userIdHashes = normalizeUserIdHashes(options.userIdHashes);

  for (const source of SOURCES) {
    const tables = normalized.sources[source].tables;
    const converted = source === "paywalls"
      ? transformPaywalls({ tables, project, environmentId, actorId, capturedAt, workflowIdentifiers, userIdHashes })
      : transformOnboardings({ tables, project, environmentId, actorId, capturedAt, workflowIdentifiers, userIdHashes });
    for (const [name, rows] of Object.entries(converted)) {
      allRows[`${source}.${name}`] = rows;
    }
  }

  reconcileUsers(allRows);

  assertNoIdentifierCollisions(allRows);
  assertNoMetricPollution(allRows);
  assertRuntimeCompatibleUserHashes(allRows);
  const selected = options.entityIds
    ? new Set(options.entityIds)
    : null;
  for (const [id, rows] of Object.entries(allRows)) {
    if (!selected || selected.has(id)) rowsByEntity[id] = rows;
  }
  if (selected) {
    const missing = [...selected].filter((id) => !(id in allRows));
    if (missing.length) throw new Error(`Unknown Flows cutover entities: ${missing.join(", ")}`);
  }
  return {
    project,
    environment_id: environmentId,
    actor_id: actorId,
    captured_at: capturedAt,
    source_bookmarks: Object.fromEntries(
      SOURCES.map((source) => [source, normalized.sources[source].bookmark]),
    ),
    source_database_ids: Object.fromEntries(
      SOURCES.map((source) => [source, normalized.sources[source].database_id]),
    ),
    rowsByEntity,
  };
}

/**
 * Return the exact external identifiers the legacy aliases pass to
 * hashFlowUserId. The cutover process deliberately delegates the HMAC to the
 * Flows Worker so the stable hash key never leaves Cloudflare.
 */
export function collectLegacyUserIds(snapshot) {
  const normalized = validateSourceSnapshot(snapshot);
  const ids = new Set();
  for (const source of SOURCES) {
    for (const row of normalized.sources[source].tables.events ?? []) {
      ids.add(legacyRuntimeUserId(source, row).userId);
    }
  }
  return [...ids].sort();
}

export function validateSourceSnapshot(snapshot) {
  if (!snapshot || snapshot.schema_version !== 1) {
    throw new Error("Flows source snapshot must use schema_version=1");
  }
  if (snapshot.target !== "mbza-development" || snapshot.environment !== "development") {
    throw new Error("Flows cutover snapshots are restricted to mbza-development/development");
  }
  const projectRef = String(snapshot.project?.project_ref || "");
  const match = /^(\d+)-(prod|test)$/u.exec(projectRef);
  if (!match) throw new Error("Snapshot project_ref must use <instance_id>-prod or <instance_id>-test");
  const projectId = Number(snapshot.project?.project_id);
  const instanceId = Number(snapshot.project?.instance_id);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !Number.isSafeInteger(instanceId) || instanceId !== Number(match[1])) {
    throw new Error("Snapshot project identity is invalid");
  }
  const capturedAt = iso(snapshot.captured_at, "snapshot.captured_at");
  const sources = {};
  for (const source of SOURCES) {
    const input = snapshot.sources?.[source];
    if (!input || typeof input.bookmark !== "string" || !input.bookmark.trim()) {
      throw new Error(`Snapshot ${source} Time Travel bookmark is required`);
    }
    if (input.bookmark_verified_stable !== true) {
      throw new Error(`Snapshot ${source} must prove an unchanged Time Travel bookmark across capture`);
    }
    if (!String(input.database_name || "").trim() || !/^[A-Za-z0-9_-]+$/u.test(String(input.database_id || ""))) {
      throw new Error(`Snapshot ${source} database identity is required`);
    }
    if (!input.tables || typeof input.tables !== "object") {
      throw new Error(`Snapshot ${source} tables are required`);
    }
    sources[source] = {
      bookmark: input.bookmark.trim(),
      bookmark_verified_stable: true,
      database_name: String(input.database_name).trim(),
      database_id: String(input.database_id),
      tables: Object.fromEntries(
        Object.entries(input.tables).map(([table, rows]) => {
          if (!Array.isArray(rows)) throw new Error(`${source}.${table} must be an array`);
          for (const row of rows) {
            if (String(row?.project_id) !== String(projectId)) {
              throw new Error(`${source}.${table} contains a row outside project ${projectId}`);
            }
          }
          return [table, structuredClone(rows)];
        }),
      ),
    };
  }
  return {
    schema_version: 1,
    target: snapshot.target,
    environment: snapshot.environment,
    captured_at: capturedAt,
    project: {
      project_id: projectId,
      project_ref: projectRef,
      instance_id: instanceId,
      environment: match[2] === "prod" ? "production" : "test",
    },
    sources,
  };
}

export function deterministicUuid(...parts) {
  const bytes = Buffer.from(createHash("sha256").update(parts.map(String).join("\u001f")).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function assertNoMetricPollution(rowsByEntity) {
  for (const id of Object.keys(rowsByEntity)) {
    if (/purchase|installation|billing|mtu|usage(?:_|-)alerts?/iu.test(id)) {
      throw new Error(`Flows import must not write purchase, installation, Billing, MTU or usage facts: ${id}`);
    }
  }
  for (const [id, rows] of Object.entries(rowsByEntity)) {
    if (!id.endsWith(".analytics")) continue;
    for (const row of rows) {
      if (new Set(["purchase", "installation", "install"]).has(String(row.event_name).toLowerCase())) {
        throw new Error(`${id}: imported event would pollute verified purchase/install metrics`);
      }
      const properties = parseObject(row.properties_json, `${id}.properties_json`);
      if (properties.analytics_namespace !== "flows.legacy" || properties.verified_fact_eligible !== false) {
        throw new Error(`${id}: imported analytics event lacks the metric isolation marker`);
      }
      const legacy = object(properties.legacy);
      if (legacy.imported_history !== true) {
        throw new Error(`${id}: imported analytics event lacks the historical import marker`);
      }
      if (
        legacy.authoritative_purchase === true &&
        !(legacy.source === "paywalls" && String(legacy.type).toLowerCase() === "purchase")
      ) {
        throw new Error(`${id}: only an archived Paywall purchase may be historical purchase authority`);
      }
    }
  }
  return true;
}

export function assertRuntimeCompatibleUserHashes(rowsByEntity) {
  for (const [id, rows] of Object.entries(rowsByEntity)) {
    if (!/\.(?:analytics|users|states|assignments)$/u.test(id)) continue;
    for (const row of rows) {
      if (!/^[a-f0-9]{64}$/u.test(String(row.user_id_hash ?? ""))) {
        throw new Error(
          `${id}: user_id_hash is not compatible with hashFlowUserId runtime identity`,
        );
      }
    }
  }
  return true;
}

function transformPaywalls(context) {
  const { tables, project, environmentId, actorId, capturedAt } = context;
  requiredTables(tables, ["paywalls", "paywall_versions", "placements", "experiences", "variants", "events"], "paywalls");
  const workflowByLegacy = importedIdMap(
    tables.paywalls,
    project,
    "paywalls",
    "workflow",
  );
  const versionByLegacy = importedIdMap(
    tables.paywall_versions,
    project,
    "paywalls",
    "workflow-version",
  );
  const legacyVersionByLegacy = importedIdMap(
    tables.paywall_versions,
    project,
    "paywalls",
    "legacy-version",
  );
  const placementByLegacy = importedIdMap(
    tables.placements,
    project,
    "paywalls",
    "legacy-placement",
  );
  const experimentByLegacy = importedIdMap(
    tables.experiences,
    project,
    "paywalls",
    "legacy-experiment",
  );
  const variantByLegacy = importedIdMap(
    tables.variants,
    project,
    "paywalls",
    "legacy-variant",
  );
  const definitions = new Map();
  const versionsByWorkflow = group(tables.paywall_versions, "paywall_id");
  const placementsByWorkflow = group(tables.placements, "paywall_id");
  const experimentsByWorkflow = group(tables.experiences, "paywall_id");
  const variantsByExperiment = group(tables.variants, "experience_id");
  const workflows = [];
  const drafts = [];
  const versions = [];
  const legacyVersions = [];
  const releases = [];
  const placements = [];
  const experiments = [];
  const variants = [];
  const mappings = [];

  for (const row of stable(tables.paywalls, ["id"])) {
    const workflowId = requiredMappedId(
      workflowByLegacy,
      row.id,
      "paywalls.paywalls.id",
    );
    const sourceVersions = stable(versionsByWorkflow.get(String(row.id)) ?? [], ["version", "id"]);
    const sourcePlacements = stable(placementsByWorkflow.get(String(row.id)) ?? [], ["priority", "id"], true);
    const sourceExperiments = stable(experimentsByWorkflow.get(String(row.id)) ?? [], ["created_at", "id"], true);
    const publishedVersionIds = new Set(
      sourceVersions
        .filter((version) => version.status === "published")
        .map((version) => String(version.id)),
    );
    const activeSourcePlacements = sourcePlacements.filter(
      (placement) =>
        boolInt(placement.active) === 1 &&
        placement.active_version_id &&
        publishedVersionIds.has(String(placement.active_version_id)),
    );
    const activePlacement = activeSourcePlacements[0];
    const latest = sourceVersions.at(-1) ?? null;
    const activeVersionId = activePlacement?.active_version_id ?? sourceVersions.filter((version) => version.status === "published").at(-1)?.id ?? null;
    const status = row.archived_at
      ? "archived"
      : activeVersionId
        ? "active"
        : "draft";
    const createdAt = isoOr(row.created_at, capturedAt);
    const updatedAt = isoOr(row.updated_at, createdAt);
    const archivedAt = row.archived_at ? isoOr(row.archived_at, updatedAt) : null;
    workflows.push({
      id: workflowId,
      project_id: project.project_id,
      identifier: identifierFor(context, row, "paywall"),
      name: text(row.name, `Paywall ${workflowId}`),
      description: nullableText(row.description),
      frequency: "once",
      status,
      origin: "paywalls",
      legacy_id: String(row.id),
      draft_revision: Math.max(1, sourceVersions.length),
      created_by: actorId,
      created_at: createdAt,
      updated_at: updatedAt,
      archived_at: archivedAt,
    });
    for (const sourceVersion of sourceVersions) {
      const definition = parseObject(sourceVersion.definition_json, `paywall_versions.${sourceVersion.id}.definition_json`);
      definitions.set(String(sourceVersion.id), definition);
      const flowVersionId = requiredMappedId(
        versionByLegacy,
        sourceVersion.id,
        "paywalls.paywall_versions.id",
      );
      const legacyVersionId = requiredMappedId(
        legacyVersionByLegacy,
        sourceVersion.id,
        "paywalls.paywall_versions.id",
      );
      const graph = paywallCanonicalGraph({
        projectId: project.project_id,
        workflowId,
        fallbackDefinition: definition,
        placements: sourcePlacements.filter((placement) => String(placement.active_version_id || "") === String(sourceVersion.id)),
        experiments: sourceExperiments,
        variantsByExperiment,
        definitionByVersion: definitions,
        versionRows: sourceVersions,
      });
      const graphJson = canonicalJson(graph);
      const publishedAt = isoOr(sourceVersion.published_at, isoOr(sourceVersion.created_at, createdAt));
      versions.push({
        id: flowVersionId,
        project_id: project.project_id,
        workflow_id: workflowId,
        version: number(sourceVersion.version),
        graph_json: graphJson,
        changelog: nullableText(sourceVersion.changelog),
        checksum_sha256: sha256(graphJson),
        migration_strategy: "finish-current",
        published_by: text(sourceVersion.created_by, actorId),
        published_at: publishedAt,
      });
      legacyVersions.push({
        id: legacyVersionId,
        legacy_id: sourceId(sourceVersion.id, "paywalls.paywall_versions.id"),
        project_id: project.project_id,
        source_module: "paywalls",
        workflow_id: workflowId,
        version: number(sourceVersion.version),
        status: enumValue(sourceVersion.status, ["draft", "published", "archived"], "draft"),
        definition_json: canonicalJson(definition),
        changelog: nullableText(sourceVersion.changelog),
        flow_version_id: flowVersionId,
        created_at: isoOr(sourceVersion.created_at, createdAt),
        published_at: sourceVersion.status === "published" ? publishedAt : null,
        archived_at: sourceVersion.status === "archived" ? publishedAt : null,
      });
      mappings.push(mapping(project.project_id, "paywalls", "version", sourceVersion.id, "workflow_version", flowVersionId, capturedAt, { workflow_id: workflowId }));
      mappings.push(mapping(project.project_id, "paywalls", "legacy_version", sourceVersion.id, "legacy_version", legacyVersionId, capturedAt, { workflow_id: workflowId }));
    }
    const latestDefinition = latest ? definitions.get(String(latest.id)) ?? parseObject(latest.definition_json, "paywall latest definition") : {};
    const latestGraph = paywallCanonicalGraph({
      projectId: project.project_id,
      workflowId,
      fallbackDefinition: latestDefinition,
      placements: sourcePlacements,
      experiments: sourceExperiments,
      variantsByExperiment,
      definitionByVersion: definitions,
      versionRows: sourceVersions,
    });
    drafts.push({
      workflow_id: workflowId,
      project_id: project.project_id,
      revision: Math.max(1, sourceVersions.length),
      graph_json: canonicalJson(latestGraph),
      validation_json: canonicalJson({ valid: true, issues: [] }),
      updated_by: actorId,
      updated_at: updatedAt,
    });
    const activeVersionIds = [...new Set(
      activeSourcePlacements.map((placement) => String(placement.active_version_id)),
    )].sort();
    let releaseVersionId = activeVersionId
      ? versionByLegacy.get(String(activeVersionId))
      : null;
    if (activeVersionIds.length > 1) {
      const canonicalGraph = paywallCanonicalGraph({
        projectId: project.project_id,
        workflowId,
        fallbackDefinition: latestDefinition,
        placements: activeSourcePlacements,
        experiments: sourceExperiments,
        variantsByExperiment,
        definitionByVersion: definitions,
        versionRows: sourceVersions,
      });
      const graphJson = canonicalJson(canonicalGraph);
      releaseVersionId = deterministicUuid(
        "flows-cutover",
        project.project_ref,
        "paywalls",
        row.id,
        "canonical-release",
        sha256(graphJson),
      );
      versions.push({
        id: releaseVersionId,
        project_id: project.project_id,
        workflow_id: workflowId,
        version: Math.max(0, ...sourceVersions.map((version) => number(version.version))) + 1,
        graph_json: graphJson,
        changelog: "Canonical cutover release preserving all active Paywall placements",
        checksum_sha256: sha256(graphJson),
        migration_strategy: "finish-current",
        published_by: actorId,
        published_at: updatedAt,
      });
      mappings.push(mapping(
        project.project_id,
        "paywalls",
        "canonical_release",
        row.id,
        "workflow_version",
        releaseVersionId,
        capturedAt,
        {
          workflow_id: workflowId,
          active_placement_versions: activeSourcePlacements.map((placement) => ({
            placement_id: String(placement.id),
            version_id: String(placement.active_version_id),
          })),
        },
      ));
    }
    if (releaseVersionId) {
      releases.push(release(project.project_id, environmentId, workflowId, releaseVersionId, actorId, updatedAt, status === "active"));
    }
    mappings.push(mapping(project.project_id, "paywalls", "paywall", row.id, "workflow", workflowId, capturedAt, { identifier: row.identifier ?? null }));
  }

  for (const row of stable(tables.placements, ["priority", "id"], true)) {
    const workflowId = workflowByLegacy.get(String(row.paywall_id));
    if (!workflowId) throw new Error(`Paywall placement ${row.id} references an unknown paywall`);
    placements.push({
      id: requiredMappedId(placementByLegacy, row.id, "paywalls.placements.id"),
      legacy_id: sourceId(row.id, "paywalls.placements.id"),
      project_id: project.project_id,
      source_module: "paywalls",
      key: text(row.key, `placement-${row.id}`),
      workflow_id: workflowId,
      active_legacy_version_id: optionalMappedId(legacyVersionByLegacy, row.active_version_id, "paywalls.placements.active_version_id"),
      experience_id: optionalMappedId(experimentByLegacy, row.experience_id, "paywalls.placements.experience_id"),
      targeting_json: canonicalJson(parseObject(row.targeting_json, `paywalls.placements.${row.id}.targeting_json`)),
      priority: number(row.priority),
      active: boolInt(row.active),
      created_at: isoOr(row.created_at, capturedAt),
      updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
    });
    mappings.push(mapping(project.project_id, "paywalls", "placement", row.id, "legacy_placement", requiredMappedId(placementByLegacy, row.id, "paywalls.placements.id"), capturedAt));
  }
  for (const row of stable(tables.experiences, ["id"])) {
    const workflowId = workflowByLegacy.get(String(row.paywall_id));
    if (!workflowId) throw new Error(`Paywall experience ${row.id} references an unknown paywall`);
    experiments.push({
      id: requiredMappedId(experimentByLegacy, row.id, "paywalls.experiences.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "paywalls.experiences.id"),
      source_module: "paywalls", workflow_id: workflowId,
      placement_id: optionalMappedId(
        placementByLegacy,
        tables.placements.find((placement) => String(placement.experience_id || "") === String(row.id))?.id,
        "paywalls.experiences.placement_id",
      ),
      name: text(row.name, `Experiment ${row.id}`),
      status: enumValue(row.status, ["draft", "running", "paused", "completed", "archived"], "draft"),
      traffic_percent: bounded(number(row.traffic_percent), 0, 100),
      starts_at: nullableIso(row.starts_at), ends_at: nullableIso(row.ends_at),
      created_at: isoOr(row.created_at, capturedAt), updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
      traffic_basis_points: bounded(number(row.traffic_percent) * 100, 0, 10_000),
    });
    mappings.push(mapping(project.project_id, "paywalls", "experience", row.id, "legacy_experiment", requiredMappedId(experimentByLegacy, row.id, "paywalls.experiences.id"), capturedAt));
  }
  for (const row of stable(tables.variants, ["experience_id", "key", "id"])) {
    if (!tables.experiences.some((experience) => String(experience.id) === String(row.experience_id))) throw new Error(`Paywall variant ${row.id} references an unknown experience`);
    if (!versionByLegacy.has(String(row.version_id))) throw new Error(`Paywall variant ${row.id} references an unknown version`);
    variants.push({
      id: requiredMappedId(variantByLegacy, row.id, "paywalls.variants.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "paywalls.variants.id"), source_module: "paywalls",
      experiment_id: requiredMappedId(experimentByLegacy, row.experience_id, "paywalls.variants.experience_id"),
      legacy_version_id: requiredMappedId(legacyVersionByLegacy, row.version_id, "paywalls.variants.version_id"), key: text(row.key, `variant-${row.id}`),
      weight: Math.max(1, number(row.weight)), active: boolInt(row.active),
      created_at: isoOr(row.created_at, capturedAt), updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
    });
    mappings.push(mapping(project.project_id, "paywalls", "variant", row.id, "legacy_variant", requiredMappedId(variantByLegacy, row.id, "paywalls.variants.id"), capturedAt));
  }

  const eventProjection = projectEvents({ source: "paywalls", events: tables.events, project, environmentId, capturedAt, workflowByLegacy, versionByLegacy, placements: tables.placements, experiments: tables.experiences, variants: tables.variants, definitions, userIdHashes: context.userIdHashes });
  mappings.push(...eventProjection.mappings);
  return {
    workflows, drafts, versions, legacy_versions: legacyVersions, releases,
    placements, experiments, variants, mappings, analytics: eventProjection.analytics,
    claims: eventProjection.claims,
    users: eventProjection.users, states: eventProjection.states,
    assignments: eventProjection.assignments,
    audit: [auditRow("paywalls", project, actorId, capturedAt, tables, eventProjection.analytics.length)],
  };
}

function transformOnboardings(context) {
  const { tables, project, environmentId, actorId, capturedAt } = context;
  requiredTables(tables, ["onboardings", "onboarding_versions", "placements", "targeting_rules", "experiences", "experience_variants", "events"], "onboardings");
  const workflowByLegacy = importedIdMap(
    tables.onboardings,
    project,
    "onboardings",
    "workflow",
  );
  const versionByLegacy = importedIdMap(
    tables.onboarding_versions,
    project,
    "onboardings",
    "workflow-version",
  );
  const legacyVersionByLegacy = importedIdMap(
    tables.onboarding_versions,
    project,
    "onboardings",
    "legacy-version",
  );
  const placementByLegacy = importedIdMap(
    tables.placements,
    project,
    "onboardings",
    "legacy-placement",
  );
  const experimentByLegacy = importedIdMap(
    tables.experiences,
    project,
    "onboardings",
    "legacy-experiment",
  );
  const variantByLegacy = importedIdMap(
    tables.experience_variants,
    project,
    "onboardings",
    "legacy-variant",
  );
  const targetingRuleByLegacy = importedIdMap(
    tables.targeting_rules,
    project,
    "onboardings",
    "legacy-targeting-rule",
  );
  const definitions = new Map();
  const versionsByWorkflow = group(tables.onboarding_versions, "onboarding_id");
  const placementsByWorkflow = group(tables.placements, "onboarding_id");
  const rulesByPlacement = group(tables.targeting_rules, "placement_id");
  const experimentsByPlacement = group(tables.experiences, "placement_id");
  const variantsByExperiment = group(tables.experience_variants, "experience_id");
  const workflows = [], drafts = [], versions = [], legacyVersions = [], releases = [];
  const placements = [], experiments = [], variants = [], targetingRules = [], mappings = [];

  for (const row of stable(tables.onboardings, ["id"])) {
    const workflowId = requiredMappedId(
      workflowByLegacy,
      row.id,
      "onboardings.onboardings.id",
    );
    const sourceVersions = stable(versionsByWorkflow.get(String(row.id)) ?? [], ["version", "id"]);
    const sourcePlacements = stable(placementsByWorkflow.get(String(row.id)) ?? [], ["priority", "id"], true);
    const publishedVersionIds = new Set(
      sourceVersions
        .filter((version) => version.status === "published")
        .map((version) => String(version.id)),
    );
    const effectiveVersionId = (placement) =>
      placement.active_version_id ?? row.active_version_id ?? null;
    const activeSourcePlacements = sourcePlacements.filter((placement) => {
      const versionId = effectiveVersionId(placement);
      return boolInt(placement.active) === 1 &&
        versionId && publishedVersionIds.has(String(versionId));
    });
    const latest = sourceVersions.at(-1) ?? null;
    const activePlacement = activeSourcePlacements[0];
    const activeVersionId = activePlacement
      ? effectiveVersionId(activePlacement)
      : sourceVersions.filter((version) => version.status === "published").at(-1)?.id ?? null;
    const createdAt = isoOr(row.created_at, capturedAt);
    const updatedAt = isoOr(row.updated_at, createdAt);
    const status = activeVersionId ? "active" : "draft";
    workflows.push({
      id: workflowId, project_id: project.project_id,
      identifier: identifierFor(context, row, "onboarding"),
      name: text(row.display_name ?? row.name, `Onboarding ${workflowId}`),
      description: nullableText(row.description), frequency: "once", status,
      origin: "onboardings", legacy_id: String(row.id), draft_revision: Math.max(1, sourceVersions.length),
      created_by: actorId, created_at: createdAt, updated_at: updatedAt, archived_at: null,
    });
    for (const sourceVersion of sourceVersions) {
      const definition = parseObject(sourceVersion.definition_json, `onboarding_versions.${sourceVersion.id}.definition_json`);
      definitions.set(String(sourceVersion.id), definition);
      const flowVersionId = requiredMappedId(
        versionByLegacy,
        sourceVersion.id,
        "onboardings.onboarding_versions.id",
      );
      const legacyVersionId = requiredMappedId(
        legacyVersionByLegacy,
        sourceVersion.id,
        "onboardings.onboarding_versions.id",
      );
      const graph = onboardingGraph({ projectId: project.project_id, workflowId, definition, placements: sourcePlacements.filter((placement) => String(effectiveVersionId(placement) ?? "") === String(sourceVersion.id)), rulesByPlacement, experimentsByPlacement, variantsByExperiment, definitionByVersion: definitions, versionRows: sourceVersions });
      const graphJson = canonicalJson(graph);
      const publishedAt = isoOr(sourceVersion.published_at, isoOr(sourceVersion.created_at, createdAt));
      versions.push({
        id: flowVersionId, project_id: project.project_id,
        workflow_id: workflowId, version: number(sourceVersion.version), graph_json: graphJson,
        changelog: null, checksum_sha256: sha256(graphJson), migration_strategy: "finish-current",
        published_by: actorId, published_at: publishedAt,
      });
      legacyVersions.push({
        id: legacyVersionId,
        legacy_id: sourceId(sourceVersion.id, "onboardings.onboarding_versions.id"),
        project_id: project.project_id,
        source_module: "onboardings", workflow_id: workflowId,
        version: number(sourceVersion.version), status: enumValue(sourceVersion.status, ["draft", "published", "archived"], "draft"),
        definition_json: canonicalJson(definition), changelog: null, flow_version_id: flowVersionId,
        created_at: isoOr(sourceVersion.created_at, createdAt),
        published_at: sourceVersion.status === "published" ? publishedAt : null,
        archived_at: sourceVersion.status === "archived" ? publishedAt : null,
      });
      mappings.push(mapping(project.project_id, "onboardings", "version", sourceVersion.id, "workflow_version", flowVersionId, capturedAt, { workflow_id: workflowId }));
      mappings.push(mapping(project.project_id, "onboardings", "legacy_version", sourceVersion.id, "legacy_version", legacyVersionId, capturedAt, { workflow_id: workflowId }));
    }
    const latestDefinition = latest ? definitions.get(String(latest.id)) ?? parseObject(latest.definition_json, "onboarding latest definition") : {};
    drafts.push({
      workflow_id: workflowId, project_id: project.project_id,
      revision: Math.max(1, sourceVersions.length),
      graph_json: canonicalJson(onboardingGraph({ projectId: project.project_id, workflowId, definition: latestDefinition, placements: sourcePlacements, rulesByPlacement, experimentsByPlacement, variantsByExperiment, definitionByVersion: definitions, versionRows: sourceVersions })),
      validation_json: canonicalJson({ valid: true, issues: [] }), updated_by: actorId, updated_at: updatedAt,
    });
    const activeVersionIds = [...new Set(
      activeSourcePlacements.map((placement) => String(effectiveVersionId(placement))),
    )].sort();
    let releaseVersionId = activeVersionId
      ? versionByLegacy.get(String(activeVersionId))
      : null;
    if (activeVersionIds.length > 1) {
      const canonicalGraph = onboardingGraph({
        projectId: project.project_id,
        workflowId,
        definition: latestDefinition,
        placements: activeSourcePlacements.map((placement) => ({
          ...placement,
          active_version_id: effectiveVersionId(placement),
        })),
        rulesByPlacement,
        experimentsByPlacement,
        variantsByExperiment,
        definitionByVersion: definitions,
        versionRows: sourceVersions,
      });
      const graphJson = canonicalJson(canonicalGraph);
      releaseVersionId = deterministicUuid(
        "flows-cutover",
        project.project_ref,
        "onboardings",
        row.id,
        "canonical-release",
        sha256(graphJson),
      );
      versions.push({
        id: releaseVersionId,
        project_id: project.project_id,
        workflow_id: workflowId,
        version: Math.max(0, ...sourceVersions.map((version) => number(version.version))) + 1,
        graph_json: graphJson,
        changelog: "Canonical cutover release preserving all active Onboarding placements",
        checksum_sha256: sha256(graphJson),
        migration_strategy: "finish-current",
        published_by: actorId,
        published_at: updatedAt,
      });
      mappings.push(mapping(
        project.project_id,
        "onboardings",
        "canonical_release",
        row.id,
        "workflow_version",
        releaseVersionId,
        capturedAt,
        {
          workflow_id: workflowId,
          active_placement_versions: activeSourcePlacements.map((placement) => ({
            placement_id: String(placement.id),
            version_id: String(effectiveVersionId(placement)),
          })),
        },
      ));
    }
    if (releaseVersionId) {
      releases.push(release(project.project_id, environmentId, workflowId, releaseVersionId, actorId, updatedAt, status === "active"));
    }
    mappings.push(mapping(project.project_id, "onboardings", "onboarding", row.id, "workflow", workflowId, capturedAt, { identifier: row.identifier ?? null }));
  }

  for (const row of stable(tables.placements, ["priority", "id"], true)) {
    const workflowId = workflowByLegacy.get(String(row.onboarding_id));
    if (!workflowId) throw new Error(`Onboarding placement ${row.id} references an unknown onboarding`);
    const sourceOnboarding = tables.onboardings.find(
      (onboarding) => String(onboarding.id) === String(row.onboarding_id),
    );
    const placementExperiments = stable(experimentsByPlacement.get(String(row.id)) ?? [], ["created_at", "id"], true);
    placements.push({
      id: requiredMappedId(placementByLegacy, row.id, "onboardings.placements.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "onboardings.placements.id"),
      source_module: "onboardings", key: text(row.key, `placement-${row.id}`),
      workflow_id: workflowId,
      active_legacy_version_id: optionalMappedId(legacyVersionByLegacy, row.active_version_id ?? sourceOnboarding?.active_version_id, "onboardings.placements.active_version_id"),
      experience_id: optionalMappedId(
        experimentByLegacy,
        placementExperiments.find((experience) => experience.status === "running")?.id ?? placementExperiments[0]?.id,
        "onboardings.placements.experience_id",
      ),
      targeting_json: canonicalJson({}), priority: number(row.priority), active: boolInt(row.active),
      created_at: isoOr(row.created_at, capturedAt), updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
    });
    mappings.push(mapping(project.project_id, "onboardings", "placement", row.id, "legacy_placement", requiredMappedId(placementByLegacy, row.id, "onboardings.placements.id"), capturedAt));
  }
  for (const row of stable(tables.targeting_rules, ["placement_id", "priority", "id"], true)) {
    if (!tables.placements.some((placement) => String(placement.id) === String(row.placement_id))) throw new Error(`Onboarding targeting rule ${row.id} references an unknown placement`);
    targetingRules.push({
      id: requiredMappedId(targetingRuleByLegacy, row.id, "onboardings.targeting_rules.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "onboardings.targeting_rules.id"), source_module: "onboardings",
      placement_id: requiredMappedId(placementByLegacy, row.placement_id, "onboardings.targeting_rules.placement_id"),
      conditions_json: canonicalJson(parseJson(row.conditions_json, `onboardings.targeting_rules.${row.id}.conditions_json`)),
      priority: number(row.priority), active: boolInt(row.active),
      created_at: isoOr(row.created_at, capturedAt), updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
    });
    mappings.push(mapping(project.project_id, "onboardings", "targeting_rule", row.id, "legacy_targeting_rule", requiredMappedId(targetingRuleByLegacy, row.id, "onboardings.targeting_rules.id"), capturedAt));
  }
  for (const row of stable(tables.experiences, ["id"])) {
    const placement = tables.placements.find((candidate) => String(candidate.id) === String(row.placement_id));
    const workflowId = placement ? workflowByLegacy.get(String(placement.onboarding_id)) : null;
    if (!workflowId) throw new Error(`Onboarding experience ${row.id} references an unknown placement`);
    experiments.push({
      id: requiredMappedId(experimentByLegacy, row.id, "onboardings.experiences.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "onboardings.experiences.id"),
      source_module: "onboardings", workflow_id: workflowId,
      placement_id: requiredMappedId(placementByLegacy, row.placement_id, "onboardings.experiences.placement_id"), name: text(row.name, `Experiment ${row.id}`),
      status: enumValue(row.status, ["draft", "running", "paused", "completed"], "draft"),
      traffic_percent: bounded(Math.round(number(row.traffic_percentage) / 100), 0, 100),
      starts_at: null, ends_at: null, created_at: isoOr(row.created_at, capturedAt),
      updated_at: isoOr(row.updated_at, isoOr(row.created_at, capturedAt)),
      traffic_basis_points: bounded(number(row.traffic_percentage), 0, 10_000),
    });
    mappings.push(mapping(project.project_id, "onboardings", "experience", row.id, "legacy_experiment", requiredMappedId(experimentByLegacy, row.id, "onboardings.experiences.id"), capturedAt));
  }
  for (const row of stable(tables.experience_variants, ["experience_id", "id"])) {
    if (!tables.experiences.some((experience) => String(experience.id) === String(row.experience_id))) throw new Error(`Onboarding variant ${row.id} references an unknown experience`);
    if (!versionByLegacy.has(String(row.version_id))) throw new Error(`Onboarding variant ${row.id} references an unknown version`);
    variants.push({
      id: requiredMappedId(variantByLegacy, row.id, "onboardings.experience_variants.id"), project_id: project.project_id,
      legacy_id: sourceId(row.id, "onboardings.experience_variants.id"), source_module: "onboardings",
      experiment_id: requiredMappedId(experimentByLegacy, row.experience_id, "onboardings.experience_variants.experience_id"),
      legacy_version_id: requiredMappedId(legacyVersionByLegacy, row.version_id, "onboardings.experience_variants.version_id"), key: text(row.name, `variant-${row.id}`),
      weight: Math.max(1, number(row.weight)), active: 1,
      created_at: isoOr(row.created_at, capturedAt), updated_at: isoOr(row.created_at, capturedAt),
    });
    mappings.push(mapping(project.project_id, "onboardings", "variant", row.id, "legacy_variant", requiredMappedId(variantByLegacy, row.id, "onboardings.experience_variants.id"), capturedAt));
  }

  const eventProjection = projectEvents({ source: "onboardings", events: tables.events, project, environmentId, capturedAt, workflowByLegacy, versionByLegacy, placements: tables.placements, experiments: tables.experiences, variants: tables.experience_variants, definitions, userIdHashes: context.userIdHashes });
  mappings.push(...eventProjection.mappings);
  return {
    workflows, drafts, versions, legacy_versions: legacyVersions, releases,
    placements, experiments, variants, targeting_rules: targetingRules, mappings,
    analytics: eventProjection.analytics, claims: eventProjection.claims,
    users: eventProjection.users,
    states: eventProjection.states, assignments: eventProjection.assignments,
    audit: [auditRow("onboardings", project, actorId, capturedAt, tables, eventProjection.analytics.length)],
  };
}

function projectEvents({ source, events, project, environmentId, capturedAt, workflowByLegacy, versionByLegacy, placements, experiments, variants, definitions, userIdHashes }) {
  const analytics = [], claims = [], mappings = [];
  const users = new Map(), states = new Map(), assignments = new Map();
  const placementByKey = new Map(placements.map((row) => [String(row.key), row]));
  const experimentById = new Map(experiments.map((row) => [String(row.id), row]));
  const variantById = new Map(variants.map((row) => [String(row.id), row]));
  for (const row of stable(events, ["occurred_at", "id"])) {
    const legacyId = sourceId(row.id, `${source}.events.id`);
    // Analytics ids are namespaced because the historical modules lived in
    // separate D1 databases. The raw id remains the legacy idempotency key.
    const eventId = `legacy:${source}:${legacyId}`;
    const placement = placementByKey.get(String(row.placement));
    const legacyWorkflowId = row.paywall_id ?? row.onboarding_id ?? placement?.paywall_id ?? placement?.onboarding_id ?? null;
    const workflowId = legacyWorkflowId ? workflowByLegacy.get(String(legacyWorkflowId)) ?? null : null;
    const workflowVersionId = row.version_id ? versionByLegacy.get(String(row.version_id)) ?? null : null;
    const occurredAt = isoOr(row.occurred_at, capturedAt);
    const runtimeIdentity = legacyRuntimeUserId(source, row);
    if (!runtimeIdentity.explicit && workflowId) {
      throw new Error(
        `${source}.events.${legacyId} cannot resume workflow state or an experiment assignment because its stable customer/session identity was not persisted`,
      );
    }
    const userHash = resolvedLegacyUserHash(
      userIdHashes,
      runtimeIdentity.userId,
      `${source}.events.${legacyId}`,
    );
    const eventName = legacyEventName(String(row.event_type || ""));
    const properties = {
      analytics_namespace: "flows.legacy",
      verified_fact_eligible: false,
      excluded_metrics: ["installation", "purchase"],
      source_module: source,
      legacy_event_id: legacyId,
      legacy: {
        source,
        imported_history: true,
        authoritative_purchase:
          source === "paywalls" && String(row.event_type || "").toLowerCase() === "purchase",
        type: text(row.event_type, "unknown"),
        placement: row.placement ?? null,
        platform: row.platform ?? null,
        placement_id: placement?.id ?? null,
        workflow_id: legacyWorkflowId === null ? null : String(legacyWorkflowId),
        version_id: row.version_id === null || row.version_id === undefined ? null : String(row.version_id),
        experience_id: row.experience_id ?? null,
        variant_id: row.variant_id ?? null,
        step_id: row.step_id ?? null,
        revenue_micros: number(row.revenue_micros),
        currency: row.currency ?? null,
      },
      payload: parseObject(row.payload_json, `${source}.events.${legacyId}.payload_json`),
    };
    analytics.push({
      event_id: eventId, project_id: project.project_id, project_ref: project.project_ref,
      environment_id: environmentId, user_id_hash: userHash,
      event_name: eventName, workflow_id: workflowId, workflow_version_id: workflowVersionId,
      block_id: row.step_id ? String(row.step_id) : workflowId ? `${workflowId}:${source === "paywalls" ? "commerce" : "onboarding-tour"}` : null,
      block_key: row.step_id ? String(row.step_id) : source === "paywalls" ? "superboard-commerce" : "onboarding-tour",
      properties_json: canonicalJson(properties), legacy_event_type: text(row.event_type, "unknown"),
      occurred_at: occurredAt, projected_at: capturedAt,
      source_event_id: legacyId, source_module: source,
    });
    claims.push({
      event_id: legacyId,
      project_id: project.project_id,
      source_module: source,
      claimed_at: occurredAt,
    });
    mappings.push(mapping(project.project_id, source, "event", legacyId, "analytics_event", eventId, capturedAt));
    const existingUser = users.get(userHash);
    users.set(userHash, {
      project_id: project.project_id, environment_id: environmentId,
      user_id_hash: userHash, external_user_id_ciphertext: null, properties_ciphertext: null,
      locale: null, country: null, platform: nullableText(row.platform),
      first_seen_at: existingUser ? earliest(existingUser.first_seen_at, occurredAt) : occurredAt,
      last_seen_at: existingUser ? latest(existingUser.last_seen_at, occurredAt) : occurredAt,
    });
    if (workflowId) {
      const key = `${userHash}\u001f${workflowId}`;
      const existing = states.get(key);
      const state = workflowState(row.event_type, existing?.state);
      const terminal = new Set(["completed", "stopped"]).has(state);
      const activeBlockIds = terminal
        ? []
        : [legacyActiveBlockId(source, workflowId, placement, row)];
      const tourIndexes = source === "onboardings" && !terminal
        ? legacyTourIndexes(workflowId, placement, row, definitions)
        : {};
      states.set(key, {
        project_id: project.project_id, environment_id: environmentId,
        user_id_hash: userHash, workflow_id: workflowId,
        workflow_version_id: workflowVersionId ?? existing?.workflow_version_id ?? null,
        state, active_block_ids_json: canonicalJson(activeBlockIds),
        entered_at: existing ? earliest(existing.entered_at, occurredAt) : occurredAt,
        exited_at: new Set(["completed", "stopped"]).has(state) ? occurredAt : null,
        generation: 1,
        revision: Number(existing?.revision ?? 0) + 1,
        tour_indexes_json: canonicalJson(tourIndexes),
        updated_at: existing ? latest(existing.updated_at, occurredAt) : occurredAt,
      });
    }
    if (workflowId && row.experience_id && row.variant_id) {
      const experiment = experimentById.get(String(row.experience_id));
      const variant = variantById.get(String(row.variant_id));
      if (experiment && variant) {
        if (!placement) {
          throw new Error(
            `${source}.events.${legacyId} cannot preserve its experiment assignment because placement ${String(row.placement)} was not found`,
          );
        }
        const splitBlockId = `${workflowId}:placement:${placement.id}:experiment:${experiment.id}:split`;
        const key = `${workflowId}\u001f${splitBlockId}\u001f${userHash}`;
        assignments.set(key, {
          project_id: project.project_id, environment_id: environmentId,
          workflow_id: workflowId, split_block_id: splitBlockId, user_id_hash: userHash,
          variant_key: text(variant.key ?? variant.name, `variant-${variant.id}`), assigned_at: occurredAt,
        });
      }
    }
  }
  return { analytics, claims, mappings, users: [...users.values()], states: [...states.values()], assignments: [...assignments.values()] };
}

function legacyActiveBlockId(source, workflowId, placement, row) {
  if (!placement) {
    throw new Error(
      `${source}.events.${String(row.id)} cannot resume in-progress state because placement ${String(row.placement)} was not found`,
    );
  }
  const placementId = String(placement.id);
  if (source === "paywalls") {
    return row.variant_id
      ? `${workflowId}:placement:${placementId}:variant:${row.variant_id}:commerce`
      : `${workflowId}:placement:${placementId}:commerce`;
  }
  return row.variant_id
    ? `${workflowId}:placement:${placementId}:variant:${row.variant_id}:onboarding-tour`
    : `${workflowId}:placement:${placementId}:onboarding-tour`;
}

function legacyTourIndexes(workflowId, placement, row, definitions) {
  const blockId = legacyActiveBlockId("onboardings", workflowId, placement, row);
  if (!row.step_id || !row.version_id) return { [blockId]: 0 };
  const definition = definitions.get(String(row.version_id));
  const screens = array(definition?.screens);
  const index = screens.findIndex(
    (screen) => String(object(screen).id ?? "") === String(row.step_id),
  );
  return { [blockId]: index < 0 ? 0 : index };
}

function paywallCanonicalGraph({ projectId, workflowId, fallbackDefinition, placements, experiments, variantsByExperiment, definitionByVersion, versionRows }) {
  const activePlacements = stable(placements, ["priority", "id"], true)
    .filter((placement) => boolInt(placement.active) === 1);
  const effectivePlacements = activePlacements.length
    ? activePlacements
    : [{ id: "default", key: "paywall", active: 1, targeting_json: "{}", active_version_id: null, experience_id: null }];
  const experimentById = new Map(experiments.map((row) => [String(row.id), row]));
  const blocks = [];
  const paths = [];
  const splitBlocks = new Map();

  for (const [placementIndex, placement] of effectivePlacements.entries()) {
    const placementId = String(placement.id);
    const placementKey = text(placement.key, `placement-${placementId}`);
    const start = startBlock(
      `${workflowId}:placement:${placementId}:start`,
      placementKey,
      legacyConditions(parseObject(placement.targeting_json, `paywalls.placements.${placementId}.targeting_json`)),
      {
        legacy_source: "paywalls",
        legacy_project_id: projectId,
        legacy_placement_id: placementId,
        legacy_priority: number(placement.priority),
      },
    );
    start.position = { x: 0, y: 80 + placementIndex * 220 };
    blocks.push(start);
    const activeDefinition = definitionByVersion.get(String(placement.active_version_id)) ?? fallbackDefinition;
    const experiment = placement.experience_id
      ? experimentById.get(String(placement.experience_id))
      : null;
    if (!experiment || experiment.status !== "running") {
      const component = commerceBlock(
        `${workflowId}:placement:${placementId}:commerce`,
        activeDefinition,
        placementKey,
        {
          placement: placementKey,
          placement_id: placementId,
          legacy_priority: number(placement.priority),
          active_legacy_version_id: nullableId(placement.active_version_id),
        },
      );
      component.position = { x: 560, y: 80 + placementIndex * 220 };
      blocks.push(component);
      paths.push(path(`${start.id}:component`, start.id, "default", component.id));
      continue;
    }

    const splitId = `${workflowId}:placement:${placementId}:experiment:${experiment.id}:split`;
    const sourceVariants = stable(
      variantsByExperiment.get(String(experiment.id)) ?? [],
      ["key", "id"],
    ).filter((row) => boolInt(row.active) === 1);
    const graphVariants = sourceVariants.map((row) => ({
      key: text(row.key, String(row.id)),
      weight: Math.max(1, number(row.weight)),
    }));
    if (graphVariants.some((variant) => variant.key === "holdout")) {
      throw new Error(`Paywall experience ${String(experiment.id)} uses reserved variant key holdout`);
    }
    if (!splitBlocks.has(splitId)) {
      const split = {
        id: splitId,
        key: `traffic-${experiment.id}`,
        type: "traffic-split",
        name: text(experiment.name, "Migrated experiment"),
        data: {
          variants: graphVariants,
          legacy_source: "paywalls",
          legacy_project_id: projectId,
          legacy_placement_id: placementId,
          legacy_experience_id: experiment.id,
          traffic_basis_points: bounded(number(experiment.traffic_percent) * 100, 0, 10_000),
        },
        propertyMeta: [],
        exitNodes: [...graphVariants.map((row) => row.key), "holdout"],
        position: { x: 280, y: 80 + placementIndex * 220 },
      };
      splitBlocks.set(splitId, split);
      blocks.push(split);
    }
    paths.push(path(`${start.id}:split`, start.id, "default", splitId));
    for (const [variantIndex, variant] of sourceVariants.entries()) {
      const definitionRow = versionRows.find((row) => String(row.id) === String(variant.version_id));
      const definition = definitionByVersion.get(String(variant.version_id)) ??
        (definitionRow
          ? parseObject(definitionRow.definition_json, "paywall canonical variant definition")
          : activeDefinition);
      const variantKey = text(variant.key, String(variant.id));
      const component = commerceBlock(
        `${workflowId}:placement:${placementId}:variant:${variant.id}:commerce`,
        definition,
        placementKey,
        {
          placement: placementKey,
          placement_id: placementId,
          legacy_priority: number(placement.priority),
          active_legacy_version_id: nullableId(placement.active_version_id),
          experience_id: experiment.id,
          variant_id: variant.id,
        },
      );
      component.position = {
        x: 560 + variantIndex * 220,
        y: 80 + placementIndex * 220,
      };
      blocks.push(component);
      paths.push(path(
        `${splitId}:${variantKey}:${placementId}`,
        splitId,
        variantKey,
        component.id,
      ));
    }
    const holdout = commerceBlock(
      `${workflowId}:placement:${placementId}:experiment:${experiment.id}:holdout:commerce`,
      activeDefinition,
      placementKey,
      {
        placement: placementKey,
        placement_id: placementId,
        legacy_priority: number(placement.priority),
        active_legacy_version_id: nullableId(placement.active_version_id),
        experience_id: experiment.id,
        legacy_holdout: true,
      },
    );
    holdout.position = {
      x: 560 + sourceVariants.length * 220,
      y: 80 + placementIndex * 220,
    };
    blocks.push(holdout);
    paths.push(path(`${splitId}:holdout:${placementId}`, splitId, "holdout", holdout.id));
  }
  return { schemaVersion: 1, blocks, paths };
}

function onboardingGraph({ projectId, workflowId, definition, placements, rulesByPlacement, experimentsByPlacement, variantsByExperiment, definitionByVersion, versionRows }) {
  const effectivePlacements = placements.length ? placements : [{ id: "default", key: "onboarding", active: 1 }];
  const blocks = [];
  const paths = [];
  for (const [placementIndex, placement] of effectivePlacements.entries()) {
    const placementId = String(placement.id);
    const placementKey = text(placement.key, `placement-${placementId}`);
    const rules = (rulesByPlacement.get(String(placement.id)) ?? []).filter((row) => boolInt(row.active) === 1);
    const starts = rules.length
      ? rules.map((rule) => startBlock(
          `${workflowId}:placement:${placementId}:rule:${rule.id}:start`,
          placementKey,
          conditionsFromUnknown(parseJson(rule.conditions_json, "onboarding targeting")),
          {
            legacy_source: "onboardings",
            legacy_project_id: projectId,
            legacy_placement_id: placementId,
            legacy_priority: number(placement.priority),
            legacy_rule_priority: number(rule.priority),
          },
        ))
      : [startBlock(`${workflowId}:placement:${placementId}:start`, placementKey, [], {
          legacy_source: "onboardings",
          legacy_project_id: projectId,
          legacy_placement_id: placementId,
          legacy_priority: number(placement.priority),
        })];
    for (const [startIndex, start] of starts.entries()) {
      start.position = {
        x: 0,
        y: 80 + placementIndex * 260 + startIndex * 70,
      };
      blocks.push(start);
    }
    const activeDefinition = definitionByVersion.get(String(placement.active_version_id)) ?? definition;
    const experiment = stable(
      experimentsByPlacement.get(placementId) ?? [],
      ["created_at", "id"],
      true,
    ).find((row) => row.status === "running") ?? null;
    if (!experiment) {
      const component = onboardingBlock(
        `${workflowId}:placement:${placementId}:onboarding-tour`,
        activeDefinition,
        placementKey,
        {
          placement: placementKey,
          placement_id: placementId,
          legacy_priority: number(placement.priority),
          active_legacy_version_id: nullableId(placement.active_version_id),
        },
      );
      component.position = { x: 560, y: 80 + placementIndex * 260 };
      blocks.push(component);
      for (const start of starts) {
        paths.push(path(`${start.id}:tour`, start.id, "default", component.id));
      }
      continue;
    }

    const splitId = `${workflowId}:placement:${placementId}:experiment:${experiment.id}:split`;
    const sourceVariants = stable(variantsByExperiment.get(String(experiment.id)) ?? [], ["id"]);
    const graphVariants = sourceVariants.map((row) => ({ key: text(row.name, `variant-${row.id}`), weight: Math.max(1, number(row.weight)) }));
    if (graphVariants.some((variant) => variant.key === "holdout")) {
      throw new Error(`Onboarding experience ${String(experiment.id)} uses reserved variant key holdout`);
    }
    blocks.push({
      id: splitId,
      key: `traffic-${experiment.id}`,
      type: "traffic-split",
      name: text(experiment.name, "Migrated experiment"),
      data: {
        variants: graphVariants,
        legacy_source: "onboardings",
        legacy_project_id: projectId,
        legacy_placement_id: placementId,
        legacy_experience_id: experiment.id,
        traffic_basis_points: bounded(number(experiment.traffic_percentage), 0, 10_000),
        legacy_assignment_preserved: true,
      },
      propertyMeta: [],
      exitNodes: [...graphVariants.map((row) => row.key), "holdout"],
      position: { x: 280, y: 80 + placementIndex * 260 },
    });
    for (const start of starts) paths.push(path(`${start.id}:split`, start.id, "default", splitId));
    for (const [variantIndex, variant] of sourceVariants.entries()) {
      const definitionRow = versionRows.find((row) => String(row.id) === String(variant.version_id));
      const variantDefinition = definitionByVersion.get(String(variant.version_id)) ?? (definitionRow ? parseObject(definitionRow.definition_json, "onboarding variant definition") : activeDefinition);
      const component = onboardingBlock(
        `${workflowId}:placement:${placementId}:variant:${variant.id}:onboarding-tour`,
        variantDefinition,
        placementKey,
        {
          placement: placementKey,
          placement_id: placementId,
          legacy_priority: number(placement.priority),
          active_legacy_version_id: nullableId(placement.active_version_id),
          experience_id: experiment.id,
          variant_id: variant.id,
        },
      );
      component.position = {
        x: 560 + variantIndex * 220,
        y: 80 + placementIndex * 260,
      };
      blocks.push(component);
      paths.push(path(`${splitId}:${variant.id}:${placementId}`, splitId, text(variant.name, `variant-${variant.id}`), component.id));
    }
    const holdout = onboardingBlock(
      `${workflowId}:placement:${placementId}:experiment:${experiment.id}:holdout:onboarding-tour`,
      activeDefinition,
      placementKey,
      {
        placement: placementKey,
        placement_id: placementId,
        legacy_priority: number(placement.priority),
        active_legacy_version_id: nullableId(placement.active_version_id),
        experience_id: experiment.id,
        legacy_holdout: true,
      },
    );
    holdout.position = {
      x: 560 + sourceVariants.length * 220,
      y: 80 + placementIndex * 260,
    };
    blocks.push(holdout);
    paths.push(path(`${splitId}:holdout:${placementId}`, splitId, "holdout", holdout.id));
  }
  return { schemaVersion: 1, blocks, paths };
}

function startBlock(id, placement, conditions, legacy = {}) {
  return { id, key: `start-${placement}`, type: "start", name: `Start: ${placement}`, data: { legacy_placement: placement, ...legacy }, propertyMeta: [], exitNodes: ["default"], position: { x: 0, y: 120 }, ...(conditions.length ? { conditions } : {}) };
}

function commerceBlock(id, definition, slotId, extra = {}) {
  return {
    id, key: "superboard-commerce", type: "component", name: "SuperBoard Commerce",
    componentType: "superboard-commerce", componentLibraryName: "superboard",
    data: {
      schema_version: definition.schema_version ?? 1,
      theme: object(definition.theme), components: array(definition.components),
      metadata: object(definition.metadata), original_definition: definition,
      authority: "products", purchase_events_are_verified: true,
      flows_events_count_as_purchase: false, ...extra,
    },
    propertyMeta: [{ key: "checkout", type: "action" }, { key: "purchase", type: "action" }, { key: "restore", type: "action" }],
    exitNodes: ["impression", "cta", "dismiss", "checkout", "purchase", "cancel", "restore", "error"],
    position: { x: 560, y: 120 }, slottable: true, slotId: text(slotId, "paywall"),
  };
}

function onboardingBlock(id, definition, slotId, extra = {}) {
  const screens = array(definition.screens).map((screen, index) => {
    const value = object(screen);
    return {
      ...value,
      id: text(value.id, `screen-${index + 1}`),
      blocks: array(value.blocks).map((block) => {
        const candidate = object(block);
        if (candidate.type !== "marketing_consent") return candidate;
        return {
          ...candidate,
          props: {
            ...object(candidate.props), default: false, required: false,
            explicit_action_required: true, destination: "marketing",
          },
        };
      }),
    };
  });
  return {
    id, key: "onboarding-tour", type: "tour", name: "Migrated onboarding",
    componentType: "superboard-onboarding", componentLibraryName: "superboard",
    data: { screens, theme: object(definition.theme), preload_all_steps: true, original_definition: definition, ...extra },
    propertyMeta: [], exitNodes: ["progress", "back", "skip", "abandon", "complete", "error"],
    position: { x: 560, y: 120 }, slottable: true, slotId: text(slotId, "onboarding"),
  };
}

function path(id, sourceBlockId, sourceExitNode, targetBlockId) {
  return { id, sourceBlockId, sourceExitNode, targetBlockId };
}

function legacyConditions(targeting) {
  const conditions = [];
  for (const [plural, singular, key] of [["platforms", "platform", "platform"], ["locales", "locale", "locale"], ["countries", "country", "country"]]) {
    const values = [...array(targeting[plural]), ...(typeof targeting[singular] === "string" ? [targeting[singular]] : [])]
      .filter((value) => typeof value === "string")
      .map((value) => key === "country" ? value.trim().toUpperCase() : value.trim().toLowerCase());
    if (values.length) conditions.push({ key, data_type: "string", operator: "equals", value: values });
  }
  for (const [key, value] of Object.entries(object(targeting.attributes))) {
    if (["string", "number", "boolean"].includes(typeof value)) conditions.push({ key, data_type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string", operator: "equals", value });
  }
  return conditions;
}

function conditionsFromUnknown(input) {
  if (Array.isArray(input)) return input.flatMap(conditionsFromUnknown);
  const value = object(input);
  if (Array.isArray(value.conditions)) return value.conditions.flatMap(conditionsFromUnknown);
  if (value.key && value.operator && value.value !== undefined) {
    const dataType = ["string", "number", "boolean", "array"].includes(value.data_type) ? value.data_type : inferDataType(value.value);
    return [{ key: String(value.key), data_type: dataType, operator: normalizeOperator(value.operator), value: value.value }];
  }
  return legacyConditions(value);
}

function normalizeOperator(value) {
  const operator = String(value).toLowerCase().replaceAll("_", "-");
  return new Set(["equals", "not-equals", "greater-than", "greater-than-or-equal", "less-than", "less-than-or-equal", "contains", "not-contains", "starts-with", "ends-with", "regex"]).has(operator) ? operator : "equals";
}

function inferDataType(value) {
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

function workflowState(eventType, previous) {
  const type = String(eventType || "").toLowerCase();
  if (new Set(["complete", "completed"]).has(type)) return "completed";
  if (new Set(["abandon", "abandoned", "skip", "skipped"]).has(type)) return "stopped";
  return previous && new Set(["completed", "stopped"]).has(previous) ? previous : "in-progress";
}

function legacyEventName(eventType) {
  const type = eventType.toLowerCase();
  if (new Set(["impression", "view", "step_view"]).has(type)) return "block-activated";
  if (new Set(["complete", "completed", "abandon", "abandoned", "skip", "skipped"]).has(type)) return "workflow-exit";
  return "transition";
}

function legacyRuntimeUserId(source, row) {
  for (const candidate of [row.customer_id, row.anonymous_id, row.session_id]) {
    const value = String(candidate ?? "").trim();
    if (value) return { userId: value, explicit: true };
  }
  return { userId: `${source}:anonymous`, explicit: false };
}

function normalizeUserIdHashes(value) {
  const entries = value instanceof Map
    ? [...value.entries()]
    : Object.entries(value ?? {});
  const hashes = new Map();
  for (const [rawUserId, userIdHash] of entries) {
    const raw = String(rawUserId);
    const hash = String(userIdHash ?? "");
    if (!raw || !/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error("Flows cutover received an invalid Worker-resolved user hash");
    }
    hashes.set(raw, hash);
  }
  return hashes;
}

function resolvedLegacyUserHash(userIdHashes, rawUserId, label) {
  const hash = userIdHashes.get(rawUserId);
  if (!hash) {
    throw new Error(
      `${label} has no Worker-resolved runtime-compatible user hash`,
    );
  }
  return hash;
}

function reconcileUsers(rowsByEntity) {
  const paywallRows = rowsByEntity["paywalls.users"] ?? [];
  const onboardingRows = rowsByEntity["onboardings.users"] ?? [];
  const paywallByKey = new Map(paywallRows.map((row) => [userProjectionKey(row), row]));
  const remainingOnboardings = [];
  for (const onboarding of onboardingRows) {
    const key = userProjectionKey(onboarding);
    const paywall = paywallByKey.get(key);
    if (!paywall) {
      remainingOnboardings.push(onboarding);
      continue;
    }
    const latestRow = paywall.last_seen_at >= onboarding.last_seen_at
      ? paywall
      : onboarding;
    paywall.first_seen_at = earliest(
      paywall.first_seen_at,
      onboarding.first_seen_at,
    );
    paywall.last_seen_at = latest(
      paywall.last_seen_at,
      onboarding.last_seen_at,
    );
    paywall.platform = latestRow.platform;
  }
  rowsByEntity["paywalls.users"] = paywallRows;
  rowsByEntity["onboardings.users"] = remainingOnboardings;
}

function userProjectionKey(row) {
  return `${row.project_id}\u001f${row.environment_id}\u001f${row.user_id_hash}`;
}

function release(projectId, environmentId, workflowId, workflowVersionId, actorId, activatedAt, active) {
  return { project_id: projectId, environment_id: environmentId, workflow_id: workflowId, workflow_version_id: workflowVersionId, use_draft: 0, active: active ? 1 : 0, activated_by: actorId, activated_at: activatedAt };
}

function mapping(projectId, source, sourceType, sourceIdValue, flowType, flowId, createdAt, metadata = {}) {
  return { project_id: projectId, source_module: source, source_type: sourceType, source_id: String(sourceIdValue), flow_type: flowType, flow_id: String(flowId), metadata_json: canonicalJson(metadata), created_at: createdAt };
}

function auditRow(source, project, actorId, occurredAt, tables, analyticsCount) {
  const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
  return {
    id: deterministicUuid("flows-cutover", project.project_ref, source, "audit", occurredAt),
    project_id: project.project_id, project_ref: project.project_ref,
    actor_id: actorId, action: `flows.cutover.${source}.imported`, entity_type: "migration",
    entity_id: source, payload_json: canonicalJson({ source_module: source, counts, analytics_events: analyticsCount, automatic_deletion: false }),
    request_id: deterministicUuid("flows-cutover", project.project_ref, source, "request", occurredAt), occurred_at: occurredAt,
  };
}

function workflowIdentifierIndex(sources) {
  const values = [];
  for (const row of sources.paywalls.tables.paywalls ?? []) values.push(["paywalls", row, baseIdentifier(row, "paywall")]);
  for (const row of sources.onboardings.tables.onboardings ?? []) values.push(["onboardings", row, baseIdentifier(row, "onboarding")]);
  const counts = new Map();
  for (const [, , value] of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return { counts };
}

function identifierFor(context, row, fallback) {
  const base = baseIdentifier(row, fallback);
  return context.workflowIdentifiers.counts.get(base) === 1 ? base : `${fallback}-${base}`;
}

function baseIdentifier(row, fallback) {
  const value = String(row.identifier || row.name || row.display_name || `${fallback}-${row.id}`).trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return value || `${fallback}-${String(row.id).slice(0, 24)}`;
}

function assertNoIdentifierCollisions(rowsByEntity) {
  const ids = new Set(), workflowIdentifiers = new Set();
  for (const [entity, rows] of Object.entries(rowsByEntity)) {
    for (const row of rows) {
      if (entity.endsWith(".workflows")) {
        if (ids.has(row.id)) throw new Error(`Legacy workflow id collision across modules: ${row.id}`);
        ids.add(row.id);
        if (workflowIdentifiers.has(row.identifier)) throw new Error(`Migrated workflow identifier collision: ${row.identifier}`);
        workflowIdentifiers.add(row.identifier);
      }
    }
  }
}

function requiredTables(tables, names, source) {
  const missing = names.filter((name) => !Array.isArray(tables[name]));
  if (missing.length) throw new Error(`${source} snapshot is missing tables: ${missing.join(", ")}`);
}

function group(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = String(row[key]);
    result.set(id, [...(result.get(id) ?? []), row]);
  }
  return result;
}

function importedIdMap(rows, project, source, type) {
  const result = new Map();
  for (const row of rows) {
    const rawId = sourceId(row.id, `${source}.${type}.id`);
    result.set(
      rawId,
      deterministicUuid(
        "flows-cutover",
        project.project_ref,
        project.project_id,
        source,
        type,
        rawId,
      ),
    );
  }
  return result;
}

function requiredMappedId(index, value, label) {
  const rawId = sourceId(value, label);
  const mapped = index.get(rawId);
  if (!mapped) throw new Error(`${label} references an unknown legacy id ${rawId}`);
  return mapped;
}

function optionalMappedId(index, value, label) {
  if (value === null || value === undefined || value === "") return null;
  return requiredMappedId(index, value, label);
}

function stable(rows, keys, descending = false) {
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const l = left[key] ?? "", r = right[key] ?? "";
      const result = typeof l === "number" && typeof r === "number" ? l - r : String(l).localeCompare(String(r));
      if (result) return descending ? -result : result;
    }
    return 0;
  });
}

function parseJson(value, label) {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`${label} is empty JSON`);
    try { return JSON.parse(value); } catch { throw new Error(`${label} is invalid JSON`); }
  }
  return structuredClone(value);
}

function parseObject(value, label) {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function object(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback) { const result = String(value ?? "").trim(); return result || fallback; }
function nullableText(value) { const result = String(value ?? "").trim(); return result || null; }
function sourceId(value, label) { const result = String(value ?? "").trim(); if (!result || result.length > 512) throw new Error(`${label} is invalid`); return result; }
function nullableId(value) { const result = String(value ?? "").trim(); return result || null; }
function requiredId(value, label) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:-]{1,192}$/u.test(result)) throw new Error(`${label} is invalid`); return result; }
function number(value) { const result = Number(value ?? 0); if (!Number.isFinite(result) || !Number.isSafeInteger(result)) throw new Error(`Expected a safe integer, got ${value}`); return result; }
function boolInt(value) { return Number(value) === 1 || value === true ? 1 : 0; }
function bounded(value, min, max) { return Math.min(max, Math.max(min, value)); }
function enumValue(value, allowed, fallback) { return allowed.includes(String(value)) ? String(value) : fallback; }
function isoOr(value, fallback) { return value === null || value === undefined || value === "" ? fallback : iso(value, "timestamp"); }
function nullableIso(value) { return value === null || value === undefined || value === "" ? null : iso(value, "timestamp"); }
function iso(value, label) { const raw = String(value); const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(raw) ? `${raw.replace(" ", "T")}Z` : raw; const date = new Date(candidate); if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`); return date.toISOString(); }
function earliest(left, right) { return left < right ? left : right; }
function latest(left, right) { return left > right ? left : right; }
