import type { FlowGraph } from "@superboard/contracts/flows";
import type { FlowContext } from "../d1/helpers";
import { projectId } from "../d1/helpers";
import { requiredString } from "../http/validation";
import { executeGraph } from "../runtime/graph";
import { hashFlowUserId } from "../services/crypto";
import { applyPersistedExperimentAssignments } from "../services/experiments";

type CommerceRelease = {
  workflow_id: string;
  workflow_identifier: string;
  workflow_name: string;
  workflow_version_id: string;
  version: number | null;
  graph_json: string;
  published_at: string | null;
  environment_id: string;
};

/**
 * Project-scoped adapter used by Purchases v2. It returns presentation only;
 * store transactions and proof verification always stay in Products/Billing.
 */
export async function resolveCommercePresentation(
  context: FlowContext,
  body: Record<string, unknown>,
) {
  const placement = requiredString(body.placement ?? "default", "placement", 192);
  const subjectId = requiredString(
    body.customer_id ?? body.subject_id,
    "customer_id",
    512,
  );
  const environmentKey = typeof body.environment === "string" && body.environment.trim()
    ? body.environment.trim()
    : context.get("project").environment;
  const properties = body.user_properties && typeof body.user_properties === "object" &&
      !Array.isArray(body.user_properties)
    ? body.user_properties as Record<string, unknown>
    : {};
  const offeringIdentifier = typeof body.offering_identifier === "string"
    ? body.offering_identifier.trim()
    : "";

  const conditions = [
    "r.project_id = ?",
    "e.key = ?",
    "e.active = 1",
    "r.active = 1",
    "w.status = 'active'",
  ];
  const bindings: unknown[] = [projectId(context), environmentKey];
  const rows = await context.env.DB.prepare(
    `SELECT w.id AS workflow_id, e.id AS environment_id,
      w.identifier AS workflow_identifier, w.name AS workflow_name,
      CASE WHEN r.use_draft = 1
        THEN 'draft:' || CAST(d.revision AS TEXT) ELSE v.id END AS workflow_version_id,
      CASE WHEN r.use_draft = 1 THEN NULL ELSE v.version END AS version,
      CASE WHEN r.use_draft = 1 THEN d.graph_json ELSE v.graph_json END AS graph_json,
      CASE WHEN r.use_draft = 1 THEN d.updated_at ELSE v.published_at END AS published_at
     FROM flow_environment_releases r
     JOIN flow_environments e
       ON e.project_id = r.project_id AND e.id = r.environment_id
     JOIN flow_workflows w
       ON w.project_id = r.project_id AND w.id = r.workflow_id
     LEFT JOIN flow_workflow_drafts d ON d.workflow_id = r.workflow_id
     LEFT JOIN flow_workflow_versions v ON v.id = r.workflow_version_id
     WHERE ${conditions.join(" AND ")}
       AND ((r.use_draft = 1 AND d.graph_json IS NOT NULL)
         OR (r.use_draft = 0 AND v.graph_json IS NOT NULL))
     ORDER BY w.created_at, w.id`,
  ).bind(...bindings).all<CommerceRelease>();

  const userIdHash = await hashFlowUserId(
    context.env,
    context.get("project").projectRef,
    subjectId,
  );
  const parsed = rows.results.map((release) => ({
    workflowId: release.workflow_id,
    graph: JSON.parse(release.graph_json) as FlowGraph,
  }));
  const environmentId = rows.results[0]?.environment_id;
  const assignedGraphs = environmentId
    ? await applyPersistedExperimentAssignments(
        context.env,
        projectId(context),
        environmentId,
        userIdHash,
        subjectId,
        parsed,
      )
    : new Map<string, FlowGraph>();
  const candidates: Array<{
    release: CommerceRelease;
    commerce: ReturnType<typeof executeGraph>["updatedBlocks"][number];
    priority: number;
    order: number;
  }> = [];
  for (const [order, release] of rows.results.entries()) {
    const graph = assignedGraphs.get(release.workflow_id) ??
      (JSON.parse(release.graph_json) as FlowGraph);
    const result = executeGraph({
      graph,
      userProperties: { ...properties, __flow_user_id: userIdHash },
      activeBlockIds: [],
      event: { name: "identify" },
      workflowId: release.workflow_id,
      blockStateId: (blockId) => `${release.workflow_id}:${userIdHash}:${blockId}`,
    });
    const commerce = result.updatedBlocks.find((block) => {
      if (block.componentType !== "superboard-commerce") return false;
      const blockPlacement = typeof block.data.placement === "string"
        ? block.data.placement
        : typeof block.slotId === "string"
          ? block.slotId
          : "default";
      if (blockPlacement !== placement) return false;
      const blockOffering = typeof block.data.offeringIdentifier === "string"
        ? block.data.offeringIdentifier
        : typeof block.data.offering_identifier === "string"
          ? block.data.offering_identifier
          : "";
      return !offeringIdentifier || blockOffering === offeringIdentifier;
    });
    if (!commerce) continue;
    candidates.push({
      release,
      commerce,
      priority: typeof commerce.data.legacy_priority === "number"
        ? commerce.data.legacy_priority
        : 0,
      order,
    });
  }
  candidates.sort(
    (left, right) => right.priority - left.priority || left.order - right.order,
  );
  const selected = candidates[0];
  if (selected) {
    const { release, commerce } = selected;
    return {
      id: release.workflow_id,
      identifier: release.workflow_identifier,
      display_name: release.workflow_name,
      version_id: release.workflow_version_id,
      version: release.version,
      configuration: {
        ...commerce.data,
        schema_version: 1,
        source: "flows",
        workflow_id: release.workflow_id,
        block_id: commerce.id,
        component_type: commerce.componentType,
        component_library_name: commerce.componentLibraryName,
        property_meta: commerce.propertyMeta,
        exit_nodes: commerce.exitNodes,
        slottable: commerce.slottable,
        slot_id: commerce.slotId,
      },
      localizations: {},
      published_at: release.published_at,
    };
  }
  return null;
}
