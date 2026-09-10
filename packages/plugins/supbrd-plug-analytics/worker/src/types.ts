import type {
  AnalyticsEventV1,
  AnalyticsQueueMessageV1,
  ProjectContext,
} from "@superboard/contracts";

export type Env = Cloudflare.Env;
export type { AnalyticsEventV1, AnalyticsQueueMessageV1, ProjectContext };

export type IdentityKind =
  | "app_instance"
  | "session"
  | "anonymous"
  | "user";

export type StoredAnalyticsEventV1 = {
  event: AnalyticsEventV1;
  identity_hashes: Partial<Record<IdentityKind, string[]>>;
};

export type AnalyticsOperationType =
  | "export"
  | "replay"
  | "rebuild_rollups"
  | "erase_subject";

export type AnalyticsOperationPayload = {
  jobId: string;
  projectId: string;
};

export type EventReceipt = {
  project_id: string;
  event_id: string;
  payload_sha256: string;
  status: "queued" | "projected" | "dead_letter";
  archive_key: string | null;
};

export type OutboxRow = {
  id: string;
  project_id: string;
  project_ref: string;
  instance_id: number;
  environment: "production" | "test";
  event_id: string;
  payload_json: string;
  status: "pending" | "dispatched" | "processing" | "completed" | "dead_letter";
  attempt_count: number;
};
