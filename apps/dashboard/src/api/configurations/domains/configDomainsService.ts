import { GET, POST, PUT } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type {
  DomainConfig,
  DomainDefaults,
  SubdomainPayload,
  GoogleTrackingIdPayload,
} from "@/types";

interface DomainResponse {
  domain: DomainConfig;
}

interface SubdomainAvailabilityResponse {
  available: boolean;
}

export const getProjectDomainAPICall = async (
  projectId: string
): Promise<AxiosResponse<DomainResponse>> => {
  return GET(config.apiPath + `/projects/${projectId}/domain`);
};

export const getDomainDefaultsAPICall = async (
  projectId: string
): Promise<AxiosResponse<DomainDefaults>> => {
  return GET(config.apiPath + `/projects/${projectId}/domain/defaults`);
};

export const setSubdomainAPICall = async (
  projectId: string,
  formData: FormData | SubdomainPayload
): Promise<AxiosResponse<DomainResponse>> => {
  return PUT(config.apiPath + `/projects/${projectId}/domain`, formData);
};

export const verifySubdomainAvailabilityAPICall = async (
  projectId: string,
  subdomain: string
): Promise<AxiosResponse<SubdomainAvailabilityResponse>> => {
  const data = {
    subdomain: subdomain,
  };

  return POST(
    config.apiPath + `/projects/${projectId}/domain/check_availability`,
    data
  );
};

export const setGoogleTrackingIDAPICall = async (
  projectId: string,
  formData: FormData | GoogleTrackingIdPayload
): Promise<AxiosResponse<DomainResponse>> => {
  return PUT(
    config.apiPath + `/projects/${projectId}/domain/google_tracking_id`,
    formData
  );
};
