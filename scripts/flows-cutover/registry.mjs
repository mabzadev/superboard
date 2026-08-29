const WORKFLOW_COLUMNS = [
  "id", "project_id", "identifier", "name",
  "description", "frequency", "status", "origin", "legacy_id",
  "draft_revision", "created_by", "created_at", "updated_at", "archived_at",
];

const DRAFT_COLUMNS = [
  "workflow_id", "project_id", "revision", "graph_json",
  "validation_json", "updated_by", "updated_at",
];

const VERSION_COLUMNS = [
  "id", "project_id", "workflow_id", "version",
  "graph_json", "changelog", "checksum_sha256", "migration_strategy",
  "published_by", "published_at",
];

const RELEASE_COLUMNS = [
  "project_id", "environment_id", "workflow_id",
  "workflow_version_id", "use_draft", "active", "activated_by", "activated_at",
];

const LEGACY_VERSION_COLUMNS = [
  "id", "legacy_id", "project_id", "source_module", "workflow_id",
  "version", "status", "definition_json", "changelog", "flow_version_id",
  "created_at", "published_at", "archived_at",
];

const LEGACY_PLACEMENT_COLUMNS = [
  "id", "legacy_id", "project_id", "source_module", "key",
  "workflow_id", "active_legacy_version_id", "experience_id", "targeting_json",
  "priority", "active", "created_at", "updated_at",
];

const LEGACY_EXPERIMENT_COLUMNS = [
  "id", "legacy_id", "project_id", "source_module", "workflow_id",
  "placement_id", "name", "status", "traffic_percent", "starts_at", "ends_at",
  "created_at", "updated_at", "traffic_basis_points",
];

const LEGACY_VARIANT_COLUMNS = [
  "id", "legacy_id", "project_id", "source_module", "experiment_id", "legacy_version_id",
  "key", "weight", "active", "created_at", "updated_at",
];

const TARGETING_COLUMNS = [
  "id", "legacy_id", "project_id", "source_module", "placement_id", "conditions_json",
  "priority", "active", "created_at", "updated_at",
];

const MAPPING_COLUMNS = [
  "project_id", "source_module", "source_type", "source_id", "flow_type",
  "flow_id", "metadata_json", "created_at",
];

const ANALYTICS_COLUMNS = [
  "event_id", "project_id", "project_ref", "environment_id",
  "user_id_hash", "event_name", "workflow_id", "workflow_version_id", "block_id",
  "block_key", "properties_json", "legacy_event_type", "occurred_at", "projected_at",
  "source_event_id", "source_module",
];

const CLAIM_COLUMNS = [
  "event_id", "project_id", "source_module", "claimed_at",
];

const USER_COLUMNS = [
  "project_id", "environment_id", "user_id_hash",
  "external_user_id_ciphertext", "properties_ciphertext", "locale", "country",
  "platform", "first_seen_at", "last_seen_at",
];

const STATE_COLUMNS = [
  "project_id", "environment_id", "user_id_hash",
  "workflow_id", "workflow_version_id", "state", "active_block_ids_json",
  "entered_at", "exited_at", "generation", "revision", "tour_indexes_json",
  "updated_at",
];

const ASSIGNMENT_COLUMNS = [
  "project_id", "environment_id", "workflow_id",
  "split_block_id", "user_id_hash", "variant_key", "assigned_at",
];

const AUDIT_COLUMNS = [
  "id", "project_id", "project_ref", "actor_id", "action",
  "entity_type", "entity_id", "payload_json", "request_id", "occurred_at",
];

