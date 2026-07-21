import type { AxiosResponse } from "axios";
import { DELETE, GET, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";
import type { Instance, GetStartedSetup } from "@/types";
import type {
  DismissGetStartedPayload,
  ExportUsagePayload,
  RevenueCollectionPayload,
} from "@/types";

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
  members: { email: string; role: string }[]
): Promise<AxiosResponse<CreateInstanceResponse>> => {
  const data = {
    name: name,
    members: members,
  };

  return POST(config.apiPath + "/instances", data);
};

export const editInstanceAPICall = async (
  instanceId: string,
  name: string
): Promise<AxiosResponse<InstancesResponse>> => {
  const data = {
    name: name,
  };

  return PUT(config.apiPath + `/instances/${instanceId}`, data);
};

export const getInstancesAPICall = async (): Promise<
  AxiosResponse<InstancesResponse>
> => {
  return GET(config.apiPath + `/instances`);
};

export const getMembersForInstanceAPICall = async (
  instanceId: string
): Promise<AxiosResponse<InstanceMembersResponse>> => {
  return GET(config.apiPath + `/instances/${instanceId}/members`);
};

export const addMemberToInstanceAPICall = async (
  instanceId: string,
  email: string,
  role: string
): Promise<AxiosResponse<InstanceMembersResponse>> => {
  const data = {
    email: email,
    role: role,
  };

  return POST(config.apiPath + `/instances/${instanceId}/members`, data);
};

export const removedMemberFromInstanceAPICall = async (
  instanceId: string,
  email: string
): Promise<AxiosResponse<InstanceMembersResponse>> => {
  return DELETE(
    config.apiPath +
      `/instances/${instanceId}/members?email=${encodeURIComponent(email)}`
  );
};

export const deleteInstanceAPICall = async (
  instanceId: string
): Promise<AxiosResponse> => {
  return DELETE(config.apiPath + `/instances/${instanceId}`);
};

export const currentUserRoleForInstanceAPICall = async (
  instanceId: string
): Promise<AxiosResponse<UserRoleResponse>> => {
  return GET(config.apiPath + `/instances/${instanceId}/role`);
};

export const instanceDetailsAPICall = async (
  instanceId: string
): Promise<AxiosResponse<InstanceDetailsResponse>> => {
  return GET(config.apiPath + `/instances/${instanceId}`);
};

export const dismissGetStartedAPICall = async (
  instanceId: string,
  data?: DismissGetStartedPayload
): Promise<AxiosResponse> => {
  return POST(
    config.apiPath + `/instances/${instanceId}/dismiss_get_started`,
    data
  );
};

export const exportUsageApiCall = async (
  instanceId: string,
  data: ExportUsagePayload
): Promise<AxiosResponse<ExportUsageResponse>> => {
  return POST(config.apiPath + `/instances/${instanceId}/exports/usage`, data);
};

export const setRevenueCollectionEnabledApiCall = async (
  instanceId: string,
  data: RevenueCollectionPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/revenue_collection`,
    data
  );
};

export const getSetupProgressAPICall = async (
  instanceId: string,
  category: string
): Promise<AxiosResponse<SetupProgressResponse>> => {
  return GET(
    config.apiPath +
      `/instances/${instanceId}/setup_progress?category=${encodeURIComponent(category)}`
  );
};

export const completeSetupStepAPICall = async (
  instanceId: string,
  category: string,
  stepIdentifier: string
): Promise<AxiosResponse<SetupProgressResponse>> => {
  const data = {
    category: category,
    step_identifier: stepIdentifier,
  };

  return POST(
    config.apiPath + `/instances/${instanceId}/setup_progress/complete`,
    data
  );
};
