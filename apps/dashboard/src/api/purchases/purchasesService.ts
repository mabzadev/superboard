import { POST } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type { Purchase, RevenueMetric, GetRevenueParams } from "@/types";

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
  formData: GetRevenueParams
): Promise<AxiosResponse<PurchasesListResponse>> => {
  return POST(
    config.apiPath + `/projects/${instanceId}/purchases/search`,
    formData
  );
};

export const getRevenueMetricsAPICall = async (
  instanceId: string,
  formData: GetRevenueParams
): Promise<AxiosResponse<RevenueMetricsListResponse>> => {
  return POST(
    config.apiPath + `/projects/${instanceId}/purchases/revenue`,
    formData
  );
};
