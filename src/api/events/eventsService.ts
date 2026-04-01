import type { AxiosResponse } from "axios";
import { GET, POST } from "@/lib/api";
import { config } from "@/lib/config";
import type { AppEvent, DateRangeQuery } from "@/types";
import type {
  EventsSearchPayload,
  DownloadCSVPayload,
  EventsSortedPayload,
} from "@/types";

// --- Response types ---

interface EventsSearchResponse {
  events: AppEvent[];
  meta?: {
    total_pages: number;
    total_entries: number;
  };
}

interface DownloadCSVResponse {
  url?: string;
}

interface AddEventResponse {
  event: AppEvent;
}

interface EventsSortedResponse {
  events: AppEvent[];
}

interface MetricValuesForEventsResponse {
  metrics_values: Record<string, number>;
}

interface EventsOverviewResponse {
  events: AppEvent[];
}

interface EventsPaymentScreenResponse {
  metrics_values: Record<string, number>;
}

// --- API calls ---

export const getEventsForSearchParamsAPICall = async (
  projectId: string,
  data: EventsSearchPayload
): Promise<AxiosResponse<EventsSearchResponse>> => {
  return POST(config.apiPath + `/projects/${projectId}/events/search`, data);
};

export const downloadLinksAsCSVAPICall = async (
  projectId: string,
  data: DownloadCSVPayload
): Promise<AxiosResponse<DownloadCSVResponse>> => {
  return POST(config.apiPath + `/projects/${projectId}/exports/links`, data);
};

export const addEventAPICall = async (
  event: string,
  created_at: string,
  link_id: string,
  engagement_time: number,
  app_version: string,
  platform: string,
  build: string,
  project_id: string
): Promise<AxiosResponse<AddEventResponse>> => {
  const data = {
    event: event,
    created_at: created_at,
    link_id: link_id,
    engagement_time: engagement_time,
    app_version: app_version,
    platform: platform,
    build: build,
    project_id: project_id,
  };

  return POST(config.apiPath + `/projects/add_event`, data);
};

export const getEventsSortedByParamsAPICall = async (
  project_id: string,
  data: EventsSortedPayload
): Promise<AxiosResponse<EventsSortedResponse>> => {
  return POST(config.apiPath + `/projects/${project_id}/events/sorted`, data);
};

export const getMetricsValuesForEventsAPICall = async (
  project_id: string
): Promise<AxiosResponse<MetricValuesForEventsResponse>> => {
  return GET(config.apiPath + `/projects/${project_id}/events/metric_values`);
};

export const getEventsForOverviewAPICall = async (
  project_id: string,
  data: DateRangeQuery
): Promise<AxiosResponse<EventsOverviewResponse>> => {
  return POST(config.apiPath + `/projects/${project_id}/events/overview`, data);
};

export const getEventsForPaymentScreenAPICall = async (
  project_id: string,
  data: DateRangeQuery
): Promise<AxiosResponse<EventsPaymentScreenResponse>> => {
  return POST(config.apiPath + `/instances/${project_id}/events/billing`, data);
};
