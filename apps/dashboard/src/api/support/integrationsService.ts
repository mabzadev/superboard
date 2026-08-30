import {
  createSupportResource,
  deleteSupportResource,
  listSupportResource,
  postSupportAction,
  putSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";
import type { SupportProviderStatus } from "./channelsService";

export type SupportIntegration = SupportEntity & {
  provider: string;
  display_name: string;
  status: SupportProviderStatus;
  settings?: Record<string, unknown>;
};

export const listSupportIntegrations = (
  projectRef: string,
  query?: SupportCursorQuery
) => listSupportResource<SupportIntegration>(projectRef, "integrations", query);
export const createSupportIntegration = (
  projectRef: string,
  input: Pick<SupportIntegration, "provider" | "display_name"> & {
    status?: SupportProviderStatus;
    settings?: Record<string, unknown>;
  }
) =>
  createSupportResource<SupportIntegration, typeof input>(
    projectRef,
    "integrations",
    input
  );
export const updateSupportIntegration = (
  projectRef: string,
  id: string,
  input: Partial<
    Pick<SupportIntegration, "display_name" | "status" | "settings">
  >
) =>
  updateSupportResource<SupportIntegration, typeof input>(
    projectRef,
    "integrations",
    id,
    input
  );
export const deleteSupportIntegration = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "integrations", id);

export const saveSupportIntegrationCredentials = (
  projectRef: string,
  id: string,
  credentials: Record<string, string>
) =>
  putSupportAction<{
    id: string;
    status: "configuration_required" | "configured";
    credentials_configured: boolean;
    authorization_required?: boolean;
  }>(projectRef, `integrations/${encodeURIComponent(id)}/credentials`, {
    credentials,
  });

export const startSupportIntegrationOAuth = (
  projectRef: string,
  id: string,
  input: { callback_uri: string; return_uri: string }
) =>
  postSupportAction<{
    authorization_url: string;
    expires_in: number;
  }>(projectRef, `integrations/${encodeURIComponent(id)}/oauth`, input);
