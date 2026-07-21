import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  createNotificationsAPICall,
  archiveNotificationsAPICall,
} from "@/api/notifications/notificationService";
import type { CreateNotificationApiPayload } from "@/types";

export function useCreateNotificationMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateNotificationApiPayload) =>
      createNotificationsAPICall(data),
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(projectId),
        });
      }
    },
  });
}

export function useArchiveNotificationMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return archiveNotificationsAPICall(projectId, notificationId);
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.detail(projectId),
        });
      }
    },
  });
}
