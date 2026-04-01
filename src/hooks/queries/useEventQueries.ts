import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getEventsForSearchParamsAPICall,
  getEventsSortedByParamsAPICall,
  getMetricsValuesForEventsAPICall,
  getEventsForOverviewAPICall,
  getEventsForPaymentScreenAPICall,
  downloadLinksAsCSVAPICall,
} from "@/api/events/eventsService";
import type { AppEvent, DateRangeQuery } from "@/types";
import type {
  EventsSearchPayload,
  EventsSortedPayload,
  DownloadCSVPayload,
} from "@/types";

interface EventsSearchResult {
  events: AppEvent[];
  totalPages?: number;
  totalEntries?: number;
}

export function useEventsSearchQuery(
  projectId: string | undefined,
  params: EventsSearchPayload | null
) {
  return useQuery<EventsSearchResult>({
    queryKey: queryKeys.projects.events(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getEventsForSearchParamsAPICall(
        projectId!,
        params!
      );
      return {
        events: response.data.events,
        totalPages: response.data.meta?.total_pages,
        totalEntries: response.data.meta?.total_entries,
      };
    },
    enabled: !!projectId && !!params,
  });
}

export function useEventsSortedQuery(
  projectId: string | undefined,
  params: EventsSortedPayload | null
) {
  return useQuery({
    queryKey: queryKeys.projects.eventsSorted(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getEventsSortedByParamsAPICall(
        projectId!,
        params!
      );
      return response.data.events;
    },
    enabled: !!projectId && !!params,
  });
}

export function useMetricValuesQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.metricValues(projectId!),
    queryFn: async () => {
      const response = await getMetricsValuesForEventsAPICall(projectId!);
      return response.data.metrics_values;
    },
    enabled: !!projectId,
  });
}

export function useEventsOverviewQuery(
  projectId: string | undefined,
  params: DateRangeQuery | null
) {
  return useQuery({
    queryKey: queryKeys.projects.eventsOverview(
      projectId!,
      params ?? undefined
    ),
    queryFn: async () => {
      const response = await getEventsForOverviewAPICall(projectId!, params!);
      return response.data.events;
    },
    enabled: !!projectId && !!params,
  });
}

export function useEventsPaymentQuery(
  projectId: string | undefined,
  params: DateRangeQuery | null
) {
  return useQuery({
    queryKey: queryKeys.projects.eventsPayment(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getEventsForPaymentScreenAPICall(
        projectId!,
        params!
      );
      return response.data.metrics_values;
    },
    enabled: !!projectId && !!params,
  });
}

export async function downloadLinksAsCSV(
  projectId: string,
  data: DownloadCSVPayload
) {
  const response = await downloadLinksAsCSVAPICall(projectId, data);
  return response.data;
}
