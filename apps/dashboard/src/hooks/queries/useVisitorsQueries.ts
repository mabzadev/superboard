import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getVisitorsAPICall,
  getAgregatedVisitorsAPICall,
  getVisitorDetailsAPICall,
} from "@/api/visitors/visitorsService";
import type { Visitor, AggregatedVisitor, GetVisitorsParams } from "@/types";

interface VisitorsResult {
  visitors: Visitor[];
  totalPages: number;
  totalEntries: number;
}

interface AggregatedVisitorsResult {
  visitors: AggregatedVisitor[];
  totalPages: number;
  totalEntries: number;
}

export function useVisitorsQuery(
  projectId: string | undefined,
  params: GetVisitorsParams | null
) {
  return useQuery<VisitorsResult>({
    queryKey: queryKeys.projects.visitors(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getVisitorsAPICall(projectId!, params!);
      return {
        visitors: response.data.visitors,
        totalPages: response.data.meta.total_pages,
        totalEntries: response.data.meta.total_entries,
      };
    },
    enabled: !!projectId && !!params,
  });
}

export function useAggregatedVisitorsQuery(
  projectId: string | undefined,
  params: GetVisitorsParams | null
) {
  return useQuery<AggregatedVisitorsResult>({
    queryKey: queryKeys.projects.aggregatedVisitors(
      projectId!,
      params ?? undefined
    ),
    queryFn: async () => {
      const response = await getAgregatedVisitorsAPICall(projectId!, params!);
      return {
        visitors: response.data.visitors,
        totalPages: response.data.meta.total_pages,
        totalEntries: response.data.meta.total_entries,
      };
    },
    enabled: !!projectId && !!params,
  });
}

export function useVisitorDetailsQuery(
  projectId: string | undefined,
  visitorId: string | undefined
) {
  return useQuery({
    queryKey: queryKeys.projects.visitorDetails(projectId!, visitorId!),
    queryFn: async () => {
      const response = await getVisitorDetailsAPICall(projectId!, visitorId!);
      return response.data;
    },
    enabled: !!projectId && !!visitorId,
  });
}