export const FLOW_CUTOVER_ENTITIES = Object.freeze([
  ...forSources("workflows", "flow_workflows", WORKFLOW_COLUMNS, ["id"], {
    numeric: ["project_id", "draft_revision"],
    where: "w.project_id = :project_id AND w.origin = :source_module",
    alias: "w",
    reverse: "workflow",
  }),
  ...forSources("drafts", "flow_workflow_drafts", DRAFT_COLUMNS, ["workflow_id"], {
    json: ["graph_json", "validation_json"],
    numeric: ["project_id", "revision"],
    from: "flow_workflow_drafts d JOIN flow_workflows w ON w.id = d.workflow_id",
    selectAlias: "d",
    where: "d.project_id = :project_id AND w.origin = :source_module",
  }),
  ...forSources("versions", "flow_workflow_versions", VERSION_COLUMNS, ["id"], {
    json: ["graph_json"],
    numeric: ["project_id", "version"],
    immutable: true,
    from: "flow_workflow_versions v JOIN flow_workflows w ON w.id = v.workflow_id",
    selectAlias: "v",
    where: "v.project_id = :project_id AND w.origin = :source_module",
  }),
  ...forSources("legacy_versions", "flow_legacy_versions", LEGACY_VERSION_COLUMNS, ["id"], {
    json: ["definition_json"],
    numeric: ["project_id", "version"],
    immutable: true,
    where: "l.project_id = :project_id AND l.source_module = :source_module",
    alias: "l",
    reverse: "version",
  }),
  ...forSources("releases", "flow_environment_releases", RELEASE_COLUMNS, ["environment_id", "workflow_id"], {
    numeric: ["project_id", "use_draft", "active"],
    from: "flow_environment_releases r JOIN flow_workflows w ON w.id = r.workflow_id",
    selectAlias: "r",
    where: "r.project_id = :project_id AND r.environment_id = :environment_id AND w.origin = :source_module",
  }),
  ...forSources("placements", "flow_legacy_placements", LEGACY_PLACEMENT_COLUMNS, ["id"], {
    json: ["targeting_json"],
    numeric: ["project_id", "priority", "active"],
    where: "p.project_id = :project_id AND p.source_module = :source_module",
    alias: "p",
    reverse: "placement",
  }),
  ...forSources("experiments", "flow_legacy_experiments", LEGACY_EXPERIMENT_COLUMNS, ["id"], {
    numeric: ["project_id", "traffic_percent", "traffic_basis_points"],
    where: "e.project_id = :project_id AND e.source_module = :source_module",
    alias: "e",
    reverse: "experiment",
  }),
  ...forSources("variants", "flow_legacy_variants", LEGACY_VARIANT_COLUMNS, ["id"], {
    numeric: ["project_id", "weight", "active"],
    from: "flow_legacy_variants v JOIN flow_legacy_experiments e ON e.id = v.experiment_id",
    selectAlias: "v",
    where: "v.project_id = :project_id AND e.source_module = :source_module",
    reverse: "variant",
  }),
  entity("onboardings.targeting_rules", "onboardings", "flow_legacy_targeting_rules", TARGETING_COLUMNS, ["id"], {
    json: ["conditions_json"],
    numeric: ["project_id", "priority", "active"],
    from: "flow_legacy_targeting_rules t JOIN flow_legacy_placements p ON p.id = t.placement_id",
    selectAlias: "t",
    where: "t.project_id = :project_id AND p.source_module = 'onboardings'",
    reverse: "targeting_rule",
  }),
  ...forSources("mappings", "flow_legacy_mappings", MAPPING_COLUMNS, ["project_id", "source_module", "source_type", "source_id"], {
    json: ["metadata_json"],
    numeric: ["project_id"],
    immutable: true,
    where: "m.project_id = :project_id AND m.source_module = :source_module",
    alias: "m",
  }),
  ...forSources("analytics", "flow_analytics_events", ANALYTICS_COLUMNS, ["project_id", "event_id"], {
    json: ["properties_json"],
    numeric: ["project_id"],
    immutable: true,
    where: "a.project_id = :project_id AND a.environment_id = :environment_id AND a.source_module = :source_module",
    alias: "a",
    reverse: "event",
    allowTargetSuperset: true,
  }),
  ...forSources("claims", "flow_legacy_event_claims", CLAIM_COLUMNS, ["project_id", "source_module", "event_id"], {
    numeric: ["project_id"],
    immutable: true,
    where: "c.project_id = :project_id AND c.source_module = :source_module",
    alias: "c",
    allowTargetSuperset: true,
  }),
  ...forSources("users", "flow_users", USER_COLUMNS, ["project_id", "environment_id", "user_id_hash"], {
    numeric: ["project_id"],
    where: `u.project_id = :project_id AND u.environment_id = :environment_id
      AND EXISTS (
        SELECT 1 FROM flow_analytics_events source_event
        WHERE source_event.project_id = u.project_id
          AND source_event.environment_id = u.environment_id
          AND source_event.user_id_hash = u.user_id_hash
          AND source_event.source_module = :source_module
      )
      AND (
        :source_module = 'paywalls'
        OR NOT EXISTS (
          SELECT 1 FROM flow_analytics_events paywall_event
          WHERE paywall_event.project_id = u.project_id
            AND paywall_event.environment_id = u.environment_id
            AND paywall_event.user_id_hash = u.user_id_hash
            AND paywall_event.source_module = 'paywalls'
        )
      )`,
    alias: "u",
  }),
  ...forSources("states", "flow_user_workflow_states", STATE_COLUMNS, ["project_id", "environment_id", "user_id_hash", "workflow_id"], {
    json: ["active_block_ids_json", "tour_indexes_json"],
    numeric: ["project_id", "generation", "revision"],
    from: "flow_user_workflow_states s JOIN flow_workflows w ON w.id = s.workflow_id",
    selectAlias: "s",
    where: "s.project_id = :project_id AND s.environment_id = :environment_id AND w.origin = :source_module",
  }),
  ...forSources("assignments", "flow_experiment_assignments", ASSIGNMENT_COLUMNS, ["project_id", "environment_id", "workflow_id", "split_block_id", "user_id_hash"], {
    numeric: ["project_id"],
    from: "flow_experiment_assignments a JOIN flow_workflows w ON w.id = a.workflow_id",
    selectAlias: "a",
    where: "a.project_id = :project_id AND a.environment_id = :environment_id AND w.origin = :source_module",
  }),
  ...forSources("audit", "flow_audit_events", AUDIT_COLUMNS, ["id"], {
    json: ["payload_json"],
    numeric: ["project_id"],
    immutable: true,
    where: "a.project_id = :project_id AND a.action = :audit_action",
    alias: "a",
  }),
]);

