import { GET, POST } from "@/lib/api";
import { config } from "@/lib/config";

export type PlatformServiceStatus = {
  id: string;
  kind?: string;
  workerName?: string | null;
  enabled?: boolean;
  status: "ok" | "degraded" | "unavailable" | "disabled" | "misconfigured";
  description: string;
  responseTimeMs: number | null;
  health?: {
    mode: "self" | "binding" | "public";
    path: string;
    url: string | null;
  };
  capabilities?: string[];
  routes?: string[];
  dependencies?: {
    services: string[];
    stores: string[];
    queues: string[];
    externalWorkers: Array<{ binding: string; workerName: string }>;
  };
  jobTypes?: string[];
  jobs?: Record<string, number> | null;
  detail?: unknown;
  error?: string;
};

export type RuntimeMetricRow = {
  service: string;
  outcome: string;
  eventType: string;
  invocations: number;
  exceptions: number;
  truncated: number;
  averageCpuMs: number | null;
  averageWallMs: number | null;
  maximumCpuMs: number | null;
  maximumWallMs: number | null;
};

export type PlatformStatus = {
  status: "ok" | "degraded";
  environment: string;
  generatedAt: string;
  responseTimeMs: number;
  deployment: {
    target: string;
    release: string;
    publicRouting: "active" | "staged" | "unknown";
  };
  catalog?: {
    schemaVersion: 1;
    status: "ok" | "misconfigured";
    target: string;
    environment: string;
    error?: string;
  };
  endpoints: Record<string, string | null>;
  api: {
    status: "ok" | "degraded";
    description: string;
    capabilities: Array<{
      id: string;
      description: string;
      access: string;
      entrypoints: string[];
    }>;
  };
  publicSurfaces: PlatformPublicSurface[];
  services: PlatformServiceStatus[];
  dataStores: PlatformDataStore[];
  custom: PlatformCustomOverview;
  metrics: Record<string, number | null>;
  jobs: Record<string, Record<string, number> | null>;
  runtime: {
    status: "ok" | "misconfigured" | "unavailable";
    environment: string;
    dataset: string;
    windowMinutes: number;
    generatedAt: string;
    rows: RuntimeMetricRow[];
    error?: string;
  } | null;
};

export type PlatformPublicSurface = {
  id: string;
  url: string | null;
  status: "ok" | "degraded" | "unavailable" | "misconfigured";
  description: string;
  responseTimeMs: number | null;
  httpStatus: number | null;
  error?: string;
};

export type PlatformDataStore = {
  id: string;
  kind: "D1" | "KV" | "R2" | "Durable Object";
  owner: string;
  status:
    | "ok"
    | "configured"
    | "declared"
    | "degraded"
    | "unavailable"
    | "disabled"
    | "misconfigured";
  description: string;
  schema?: {
    status: "current" | "behind" | "drifted";
    expectedMigration: string;
    latestMigration: string | null;
    appliedMigrationCount: number;
  } | null;
};

export type PlatformCustomManifest = {
  protocolVersion: number;
  appKey: string;
  service: string;
  version: string;
  description: string;
  capabilities: Array<{
    id: string;
    description: string;
    mode: "request" | "queue" | "scheduled";
  }>;
};

export type PlatformCustomStats = {
  status: "ok" | "degraded";
  generatedAt: string;
  users?: { total: number; premium: number; anonymous: number };
  jobs: Record<string, number>;
  capabilities: Record<string, Record<string, number>>;
  cancellations?: {
    jobs: number;
    refundsPending: number;
    refundsApplied: number;
    creditsRefunded: number;
  };
};

export type PlatformCustomOverview = {
  status: "ok" | "disabled" | "misconfigured" | "unavailable" | "incompatible";
  manifest: PlatformCustomManifest | null;
  stats: PlatformCustomStats | null;
  error?: string;
};

export type PlatformCustomJob = {
  id: string;
  capability: string;
  status:
    | "accepted"
    | "queued"
    | "dispatched"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "rejected";
  entityId?: string;
  progress?: number;
  attempts?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  error?: string | null;
  result?: Record<string, unknown>;
};

export type PlatformCustomJobPage = {
  jobs: PlatformCustomJob[];
  nextCursor: string | null;
};

