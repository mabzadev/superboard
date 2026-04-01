import { GET, POST } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type {
  Visitor,
  AggregatedVisitor,
  VisitorDetailMetrics,
  AggregatedVisitorMetrics,
  GetVisitorsParams,
} from "@/types";

// --- Response types ---

interface PaginationMeta {
  total_pages: number;
  total_entries: number;
}

interface GetVisitorsResponse {
  visitors: Visitor[];
  meta: PaginationMeta;
}

interface GetAggregatedVisitorsResponse {
  visitors: AggregatedVisitor[];
  meta: PaginationMeta;
}

interface GetVisitorDetailsResponse {
  visitor: Visitor;
  metrics: VisitorDetailMetrics;
  aggregated_metrics: AggregatedVisitorMetrics | null;
  number_of_generated_links: number;
}

// --- API calls ---

export const getVisitorsAPICall = async (
  project_id: string,
  data: GetVisitorsParams
): Promise<AxiosResponse<GetVisitorsResponse>> => {
  return POST(config.apiPath + `/projects/${project_id}/visitors/search`, data);
};

export const getAgregatedVisitorsAPICall = async (
  project_id: string,
  data: GetVisitorsParams
): Promise<AxiosResponse<GetAggregatedVisitorsResponse>> => {
  return POST(
    config.apiPath + `/projects/${project_id}/visitors/aggregated`,
    data
  );
};

export const getVisitorDetailsAPICall = async (
  project_id: string,
  visitor_id: string
): Promise<AxiosResponse<GetVisitorDetailsResponse>> => {
  return GET(config.apiPath + `/projects/${project_id}/visitors/${visitor_id}`);
};
