import { DELETE, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

const path = (projectRef: string, resource: string) =>
  `${config.apiPath}/analytics/projects/${projectRef}${resource}`;

const data = <T>(response: { data: T | { data: T } }): T =>
  response.data && typeof response.data === "object" && "data" in response.data
    ? (response.data as { data: T }).data
    : (response.data as T);

export type AnalyticsRange = {
  from: string;
  to: string;
  application_id?: string;
};

export type AnalyticsOverview = {
  range: { from: string; to: string };
  application_id: string | null;
  events: number;
  unique_subjects: number;
  sessions: number;
  average_session_duration_seconds: number;
  installations: number;
  purchase_events: number;
  successful_purchases: number;
  net_revenue_micros: number | null;
  net_revenue_currency: string | null;
  net_revenue_by_currency: Array<{
    currency: string;
    net_revenue_micros: number;
  }>;
  series: Array<{ date: string; events: number }>;
};

export type AnalyticsEvent = {
  event_id: string;
  event_name: string;
  source: string;
  application_id: string;
  app_instance_id_hash?: string | null;
  session_id_hash?: string | null;
  anonymous_id_hash?: string | null;
  user_id_hash?: string | null;
  properties: Record<string, unknown>;
  context: Record<string, unknown>;
  occurred_at: string;
  archived: boolean;
};

export type AnalyticsInstallation = {
  id: string;
  application_id: string;
  app_instance_id_hash: string;
  source_event_id: string;
  installed_at: string;
  platform?: string | null;
  app_version?: string | null;
  attribution_id?: string | null;
};

export type AnalyticsPurchase = {
  id: string;
  application_id: string;
  source_event_id: string;
  billing_transaction_id?: string | null;
  store: string;
  environment: string;
  store_transaction_id: string;
  event_type: string;
  product_id?: string | null;
  amount_micros?: number | null;
  currency?: string | null;
  occurred_at: string;
};

export type FunnelResult = {
  range: { from: string; to: string };
  steps: Array<{
    event_name: string;
    subjects: number;
    conversion_from_first: number;
    conversion_from_previous: number;
  }>;
};

export type RetentionResult = {
  range: { from: string; to: string };
  cohorts: Array<{
    cohort_date: string;
    size: number;
    days: Array<{ day: number; subjects: number; rate: number }>;
  }>;
};

export type SavedAnalyticsReport = {
  id: string;
  report_type:
    | "dashboard"
    | "funnel"
    | "cohort"
    | "retention"
    | "query"
    | "alert";
  name: string;
  description?: string | null;
  definition: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AnalyticsOperation = {
  id: string;
  operation_type: "export" | "replay" | "rebuild_rollups" | "erase_subject";
  status: "queued" | "running" | "completed" | "failed";
  input: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

function query(
  filters: Partial<AnalyticsRange> & Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params.size ? `?${params.toString()}` : "";
}

export async function getAnalyticsOverview(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<AnalyticsOverview>(
    await GET(path(projectRef, `/overview${query(filters)}`))
  );
}

export async function getAnalyticsEvents(
  projectRef: string,
  filters: AnalyticsRange & {
    event_name?: string;
    cursor?: string;
    limit?: string;
  }
) {
  return data<{ items: AnalyticsEvent[]; next_cursor: string | null }>(
    await GET(path(projectRef, `/events${query(filters)}`))
  );
}

export async function getAnalyticsInstallations(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<{ items: AnalyticsInstallation[] }>(
    await GET(path(projectRef, `/installations${query(filters)}`))
  );
}

export async function getAnalyticsPurchases(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<{ items: AnalyticsPurchase[] }>(
    await GET(path(projectRef, `/purchases${query(filters)}`))
  );
}

export async function getAnalyticsEventDefinitions(projectRef: string) {
  return data<{
    items: Array<{
      event_name: string;
      event_source: string;
      event_count: number;
      first_seen_at: string;
      last_seen_at: string;
    }>;
  }>(await GET(path(projectRef, "/event-definitions")));
}

export async function queryAnalyticsFunnel(
  projectRef: string,
  payload: {
    steps: string[];
    from: string;
    to: string;
    application_id?: string;
  }
) {
  return data<FunnelResult>(
    await POST(path(projectRef, "/funnels/query"), payload)
  );
}

export async function getAnalyticsRetention(
  projectRef: string,
  filters: AnalyticsRange & { days?: string }
) {
  return data<RetentionResult>(
    await GET(path(projectRef, `/retention${query(filters)}`))
  );
}

export async function getAnalyticsReports(projectRef: string) {
  return data<{ items: SavedAnalyticsReport[] }>(
    await GET(path(projectRef, "/reports"))
  );
}

export async function createAnalyticsReport(
  projectRef: string,
  payload: Omit<SavedAnalyticsReport, "id" | "created_at" | "updated_at">
) {
  return data<SavedAnalyticsReport>(
    await POST(path(projectRef, "/reports"), payload)
  );
}

export async function updateAnalyticsReport(
  projectRef: string,
  id: string,
  payload: Omit<SavedAnalyticsReport, "id" | "created_at" | "updated_at">
) {
  return data<SavedAnalyticsReport>(
    await PUT(path(projectRef, `/reports/${id}`), payload)
  );
}

export async function deleteAnalyticsReport(projectRef: string, id: string) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/reports/${id}`))
  );
}

export async function getAnalyticsOperations(projectRef: string) {
  return data<{ items: AnalyticsOperation[] }>(
    await GET(path(projectRef, "/operations"))
  );
}

export async function createAnalyticsOperation(
  projectRef: string,
  payload: {
    operation_type: AnalyticsOperation["operation_type"];
    input?: Record<string, unknown>;
  }
) {
  return data<AnalyticsOperation>(
    await POST(path(projectRef, "/operations"), payload)
  );
}
