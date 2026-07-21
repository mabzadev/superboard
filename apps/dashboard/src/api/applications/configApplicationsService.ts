import { DELETE, GET, PUT } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type { InstanceConfig } from "@/types";
import type {
  IosConfigPayload,
  AndroidConfigPayload,
  AndroidPushConfigPayload,
  DesktopConfigPayload,
} from "@/types";

interface ProjectConfigurationResponse {
  configurations: InstanceConfig;
}

export const getProjectConfigurationAPICall = async (
  instanceId: string
): Promise<AxiosResponse<ProjectConfigurationResponse>> => {
  return GET(config.apiPath + `/instances/${instanceId}/configurations`);
};

export const getGoogleConfigurationsScriptAPICall = async (
  instanceId: string
): Promise<AxiosResponse<string>> => {
  return GET(
    config.apiPath +
      `/instances/${instanceId}/configurations/android/google_configuration_script`
  );
};

export const setIOSAppConfigAPICall = async (
  instanceId: string,
  data: FormData | IosConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/ios`,
    data
  );
};

export const setIOSPushConfigAPICall = async (
  instanceId: string,
  data: FormData | IosConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/ios/push`,
    data
  );
};

export const setAndroidPushConfigAPICall = async (
  instanceId: string,
  data: FormData | AndroidPushConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/android/push`,
    data
  );
};

export const setWebAppConfigAPICall = async (
  instanceId: string,
  enabled: boolean,
  domains: string[]
): Promise<AxiosResponse> => {
  const data = {
    enabled: enabled,
    domains: domains,
  };

  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/web`,
    data
  );
};

export const setAndroidAppConfigAPICall = async (
  instanceId: string,
  data: FormData | AndroidConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/android`,
    data
  );
};

export const setAndroidAppWebhookAccessKeyAPICall = async (
  instanceId: string,
  data: FormData | AndroidConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath +
      `/instances/${instanceId}/configurations/android/api_access_key`,
    data
  );
};

export const setDesktopAppConfigAPICall = async (
  instanceId: string,
  data: FormData | DesktopConfigPayload
): Promise<AxiosResponse> => {
  return PUT(
    config.apiPath + `/instances/${instanceId}/configurations/desktop`,
    data
  );
};

export const removeIOSConfigAPICall = async (
  instanceId: string
): Promise<AxiosResponse> => {
  return DELETE(config.apiPath + `/instances/${instanceId}/configurations/ios`);
};

export const removeAndroidConfigAPICall = async (
  instanceId: string
): Promise<AxiosResponse> => {
  return DELETE(
    config.apiPath + `/instances/${instanceId}/configurations/android`
  );
};

export const removeWebConfigAPICall = async (
  instanceId: string
): Promise<AxiosResponse> => {
  return DELETE(config.apiPath + `/instances/${instanceId}/configurations/web`);
};
