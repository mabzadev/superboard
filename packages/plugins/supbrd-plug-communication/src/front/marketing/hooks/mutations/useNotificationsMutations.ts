import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type { CreateNotificationApiPayload } from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	createNotificationsAPICall,
	archiveNotificationsAPICall,
} from "../../api/notifications/notificationService.js";

export function useCreateNotificationMutation(projectId: string | undefined) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: CreateNotificationApiPayload) => createNotificationsAPICall(data),
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
