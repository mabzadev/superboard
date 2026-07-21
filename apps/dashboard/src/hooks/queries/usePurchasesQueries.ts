import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getProjectPurchasesAPICall,
  getRevenueMetricsAPICall,
} from "@/api/purchases/purchasesService";
import type { Purchase, RevenueMetric, GetRevenueParams } from "@/types";

interface PurchasesResult {
  data: Purchase[];
  totalPages: number;
}

interface RevenueMetricsResult {
  data: RevenueMetric[];
  totalPages: number;
  totalEntries: number;
}

export function useProjectPurchasesQuery(
  projectId: string | undefined,
  params: GetRevenueParams | null
) {
  return useQuery<PurchasesResult>({
    queryKey: queryKeys.projects.purchases(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getProjectPurchasesAPICall(projectId!, params!);
      return {
        data: response.data.data,
        totalPages: response.data.total_pages,
      };
    },
    enabled: !!projectId && !!params,
  });
}

export function useRevenueMetricsQuery(
  projectId: string | undefined,
  params: GetRevenueParams | null
) {
  return useQuery<RevenueMetricsResult>({
    queryKey: queryKeys.projects.revenueMetrics(
      projectId!,
      params ?? undefined
    ),
    queryFn: async () => {
      const response = await getRevenueMetricsAPICall(projectId!, params!);
      return {
        data: response.data.data,
        totalPages: response.data.total_pages,
        totalEntries:
          response.data.total_entries ??
          response.data.total_pages * (params!.per_page ?? 10),
      };
    },
    enabled: !!projectId && !!params,
  });
}
