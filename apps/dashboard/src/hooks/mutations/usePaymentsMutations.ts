import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trackEvent, EVENTS } from "@/analytics";
import {
  createSubscriptionAPICall,
  cancelSubscriptionAPICall,
} from "@/api/payments/paymentsService";

export function useCreateSubscriptionMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!instanceId) return Promise.reject(new Error("No instance selected"));
      return createSubscriptionAPICall(instanceId);
    },
    onSuccess: () => {
      trackEvent(EVENTS.PURCHASE, { instanceId });
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.payments.subscription(instanceId),
        });
      }
    },
  });
}

export function useCancelSubscriptionMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!instanceId) return Promise.reject(new Error("No instance selected"));
      return cancelSubscriptionAPICall(instanceId);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.payments.subscription(instanceId),
        });
      }
    },
  });
}
