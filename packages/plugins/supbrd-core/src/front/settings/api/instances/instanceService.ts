import type { AxiosResponse } from "axios";

import { config } from "../../../../../../../supbrd-front-ui/src/shared/lib/config.js";
import type {
	Instance,
	GetStartedSetup,
} from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import type {
	DismissGetStartedPayload,
	ExportUsagePayload,
	RevenueCollectionPayload,
} from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import { DELETE, GET, POST, PUT } from "../../transport.js";

// --- Response interfaces ---

export interface InstancesResponse {
	instances: Instance[];
}

export interface CreateInstanceResponse {
	instance: Instance;
}

export interface InstanceMembersResponse {
	members: {
		user: { id: string; name?: string; email: string };
		role: string;
	}[];
}

export interface InstanceDetailsResponse {
	get_started_setup: GetStartedSetup;
}

export interface UserRoleResponse {
	role: string;
}

export interface ExportUsageResponse {
	message: string;
	download_path?: string;
}

export interface SetupProgressStep {
	step_identifier: string;
	completed_at?: string;
}

export interface SetupProgressResponse {
	steps: SetupProgressStep[];
}

export const createInstanceAPICall = async (
	name: string,
	members: { email: string; role: string }[],
): Promise<AxiosResponse<CreateInstanceResponse>> => {
	const data = {
		name: name,
		members: members,
	};

	return POST(config.apiPath + "/instances", data);
};

export const editInstanceAPICall = async (
	instanceId: string,
	name: string,
): Promise<AxiosResponse<InstancesResponse>> => {
	const data = {
		name: name,
	};

	return PUT(config.apiPath + `/instances/${instanceId}`, data);
};

export const getInstancesAPICall = async (): Promise<AxiosResponse<InstancesResponse>> => {
	return GET(config.apiPath + `/instances`);
};

export const getMembersForInstanceAPICall = async (
	instanceId: string,
): Promise<AxiosResponse<InstanceMembersResponse>> => {
	return GET(config.apiPath + `/instances/${instanceId}/members`);
};

export const addMemberToInstanceAPICall = async (
	instanceId: string,
	email: string,
	role: string,
): Promise<AxiosResponse<InstanceMembersResponse>> => {
	const data = {
		email: email,
		role: role,
	};

	return POST(config.apiPath + `/instances/${instanceId}/members`, data);
};

export const removedMemberFromInstanceAPICall = async (
	instanceId: string,
	email: string,
): Promise<AxiosResponse<InstanceMembersResponse>> => {
	return DELETE(
		config.apiPath + `/instances/${instanceId}/members?email=${encodeURIComponent(email)}`,
	);
};

export const deleteInstanceAPICall = async (instanceId: string): Promise<AxiosResponse> => {
	return DELETE(config.apiPath + `/instances/${instanceId}`);
};

export const currentUserRoleForInstanceAPICall = async (
	instanceId: string,
): Promise<AxiosResponse<UserRoleResponse>> => {
	return GET(config.apiPath + `/instances/${instanceId}/role`);
};

export const instanceDetailsAPICall = async (
	instanceId: string,
): Promise<AxiosResponse<InstanceDetailsResponse>> => {
	return GET(config.apiPath + `/instances/${instanceId}`);
};

export const dismissGetStartedAPICall = async (
	instanceId: string,
	data?: DismissGetStartedPayload,
): Promise<AxiosResponse> => {
	return POST(config.apiPath + `/instances/${instanceId}/dismiss_get_started`, data);
};

export const exportUsageApiCall = async (
	instanceId: string,
	data: ExportUsagePayload,
): Promise<AxiosResponse<ExportUsageResponse>> => {
	const response: AxiosResponse<ExportUsageResponse> = await POST(
		config.apiPath + `/instances/${instanceId}/exports/usage`,
		data,
	);
	const path = response.data.download_path;
	if (path) {
		if (!path.startsWith("/api/v1/projects/exports/") || path.includes(".."))
			throw new Error("Invalid export download path");
		const download: AxiosResponse<Blob> = await GET(path, { responseType: "blob" });
		const url = URL.createObjectURL(download.data);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = decodeURIComponent(path.split("/").at(-1) ?? "usage.csv");
		anchor.click();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}
	return response;
};

export const setRevenueCollectionEnabledApiCall = async (
	instanceId: string,
	data: RevenueCollectionPayload,
): Promise<AxiosResponse> => {
	return PUT(config.apiPath + `/instances/${instanceId}/revenue_collection`, data);
};

export const getSetupProgressAPICall = async (
	instanceId: string,
	category: string,
): Promise<AxiosResponse<SetupProgressResponse>> => {
	return GET(
		config.apiPath +
			`/instances/${instanceId}/setup_progress?category=${encodeURIComponent(category)}`,
	);
};

export const completeSetupStepAPICall = async (
	instanceId: string,
	category: string,
	stepIdentifier: string,
): Promise<AxiosResponse<SetupProgressResponse>> => {
	const data = {
		category: category,
		step_identifier: stepIdentifier,
	};

	return POST(config.apiPath + `/instances/${instanceId}/setup_progress/complete`, data);
};
