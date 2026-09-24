import { config } from "@superboard/front-ui/lib/config.js";
import type {
	Notification,
	GetMessagingParams,
	CreateNotificationApiPayload,
} from "@superboard/front-ui/types";
import type { AxiosResponse } from "axios";

import { DELETE, POST } from "../../transport.js";

// --- Response interfaces ---

export interface NotificationsListResponse {
	data: Notification[];
	total_pages: number;
	total_entries: number;
}

export const getNotificationsAPICall = async (
	project_id: string,
	data: GetMessagingParams,
): Promise<AxiosResponse<NotificationsListResponse>> => {
	return POST(config.apiPath + `/projects/${project_id}/notifications/search`, data);
};

export const createNotificationsAPICall = async (
	data: CreateNotificationApiPayload,
): Promise<AxiosResponse<Notification>> => {
	return POST(config.apiPath + `/projects/${data.project_id}/notifications`, data);
};

export const archiveNotificationsAPICall = async (
	project_id: string,
	notification_id: string,
): Promise<AxiosResponse> => {
	return DELETE(config.apiPath + `/projects/${project_id}/notifications/${notification_id}`);
};
