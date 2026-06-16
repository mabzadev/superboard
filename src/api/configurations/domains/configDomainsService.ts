import { GET, POST, PUT, DELETE } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type {
  DomainConfig,
  DomainDefaults,
  SubdomainPayload,
  GoogleTrackingIdPayload,
  CustomDomainResponse,
  CustomDomainsListResponse,
  CustomDomainPreflightResponse,
  CustomDomainPurpose,
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

export const getCustomDomainAPICall = async (
  projectId: string
): Promise<AxiosResponse<CustomDomainResponse>> => {
  return GET(config.apiPath + `/projects/${projectId}/custom_domain`);
};

export const addCustomDomainAPICall = async (
  projectId: string,
  hostname: string
): Promise<AxiosResponse<CustomDomainResponse>> => {
  return POST(config.apiPath + `/projects/${projectId}/custom_domain`, {
    hostname,
  });
};

export const removeCustomDomainAPICall = async (
  projectId: string
): Promise<AxiosResponse<void>> => {
  return DELETE(config.apiPath + `/projects/${projectId}/custom_domain`);
};

export const getCustomDomainsAPICall = async (
  projectId: string
): Promise<AxiosResponse<CustomDomainsListResponse>> => {
  return GET(config.apiPath + `/projects/${projectId}/custom_domains`);
};

export const getCustomDomainPreflightAPICall = async (
  projectId: string,
  hostname: string
): Promise<AxiosResponse<CustomDomainPreflightResponse>> => {
  return GET(
    config.apiPath +
      `/projects/${projectId}/custom_domains/preflight?hostname=${encodeURIComponent(hostname)}`,
    { maxRetries: 0 }
  );
};

export const addCustomDomainWithPurposeAPICall = async (
  projectId: string,
  hostname: string,
  purpose: CustomDomainPurpose
): Promise<AxiosResponse<CustomDomainResponse>> => {
  return POST(config.apiPath + `/projects/${projectId}/custom_domains`, {
    hostname,
    purpose,
  });
};

export const removeCustomDomainByPurposeAPICall = async (
  projectId: string,
  purpose: CustomDomainPurpose
): Promise<AxiosResponse<void>> => {
  return DELETE(
    config.apiPath + `/projects/${projectId}/custom_domains?purpose=${purpose}`
  );
};
