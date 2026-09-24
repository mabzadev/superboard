import type {
  FlowUserState,
  FlowWorkflowFrequency,
  FlowWorkflowMigrationStrategy,
} from "@superboard/contracts/flows";

type RuntimeVersionState = {
  workflowVersionId: string | null;
  state: FlowUserState;
};

export type FlowRuntimeMigrationDecision = {
  continueStoredVersion: boolean;
  resetRuntime: boolean;
  endRuntime: boolean;
};

/**
 * Resolves version migration before graph execution. Keeping this pure makes
 * the policy identical for HTTP, Durable Object and replayed commands.
 */
export function resolveRuntimeMigration(
  previous: RuntimeVersionState | null,
  requestedVersionId: string,
  strategy: FlowWorkflowMigrationStrategy,
  frequency: FlowWorkflowFrequency,
  eventName: string,
): FlowRuntimeMigrationDecision {
  if (!previous || eventName === "reset-progress") {
    return {
      continueStoredVersion: false,
      resetRuntime: eventName === "reset-progress",
      endRuntime: false,
    };
  }

  const versionChanged = previous.workflowVersionId !== requestedVersionId;
  if (versionChanged) {
    if (strategy === "restart-all") {
      return { continueStoredVersion: false, resetRuntime: true, endRuntime: false };
    }
    if (strategy === "restart-current" && previous.state === "in-progress") {
      return { continueStoredVersion: false, resetRuntime: true, endRuntime: false };
    }
    if (strategy === "finish-current" && previous.state === "in-progress") {
      return { continueStoredVersion: false, resetRuntime: false, endRuntime: true };
    }
  }

  const repeatableCycle =
    frequency === "every-time" &&
    (previous.state === "completed" || previous.state === "stopped") &&
    (eventName === "identify" || eventName === "workflow-start" || eventName === "enter");
  return {
    continueStoredVersion: false,
    resetRuntime: repeatableCycle,
    endRuntime: false,
  };
}