export const FLOW_CUTOVER_ENTITY_BY_ID = new Map(
  FLOW_CUTOVER_ENTITIES.map((entry) => [entry.id, entry]),
);

export const FLOW_SOURCE_QUERIES = Object.freeze({
  paywalls: Object.freeze([
    source("paywalls", ["id", "project_id", "name", "identifier", "description", "archived_at", "updated_at", "created_at"], ["id"]),
    sourceQuery("paywall_versions", `SELECT v."id", v."paywall_id", COALESCE(v."project_id", p."project_id") AS "project_id", v."version", v."status", v."definition_json", v."schema_version", v."changelog", v."created_by", v."published_at", v."created_at" FROM "paywall_versions" v JOIN "paywalls" p ON p."id" = v."paywall_id" WHERE COALESCE(v."project_id", p."project_id") = :source_project_id ORDER BY v."paywall_id", v."version", v."id"`),
    source("placements", ["id", "project_id", "key", "paywall_id", "active_version_id", "experience_id", "targeting_json", "priority", "active", "created_at", "updated_at"], ["priority DESC", "id"]),
    source("experiences", ["id", "project_id", "paywall_id", "name", "status", "traffic_percent", "starts_at", "ends_at", "created_at", "updated_at"], ["id"]),
    source("variants", ["id", "project_id", "experience_id", "version_id", "key", "weight", "active", "created_at", "updated_at"], ["experience_id", "key", "id"]),
    source("events", ["id", "project_id", "placement", "event_type", "occurred_at", "payload_json", "paywall_id", "version_id", "experience_id", "variant_id", "platform", "customer_id", "session_id", "revenue_micros", "currency"], ["occurred_at", "id"], { pageSize: 1000 }),
  ]),
  onboardings: Object.freeze([
    source("onboardings", ["id", "project_id", "name", "identifier", "display_name", "active_version", "active_version_id", "description", "updated_at", "created_at"], ["id"]),
    sourceQuery("onboarding_versions", `SELECT v."id", v."onboarding_id", COALESCE(v."project_id", o."project_id") AS "project_id", v."version", v."status", v."definition_json", v."published_at", v."created_at" FROM "onboarding_versions" v JOIN "onboardings" o ON o."id" = v."onboarding_id" WHERE COALESCE(v."project_id", o."project_id") = :source_project_id ORDER BY v."onboarding_id", v."version", v."id"`),
    source("placements", ["id", "project_id", "key", "name", "onboarding_id", "active_version_id", "priority", "active", "created_at", "updated_at"], ["priority DESC", "id"]),
    source("targeting_rules", ["id", "project_id", "placement_id", "name", "priority", "conditions_json", "active", "created_at", "updated_at"], ["placement_id", "priority DESC", "id"]),
    source("experiences", ["id", "project_id", "placement_id", "name", "status", "traffic_percentage", "created_at", "updated_at"], ["id"]),
    source("experience_variants", ["id", "project_id", "experience_id", "name", "weight", "version_id", "created_at"], ["experience_id", "id"]),
    source("events", ["id", "project_id", "placement", "event_type", "occurred_at", "payload_json", "platform", "onboarding_id", "version_id", "experience_id", "variant_id", "step_id", "customer_id"], ["occurred_at", "id"], { pageSize: 1000 }),
  ]),
});

