import { POST } from "@superboard/front-ui/lib/api.js";
import { config } from "@superboard/front-ui/lib/config.js";
import type { Purchase, RevenueMetric, GetRevenueParams } from "@superboard/front-ui/types";
import type { AxiosResponse } from "axios";

// --- Response interfaces ---

export interface PurchasesListResponse {
	data: Purchase[];
	total_pages: number;
}

export interface RevenueMetricsListResponse {
	data: RevenueMetric[];
	total_pages: number;
	total_entries?: number;
}

export const getProjectPurchasesAPICall = async (
	instanceId: string,
	formData: GetRevenueParams,
): Promise<AxiosResponse<PurchasesListResponse>> => {
	return POST(config.apiPath + `/projects/${instanceId}/purchases/search`, formData);
};

export const getRevenueMetricsAPICall = async (
	instanceId: string,
	formData: GetRevenueParams,
): Promise<AxiosResponse<RevenueMetricsListResponse>> => {
	return POST(config.apiPath + `/projects/${instanceId}/purchases/revenue`, formData);
};
