import type { FlowQueueEvent } from "@superboard/contracts/flows";

export type Env = Cloudflare.Env & {
  INTERNAL_API_TOKEN: string;
  INTERNAL_API_TOKEN_PREVIOUS?: string;
  FLOW_USER_ENCRYPTION_KEY: string;
  FLOW_USER_ENCRYPTION_KEY_PREVIOUS?: string;
  FLOW_USER_HASH_KEY: string;
};
export type FlowQueueMessage = FlowQueueEvent;

export type FlowRuntimeCommand = {
  event: FlowQueueEvent;
  graph: import("@superboard/contracts/flows").FlowGraph;
  frequency: import("@superboard/contracts/flows").FlowWorkflowFrequency;
  migrationStrategy: import("@superboard/contracts/flows").FlowWorkflowMigrationStrategy;
  userProperties: Record<string, unknown>;
  /** Internal recursion guard; public callers must omit it. */
  resolveTriggers?: boolean;
  /** Internal recursion guard for Launchpad reconciliation. */
  reconcileLaunchpad?: boolean;
};

export type FlowRuntimeSnapshot = {
  workflowId: string;
  workflowVersionId?: string;
  state: import("@superboard/contracts/flows").FlowUserState;
  activeBlockIds: string[];
  tourIndexes?: Record<string, number>;
  exitedBlockIds: string[];
  updatedBlocks: import("@superboard/contracts/flows").FlowSdkBlock[];
  enteredAt?: string;
  exitedAt?: string;
  duplicate: boolean;
};

export type FlowRuntimeResetCommand = {
  eventId: string;
  projectId: number;
  projectRef: string;
  environmentId: string;
  userIdHash: string;
  workflowIds?: string[];
};

export type FlowRuntimeBootstrapCommand = {
  workflowId: string;
  workflowVersionId: string;
  state: import("@superboard/contracts/flows").FlowUserState;
  activeBlockIds: string[];
  tourIndexes?: Record<string, number>;
  graph: import("@superboard/contracts/flows").FlowGraph;
  enteredAt?: string;
  exitedAt?: string;
  updatedAt: string;
  generation: number;
  revision: number;
  userProperties: Record<string, unknown>;
};

export type FlowDelayPayload = {
  id: string;
  runtimeName: string;
  eventId: string;
  delayMs: number;
  workflowId: string;
  workflowVersionId: string;
  blockId: string;
  targetBlockId: string;
  projectId: number;
  projectRef: string;
  environmentId: string;
  userIdHash: string;
};

export type FlowMaintenancePayload = {
  id: string;
  projectId: number;
  operation:
    | "export"
    | "purge"
    | "rebuild-rollups"
    | "migrate-release";
  exportId?: string;
  environmentId?: string;
  workflowId?: string;
  workflowVersionId?: string;
  useDraft?: boolean;
};