export type PlatformAccountErasure = {
  id: string;
  projectId: number;
  projectRef: string;
  subjectReference: string;
  status: "processing" | "failed" | "completed";
  completedSteps: string[];
  attempts: number;
  lastErrorCode: string | null;
  lastErrorService: string | null;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PlatformEmailOperation = {
  id: string;
  kind: "transactional" | "marketing" | "test";
  projectId: number | null;
  templateKey: string | null;
  subject: string;
  status: "captured" | "queued" | "sending" | "sent" | "failed";
  transport: "capture" | "smtp";
  recipientCount: number;
  failedRecipients: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type PlatformEmailDeadLetter = {
  id: string;
  queueMessageId: string;
  emailMessageId: string | null;
  sourceQueue: string;
  jobType: string | null;
  replayable: boolean;
  attempts: number;
  status: "quarantined" | "discarded";
  resolution: "replayed" | "discarded" | null;
  receivedAt: string;
  resolvedAt: string | null;
};

export type PlatformEmailTransportOperation = {
  id: string;
  source: string;
  projectId: number;
  referenceId: string;
  profileId: string;
  status: "sending" | "sent" | "failed" | "outcome_unknown";
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export type PlatformEmailOperations = {
  generatedAt: string;
  queue: {
    backlogCount: number;
    backlogBytes: number;
    oldestMessageAt: string | null;
  } | null;
  messages: PlatformEmailOperation[];
  transportDeliveries: PlatformEmailTransportOperation[];
  deadLetters: PlatformEmailDeadLetter[];
};

export type PlatformLibrary = {
  id: string;
  displayName: string;
  ecosystem: string;
  packageName: string;
  sourcePath: string;
  license: "MIT";
  licensePath: string;
  versionSource: string;
  sourceVersion: string;
  latestReleaseVersion: string;
  releaseRef: string;
  releaseStatus: "released" | "pending-release";
  surfaceManifest?: string;
  notes?: string;
  install: string;
  distribution?: {
    registryKind: "github-packages-npm" | "github-packages-maven";
    registry: string;
    publicMetadata: boolean;
    anonymousInstallable: boolean;
    authentication: {
      required: boolean;
      tokenEnvironmentVariable: string;
      usernameEnvironmentVariable?: string;
    };
  };
};

export type PlatformLibraryCatalog = {
  schemaVersion: number;
  repository: string;
  developmentBranch: string;
  releasePolicy: "immutable-tag";
  libraries: PlatformLibrary[];
  customCode: {
    schemaVersion: number;
    owner: string;
    policy: string;
    sourceFiles: Record<string, string[]>;
    widgets: string[];
    actions: Record<string, string[]>;
    streams: Record<string, string[]>;
    referenceAdapters: Record<string, string[]>;
  };
  flutterFlowLibrary: PlatformFlutterFlowLibrary;
};

export type PlatformFlutterFlowLibrary = {
  schemaVersion: number;
  owner: "opengrow-platform";
  displayName: string;
  source: {
    path: string;
    testPath: string;
    workflow: string;
  };
  remoteProject: {
    projectIdVariable: string;
    apiKeySecret: string;
    githubEnvironment: string;
  };
  releasePolicy: "immutable-tag-only";
  dependencies: Array<{
    catalogId: string;
    packageName: string;
    sourceVersion: string;
    requiredRef: string;
  }>;
  libraryValues: Array<{
    name: string;
    type: "string" | "boolean" | "integer";
    required: boolean;
    defaultValue?: string | boolean | number;
  }>;
  actions: Record<string, string[]>;
  forbiddenAppState: string[];
};

export async function getPlatformStatus(): Promise<PlatformStatus> {
  const response = await GET(`${config.apiPath}/platform/status`, {
    timeout: 10_000,
    maxRetries: 1,
  });
  return response.data as PlatformStatus;
}

export async function getPlatformCustomJobs(
  query = "limit=50"
): Promise<PlatformCustomJobPage> {
  const response = await GET(
    `${config.apiPath}/platform/custom/jobs?${query}`,
    {
      timeout: 10_000,
      maxRetries: 1,
    }
  );
  return response.data as PlatformCustomJobPage;
}

export async function getPlatformAccountErasures(
  query = "limit=50"
): Promise<PlatformAccountErasure[]> {
  const response = await GET(
    `${config.apiPath}/platform/account-erasures?${query}`,
    {
      timeout: 10_000,
      maxRetries: 1,
    }
  );
  const body = response.data as
    | { data: PlatformAccountErasure[] }
    | PlatformAccountErasure[];
  return Array.isArray(body) ? body : body.data;
}

export async function getPlatformEmailOperations(
  query = "limit=50"
): Promise<PlatformEmailOperations> {
  const response = await GET(
    `${config.apiPath}/platform/email/operations?${query}`,
    { timeout: 10_000, maxRetries: 1 }
  );
  return response.data as PlatformEmailOperations;
}

export async function replayPlatformEmailDeadLetter(
  deadLetterId: string
): Promise<{ id: string; status: "replayed"; messageId: string }> {
  const response = await POST(
    `${config.apiPath}/platform/email/dead-letters/${encodeURIComponent(deadLetterId)}/replay`,
    {},
    { retry: false, timeout: 15_000 }
  );
  return response.data as {
    id: string;
    status: "replayed";
    messageId: string;
  };
}

export async function discardPlatformEmailDeadLetter(
  deadLetterId: string
): Promise<{ id: string; status: "discarded" }> {
  const response = await POST(
    `${config.apiPath}/platform/email/dead-letters/${encodeURIComponent(deadLetterId)}/discard`,
    {},
    { retry: false, timeout: 15_000 }
  );
  return response.data as { id: string; status: "discarded" };
}

export async function retryPlatformCustomJob(
  jobId: string
): Promise<PlatformCustomJob> {
  const response = await POST(
    `${config.apiPath}/platform/custom/jobs/${encodeURIComponent(jobId)}/retry`,
    {},
    { retry: false, timeout: 15_000 }
  );
  return response.data as PlatformCustomJob;
}

export async function getPlatformLibraries(): Promise<PlatformLibraryCatalog> {
  const response = await GET(`${config.apiPath}/platform/libraries`, {
    timeout: 10_000,
    maxRetries: 1,
  });
  const body = response.data as
    | PlatformLibraryCatalog
    | { data: PlatformLibraryCatalog };
  return "data" in body ? body.data : body;
}
