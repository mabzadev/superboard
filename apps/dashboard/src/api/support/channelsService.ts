import {
  createSupportResource,
  deleteSupportResource,
  getSupportAction,
  listSupportResource,
  postSupportAction,
  putSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportProviderStatus =
  | "configuration_required"
  | "configured"
  | "validated"
  | "degraded"
  | "live_validated"
  | "disabled";

export type SupportProviderEndpoint = SupportEntity & {
  inbox_id?: string | null;
  provider: string;
  display_name: string;
  status: SupportProviderStatus;
  settings?: Record<string, unknown>;
  last_validated_at?: string | null;
  last_event_at?: string | null;
  last_error_code?: string | null;
};

export type SupportChannel = {
  id: string;
  name: string;
  identifier: string;
  channel_type: string;
  status: string;
  provider?: string | null;
  provider_display_name?: string | null;
  provider_status?: SupportProviderStatus | null;
  last_validated_at?: string | null;
  last_event_at?: string | null;
  last_error_code?: string | null;
};

export const listSupportChannels = (projectRef: string) =>
  getSupportAction<SupportChannel[]>(projectRef, "channels");

export const listSupportProviders = (
  projectRef: string,
  query?: SupportCursorQuery
) =>
  listSupportResource<SupportProviderEndpoint>(projectRef, "providers", query);

export const createSupportProvider = (
  projectRef: string,
  input: Pick<
    SupportProviderEndpoint,
    "provider" | "display_name" | "inbox_id"
  > & {
    status?: SupportProviderStatus;
    settings?: Record<string, unknown>;
  }
) =>
  createSupportResource<SupportProviderEndpoint, typeof input>(
    projectRef,
    "providers",
    input
  );

export const updateSupportProvider = (
  projectRef: string,
  id: string,
  input: Partial<
    Pick<
      SupportProviderEndpoint,
      "display_name" | "inbox_id" | "status" | "settings"
    >
  >
) =>
  updateSupportResource<SupportProviderEndpoint, typeof input>(
    projectRef,
    "providers",
    id,
    input
  );

export const deleteSupportProvider = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "providers", id);

export const saveSupportProviderCredentials = (
  projectRef: string,
  id: string,
  credentials: Record<string, string>
) =>
  putSupportAction<{
    endpoint_id: string;
    configured: true;
    credential_fields: string[];
  }>(projectRef, `providers/${encodeURIComponent(id)}/credentials`, {
    credentials,
  });

export const getSupportProviderCredentialStatus = (
  projectRef: string,
  id: string
) =>
  getSupportAction<{
    endpoint_id: string;
    configured: boolean;
    credential_version: number | null;
    updated_at: string | null;
  }>(projectRef, `providers/${encodeURIComponent(id)}/credentials`);

export const startSupportProviderOAuth = (
  projectRef: string,
  id: string,
  input: { callback_uri: string; return_uri: string }
) =>
  postSupportAction<{
    authorization_url: string;
    expires_in: number;
  }>(projectRef, `providers/${encodeURIComponent(id)}/oauth`, input);
