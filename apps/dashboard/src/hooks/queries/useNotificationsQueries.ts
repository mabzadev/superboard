import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { getNotificationsAPICall } from "@/api/notifications/notificationService";
import type { Notification, GetMessagingParams } from "@/types";

interface NotificationsResult {
  data: Notification[];
  totalPages: number;
  totalEntries: number;
}

export function useNotificationsQuery(
  projectId: string | undefined,
  params: GetMessagingParams | null
) {
  return useQuery<NotificationsResult>({
    queryKey: queryKeys.projects.notifications(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getNotificationsAPICall(projectId!, params!);
      return {
        data: response.data.data,
        totalPages: response.data.total_pages,
        totalEntries: response.data.total_entries,
      };
    },
    enabled: !!projectId && !!params,
  });
}