export function cutoverRegistrySummary() {
  return FLOW_CUTOVER_ENTITIES.map((entry) => ({
    id: entry.id,
    source_module: entry.sourceModule,
    target_table: entry.table,
    keys: entry.keys,
    immutable: entry.immutable,
    reversible: Boolean(entry.reverse),
  }));
}

function forSources(name, table, columns, keys, options) {
  return ["paywalls", "onboardings"].map((sourceModule) =>
    entity(`${sourceModule}.${name}`, sourceModule, table, columns, keys, options),
  );
}

function entity(id, sourceModule, table, columns, keys, options = {}) {
  const alias = options.selectAlias ?? options.alias;
  const select = columns.map((column) => `${alias ? `${alias}.` : ""}\"${column}\"`).join(", ");
  const from = options.from ?? `${table}${options.alias ? ` ${options.alias}` : ""}`;
  return Object.freeze({
    id,
    sourceModule,
    table,
    columns: Object.freeze([...columns]),
    keys: Object.freeze([...keys]),
    jsonColumns: Object.freeze([...(options.json ?? [])]),
    numericColumns: Object.freeze([...(options.numeric ?? [])]),
    immutable: options.immutable === true,
    allowTargetSuperset: options.allowTargetSuperset === true,
    reverse: options.reverse ?? null,
    pageSize: options.pageSize ?? 1000,
    targetQuery: `SELECT ${select} FROM ${from} WHERE ${options.where} ORDER BY ${keys.map((key) => `${alias ? `${alias}.` : ""}\"${key}\"`).join(", ")}`,
  });
}

function source(table, columns, order, options = {}) {
  return Object.freeze({
    table,
    query: `SELECT ${columns.map((column) => `\"${column}\"`).join(", ")} FROM \"${table}\" WHERE project_id = :source_project_id ORDER BY ${order.join(", ")}`,
    pageSize: options.pageSize ?? null,
  });
}

function sourceQuery(table, query) {
  return Object.freeze({ table, query });
}
