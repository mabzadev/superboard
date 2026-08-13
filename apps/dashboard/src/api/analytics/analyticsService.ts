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

export type AnalyticsEventAnalysis = {
  event_name: string;
  from: string;
  to: string;
  totals: {
    events: number;
    users: number;
    sum: number;
    average_duration_seconds: number | null;
  };
  series: Array<{ date: string; events: number; users: number }>;
  properties: string[];
  segmentation: {
    property: string;
    items: Array<{ value: string; events: number; users: number }>;
  } | null;
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

export type AnalyticsApplication = {
  application_id: string;
  name: string;
  platform?: string | null;
  timezone: string;
  active: boolean;
  first_seen_at: string;
  last_seen_at: string;
  settings: Record<string, unknown>;
};

export type AnalyticsDashboardWidget = {
  id: string;
  dashboard_id: string;
  widget_type:
    | "metric"
    | "timeseries"
    | "event"
    | "funnel"
    | "retention"
    | "table"
    | "map"
    | "crashes"
    | "views"
    | "purchases"
    | "installations";
  title: string;
  definition: Record<string, unknown>;
  position: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AnalyticsDashboard = {
  id: string;
  name: string;
  description?: string | null;
  visibility: "private" | "project";
  layout: Record<string, unknown>;
  widget_count: number;
  widgets?: AnalyticsDashboardWidget[];
  created_at: string;
  updated_at: string;
};

export type AnalyticsSession = {
  id: string;
  application_id: string;
  session_id_hash: string;
  profile_id?: string | null;
  started_at: string;
  ended_at: string;
  event_count: number;
  duration_seconds: number;
  platform?: string | null;
  app_version?: string | null;
};

export type AnalyticsProfile = {
  id: string;
  application_id: string;
  canonical_subject_hash: string;
  properties: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
};

export type AnalyticsView = {
  view_name: string;
  view_url?: string | null;
  views: number;
  sessions: number;
  average_duration_seconds: number;
  last_seen_at: string;
};

export type AnalyticsDimensionValue = {
  value: string;
  events: number;
  users: number;
};

export type AnalyticsCrash = {
  application_id: string;
  fingerprint: string;
  title: string;
  fatal: boolean;
  resolved: boolean;
  occurrence_count: number;
  affected_profiles: number;
  first_seen_at: string;
  last_seen_at: string;
  last_app_version?: string | null;
  last_platform?: string | null;
  assignee?: string | null;
  notes?: string | null;
  occurrences?: Array<{
    id: string;
    message?: string | null;
    stack?: string | null;
    app_version?: string | null;
    platform?: string | null;
    occurred_at: string;
  }>;
};

export type AnalyticsFeedback = {
  id: string;
  application_id: string;
  rating?: number | null;
  comment?: string | null;
  widget_id?: string | null;
  occurred_at: string;
};

export type AnalyticsCohort = {
  id: string;
  name: string;
  description?: string | null;
  definition: Record<string, unknown>;
  estimated_size: number;
  last_evaluated_at?: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type AnalyticsRemoteConfig = {
  id: string;
  config_key: string;
  environment: "production" | "test";
  value: unknown;
  conditions: unknown[];
  enabled: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type AnalyticsAlert = {
  id: string;
  name: string;
  alert_type:
    | "metric_threshold"
    | "crash_spike"
    | "no_data"
    | "purchase_drop"
    | "installation_drop"
    | "custom";
  definition: Record<string, unknown>;
  channels: unknown[];
  enabled: boolean;
  cooldown_minutes: number;
  last_evaluated_at?: string | null;
  last_triggered_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalyticsAlertIncident = {
  id: string;
  alert_id: string;
  status: "open" | "acknowledged" | "resolved";
  summary: string;
  value: Record<string, unknown>;
  notification_status: "pending" | "sent" | "partial" | "failed";
  notifications: unknown[];
  triggered_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};

export type AnalyticsHook = {
  id: string;
  name: string;
  event_types: string[];
  endpoint_url: string;
  enabled: boolean;
  secret_configured: boolean;
  last_delivery_at?: string | null;
  last_delivery_status?: string | null;
  created_at: string;
  updated_at: string;
};

export type AnalyticsAnnotation = {
  id: string;
  title: string;
  description?: string | null;
  annotation_at: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export type AnalyticsSettings = {
  hot_retention_days: number;
  timezone: string;
  data_collection_enabled: boolean;
  updated_at?: string | null;
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

export async function getAnalyticsEventAnalysis(
  projectRef: string,
  filters: AnalyticsRange & { event_name: string; property?: string }
) {
  return data<AnalyticsEventAnalysis>(
    await GET(path(projectRef, `/events/analyze${query(filters)}`))
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

export async function getAnalyticsApplications(projectRef: string) {
  return data<{ items: AnalyticsApplication[] }>(
    await GET(path(projectRef, "/applications"))
  );
}

export async function updateAnalyticsApplication(
  projectRef: string,
  applicationId: string,
  payload: Partial<
    Pick<AnalyticsApplication, "name" | "timezone" | "active" | "settings">
  >
) {
  return data<AnalyticsApplication>(
    await PUT(path(projectRef, `/applications/${applicationId}`), payload)
  );
}

export async function getAnalyticsDashboards(projectRef: string) {
  return data<{ items: AnalyticsDashboard[] }>(
    await GET(path(projectRef, "/dashboards"))
  );
}

export async function getAnalyticsDashboard(projectRef: string, id: string) {
  return data<AnalyticsDashboard>(
    await GET(path(projectRef, `/dashboards/${id}`))
  );
}

export async function createAnalyticsDashboard(
  projectRef: string,
  payload: Pick<AnalyticsDashboard, "name" | "visibility"> & {
    description?: string;
    layout?: Record<string, unknown>;
  }
) {
  return data<AnalyticsDashboard>(
    await POST(path(projectRef, "/dashboards"), payload)
  );
}

export async function updateAnalyticsDashboard(
  projectRef: string,
  id: string,
  payload: Partial<
    Pick<AnalyticsDashboard, "name" | "description" | "visibility" | "layout">
  >
) {
  return data<AnalyticsDashboard>(
    await PUT(path(projectRef, `/dashboards/${id}`), payload)
  );
}

export async function deleteAnalyticsDashboard(projectRef: string, id: string) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/dashboards/${id}`))
  );
}

export async function createAnalyticsDashboardWidget(
  projectRef: string,
  dashboardId: string,
  payload: Pick<AnalyticsDashboardWidget, "widget_type" | "title"> & {
    definition: Record<string, unknown>;
    position?: Record<string, unknown>;
  }
) {
  return data<AnalyticsDashboardWidget>(
    await POST(path(projectRef, `/dashboards/${dashboardId}/widgets`), payload)
  );
}

export async function deleteAnalyticsDashboardWidget(
  projectRef: string,
  dashboardId: string,
  widgetId: string
) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(
      path(projectRef, `/dashboards/${dashboardId}/widgets/${widgetId}`)
    )
  );
}

export async function getAnalyticsSessions(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<{ items: AnalyticsSession[] }>(
    await GET(path(projectRef, `/sessions${query(filters)}`))
  );
}

export async function getAnalyticsProfiles(projectRef: string) {
  return data<{ items: AnalyticsProfile[] }>(
    await GET(path(projectRef, "/profiles"))
  );
}

export async function getAnalyticsViews(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<{ items: AnalyticsView[]; from: string; to: string }>(
    await GET(path(projectRef, `/views${query(filters)}`))
  );
}

export async function getAnalyticsDimensions(
  projectRef: string,
  filters: AnalyticsRange
) {
  return data<{
    dimensions: Record<string, AnalyticsDimensionValue[]>;
    from: string;
    to: string;
  }>(await GET(path(projectRef, `/dimensions${query(filters)}`)));
}

export async function getAnalyticsCrashes(
  projectRef: string,
  filters: { resolved?: string; limit?: string } = {}
) {
  return data<{ items: AnalyticsCrash[] }>(
    await GET(path(projectRef, `/crashes${query(filters)}`))
  );
}

export async function getAnalyticsCrash(
  projectRef: string,
  fingerprint: string
) {
  return data<AnalyticsCrash>(
    await GET(path(projectRef, `/crashes/${encodeURIComponent(fingerprint)}`))
  );
}

export async function updateAnalyticsCrash(
  projectRef: string,
  fingerprint: string,
  payload: {
    resolved?: boolean;
    assignee?: string | null;
    notes?: string | null;
  }
) {
  return data<AnalyticsCrash>(
    await PUT(
      path(projectRef, `/crashes/${encodeURIComponent(fingerprint)}`),
      payload
    )
  );
}

export async function getAnalyticsFeedback(projectRef: string) {
  return data<{
    items: AnalyticsFeedback[];
    summary: {
      responses: number;
      average_rating: number | null;
      positive: number;
      negative: number;
    };
  }>(await GET(path(projectRef, "/feedback")));
}

export async function getAnalyticsCohorts(projectRef: string) {
  return data<{ items: AnalyticsCohort[] }>(
    await GET(path(projectRef, "/cohorts"))
  );
}

export async function createAnalyticsCohort(
  projectRef: string,
  payload: {
    name: string;
    description?: string;
    definition: { event_name: string; days: number };
    enabled?: boolean;
  }
) {
  return data<AnalyticsCohort>(
    await POST(path(projectRef, "/cohorts"), payload)
  );
}

export async function evaluateAnalyticsCohort(projectRef: string, id: string) {
  return data<AnalyticsCohort>(
    await POST(path(projectRef, `/cohorts/${id}/evaluate`), {})
  );
}

export async function deleteAnalyticsCohort(projectRef: string, id: string) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/cohorts/${id}`))
  );
}

export async function getAnalyticsRemoteConfig(projectRef: string) {
  return data<{ items: AnalyticsRemoteConfig[] }>(
    await GET(path(projectRef, "/remote-config"))
  );
}

export async function upsertAnalyticsRemoteConfig(
  projectRef: string,
  key: string,
  payload: {
    environment: "production" | "test";
    value: unknown;
    conditions?: unknown[];
    enabled?: boolean;
  }
) {
  return data<AnalyticsRemoteConfig>(
    await PUT(
      path(projectRef, `/remote-config/${encodeURIComponent(key)}`),
      payload
    )
  );
}

export async function deleteAnalyticsRemoteConfig(
  projectRef: string,
  key: string,
  environment: "production" | "test"
) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(
      path(
        projectRef,
        `/remote-config/${encodeURIComponent(key)}?environment=${environment}`
      )
    )
  );
}

export async function getAnalyticsAlerts(projectRef: string) {
  return data<{ items: AnalyticsAlert[]; incidents: AnalyticsAlertIncident[] }>(
    await GET(path(projectRef, "/alerts"))
  );
}

export async function createAnalyticsAlert(
  projectRef: string,
  payload: {
    name: string;
    alert_type: AnalyticsAlert["alert_type"];
    definition: Record<string, unknown>;
    channels: unknown[];
    enabled?: boolean;
    cooldown_minutes?: number;
  }
) {
  return data<AnalyticsAlert>(await POST(path(projectRef, "/alerts"), payload));
}

export async function updateAnalyticsAlertIncident(
  projectRef: string,
  id: string,
  action: "acknowledge" | "resolve"
) {
  return data<AnalyticsAlertIncident>(
    await POST(path(projectRef, `/alert-incidents/${id}/${action}`), {})
  );
}

export async function deleteAnalyticsAlert(projectRef: string, id: string) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/alerts/${id}`))
  );
}

export async function getAnalyticsHooks(projectRef: string) {
  return data<{ items: AnalyticsHook[] }>(
    await GET(path(projectRef, "/hooks"))
  );
}

export async function createAnalyticsHook(
  projectRef: string,
  payload: {
    name: string;
    event_types: string[];
    endpoint_url: string;
    secret?: string;
    enabled?: boolean;
  }
) {
  return data<AnalyticsHook>(await POST(path(projectRef, "/hooks"), payload));
}

export async function deleteAnalyticsHook(projectRef: string, id: string) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/hooks/${id}`))
  );
}

export async function getAnalyticsAnnotations(projectRef: string) {
  return data<{ items: AnalyticsAnnotation[] }>(
    await GET(path(projectRef, "/annotations"))
  );
}

export async function createAnalyticsAnnotation(
  projectRef: string,
  payload: {
    title: string;
    description?: string;
    annotation_at: string;
    color?: string;
  }
) {
  return data<AnalyticsAnnotation>(
    await POST(path(projectRef, "/annotations"), payload)
  );
}

export async function deleteAnalyticsAnnotation(
  projectRef: string,
  id: string
) {
  return data<{ id: string; deleted: boolean }>(
    await DELETE(path(projectRef, `/annotations/${id}`))
  );
}

export async function getAnalyticsSettings(projectRef: string) {
  return data<AnalyticsSettings>(await GET(path(projectRef, "/settings")));
}

export async function updateAnalyticsSettings(
  projectRef: string,
  payload: Partial<AnalyticsSettings>
) {
  return data<AnalyticsSettings>(
    await PUT(path(projectRef, "/settings"), payload)
  );
}
