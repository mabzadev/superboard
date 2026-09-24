import { DELETE, PATCH, POST } from "@superboard/front-ui/lib/api.js";
import { config } from "@superboard/front-ui/lib/config.js";
import type { Campaign } from "@superboard/front-ui/types";
import type { CreateCampaignPayload, UpdateCampaignPayload } from "@superboard/front-ui/types";
import type { GetCampaignsParams, DateRangeQuery } from "@superboard/front-ui/types";
import type { AxiosResponse } from "axios";

// --- Response types ---

interface CreateCampaignResponse {
	campaign: Campaign;
}

interface GetCampaignsResponse {
	data: Campaign[];
	total_pages: number;
	total_entries: number;
}

interface CampaignMetricsResponse {
	metrics: Record<string, unknown>;
}

// --- API calls ---

export const createNewCampaignAPICall = async (
	projectId: string,
	formData: CreateCampaignPayload,
): Promise<AxiosResponse<CreateCampaignResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/campaigns`, formData);
};

export const updateCampaignAPICall = async (
	projectId: string,
	campaignId: string,
	formData: UpdateCampaignPayload,
): Promise<AxiosResponse<Campaign>> => {
	return PATCH(config.apiPath + `/projects/${projectId}/campaigns/${campaignId}`, formData);
};

export const archiveCampaignAPICall = async (
	projectId: string,
	campaignId: string,
): Promise<AxiosResponse<void>> => {
	return DELETE(config.apiPath + `/projects/${projectId}/campaigns/${campaignId}`);
};

export const getCampaignsAPICall = async (
	projectId: string,
	formData: GetCampaignsParams,
): Promise<AxiosResponse<GetCampaignsResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/campaigns/search_v2`, formData);
};

export const getCampaignMetricsAPICall = async (
	projectId: string,
	formData: DateRangeQuery,
): Promise<AxiosResponse<CampaignMetricsResponse>> => {
	return POST(config.apiPath + `/projects/${projectId}/campaigns/metrics_overview`, formData);
};
