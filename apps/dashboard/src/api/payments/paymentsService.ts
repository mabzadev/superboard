import { DELETE, GET, POST } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type { Subscription, MAU } from "@/types";

// --- Response interfaces ---

export interface StripeUrlResponse {
  url: string;
}

export const getSubscriptionDetailsAPICall = async (
  id: string
): Promise<AxiosResponse<Subscription>> => {
  return GET(config.apiPath + `/instances/${id}/billing/subscription`);
};

export const getCurrentMauAPICall = async (
  id: string
): Promise<AxiosResponse<MAU>> => {
  return GET(config.apiPath + `/instances/${id}/billing/mau`);
};

export const getDashboardUrlAPICall = async (
  id: string
): Promise<AxiosResponse<StripeUrlResponse>> => {
  return GET(config.apiPath + `/instances/${id}/billing/stripe_portal`);
};

export const getCurrentUsageAPICall = async (
  id: string
): Promise<AxiosResponse> => {
  return GET(config.apiPath + `/instances/${id}/billing/usage`);
};

export const createSubscriptionAPICall = async (
  instanceId: string
): Promise<AxiosResponse<StripeUrlResponse>> => {
  const data = {
    id: instanceId,
  };

  return POST(
    config.apiPath + `/instances/${instanceId}/billing/subscriptions`,
    data
  );
};

export const cancelSubscriptionAPICall = async (
  instanceId: string
): Promise<AxiosResponse> => {
  return DELETE(
    config.apiPath + `/instances/${instanceId}/billing/subscription`
  );
};
