import type { FlowEditorBlock, FlowGraph } from "@superboard/contracts/flows";
import { selectTrafficVariant } from "../runtime/graph";
import type { Env } from "../types";
import { selectLegacyExperimentVariant } from "./legacy-experiments";

type WorkflowGraph = { workflowId: string; graph: FlowGraph };

export async function applyPersistedExperimentAssignments(
  env: Env,
  projectId: number,
  environmentId: string,
  userIdHash: string,
  subjectId: string,
  workflows: readonly WorkflowGraph[],
): Promise<Map<string, FlowGraph>> {
  const rows = await env.DB.prepare(
    `SELECT workflow_id, split_block_id, variant_key
     FROM flow_experiment_assignments
     WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?`,
  ).bind(projectId, environmentId, userIdHash).all<{
    workflow_id: string;
    split_block_id: string;
    variant_key: string;
  }>();
  const assignments = new Map(
    rows.results.map((row) => [
      assignmentKey(row.workflow_id, row.split_block_id),
      row.variant_key,
    ]),
  );
  const inserts: D1PreparedStatement[] = [];
  for (const workflow of workflows) {
    for (const block of workflow.graph.blocks) {
      if (block.type !== "traffic-split") continue;
      const key = assignmentKey(workflow.workflowId, block.id);
      if (validVariant(block, assignments.get(key))) continue;
      const selected = await selectLegacyExperimentVariant(block, subjectId) ??
        selectTrafficVariant(userIdHash, block);
      assignments.set(key, selected);
      inserts.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO flow_experiment_assignments
            (project_id, environment_id, workflow_id, split_block_id,
             user_id_hash, variant_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          projectId,
          environmentId,
          workflow.workflowId,
          block.id,
          userIdHash,
          selected,
        ),
      );
    }
  }
  if (inserts.length) await env.DB.batch(inserts);
  return new Map(
    workflows.map((workflow) => [
      workflow.workflowId,
      {
        ...workflow.graph,
        blocks: workflow.graph.blocks.map((block) => {
          if (block.type !== "traffic-split") return block;
          const assignedVariantKey = assignments.get(
            assignmentKey(workflow.workflowId, block.id),
          );
          return assignedVariantKey
            ? { ...block, data: { ...block.data, assignedVariantKey } }
            : block;
        }),
      },
    ]),
  );
}

function validVariant(block: FlowEditorBlock, variant: string | undefined): boolean {
  return Boolean(
    variant && (
      (variant === "holdout" && block.exitNodes.includes("holdout")) ||
      (Array.isArray(block.data.variants) && block.data.variants.some(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          (entry as Record<string, unknown>).key === variant,
      ))
    ),
  );
}

function assignmentKey(workflowId: string, blockId: string): string {
  return `${workflowId}:${blockId}`;
}
