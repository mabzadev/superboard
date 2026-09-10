import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type {
	Notification,
	GetMessagingParams,
} from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import { getNotificationsAPICall } from "../../api/notifications/notificationService.js";

interface NotificationsResult {
	data: Notification[];
	totalPages: number;
	totalEntries: number;
}

export function useNotificationsQuery(
	projectId: string | undefined,
	params: GetMessagingParams | null,
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
