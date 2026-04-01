import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { ApiError } from "@/lib/ApiError";
import {
  getSubscriptionDetailsAPICall,
  getCurrentMauAPICall,
  getCurrentUsageAPICall,
  getDashboardUrlAPICall,
} from "@/api/payments/paymentsService";
import type { Subscription } from "@/types";

interface SubscriptionResult {
  subscription: Subscription | null;
  isEnterprise: boolean;
}

export function useSubscriptionQuery(instanceId: string | undefined) {
  return useQuery<SubscriptionResult>({
    queryKey: queryKeys.payments.subscription(instanceId!),
    queryFn: async () => {
      try {
        const response = await getSubscriptionDetailsAPICall(instanceId!);
        return {
          subscription: response.data,
          isEnterprise: response.data?.type === "enterprise",
        };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return { subscription: null, isEnterprise: false };
        }
        throw error;
      }
    },
    enabled: !!instanceId,
  });
}

interface MAUResult {
  current_quantity: number;
  total_available: number;
}

export function useMauQuery(instanceId: string | undefined) {
  return useQuery<MAUResult>({
    queryKey: queryKeys.payments.mau(instanceId!),
    queryFn: async () => {
      const response = await getCurrentMauAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId,
  });
}

export function useUsageQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payments.usage(instanceId!),
    queryFn: async () => {
      const response = await getCurrentUsageAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId,
  });
}

export function useDashboardUrlQuery(
  instanceId: string | undefined,
  enabled: boolean = false
) {
  return useQuery({
    queryKey: queryKeys.payments.dashboardUrl(instanceId!),
    queryFn: async () => {
      const response = await getDashboardUrlAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId && enabled,
  });
}
