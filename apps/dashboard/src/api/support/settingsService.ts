import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

// Canonical Grow client for Support project settings.

export type SupportFieldDefinition = {
  key: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "string_list"
    | "json";
  required?: boolean;
  max_length?: number;
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
};

export type SupportEntityDefinition = {
  label: string;
  description: string;
  fields: SupportFieldDefinition[];
};

export type SupportProjectSettings = {
  project_id?: number;
  business_name: string;
  locale: string;
  timezone: string;
  date_format: string;
  auto_resolve_minutes: number | null;
  attachment_max_bytes: number;
  allowed_content_types: string[];
  features: Record<string, boolean>;
  updated_at?: string;
};

export type SupportConfigurationEntity = {
  id: string;
  project_id: number;
  entity_type: string;
  name: string;
  enabled: boolean;
  position: number;
  configuration: Record<string, unknown>;
  secret_configured?: boolean;
  secret_version?: number | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type SupportSettingsBootstrap = {
  settings: SupportProjectSettings;
  entities: SupportConfigurationEntity[];
  catalog: Record<string, SupportEntityDefinition>;
};

const path = (projectId: string, resource = "") => {
  return `${config.apiPath}/support/projects/${encodeURIComponent(projectId)}/settings${resource}`;
};

export const getSupportSettings = async (
  projectId: string
): Promise<{ data: SupportSettingsBootstrap }> =>
  (await GET(path(projectId))).data;

export const updateSupportSettings = async (
  projectId: string,
  settings: SupportProjectSettings
) => (await PATCH(path(projectId), settings)).data;

export const createSupportConfiguration = async (
  projectId: string,
  entity: Pick<
    SupportConfigurationEntity,
    "entity_type" | "name" | "enabled" | "position" | "configuration"
  >
) => (await POST(path(projectId, "/entities"), entity, { retry: false })).data;

export const updateSupportConfiguration = async (
  projectId: string,
  entityId: string,
  entity: Pick<
    SupportConfigurationEntity,
    "entity_type" | "name" | "enabled" | "position" | "configuration"
  >
) =>
  (
    await PATCH(
      path(projectId, `/entities/${encodeURIComponent(entityId)}`),
      entity,
      { retry: false }
    )
  ).data;

export const deleteSupportConfiguration = async (
  projectId: string,
  entityId: string
) =>
  (
    await DELETE(path(projectId, `/entities/${encodeURIComponent(entityId)}`), {
      retry: false,
    })
  ).data;

export const rotateSupportWebhookSecret = async (
  projectId: string,
  entityId: string,
  secret: string
) =>
  (
    await PUT(
      path(projectId, `/entities/${encodeURIComponent(entityId)}/secret`),
      { secret },
      { retry: false }
    )
  ).data;

export const revokeSupportWebhookSecret = async (
  projectId: string,
  entityId: string
) =>
  (
    await DELETE(
      path(projectId, `/entities/${encodeURIComponent(entityId)}/secret`),
      { retry: false }
    )
  ).data;

// Source-compatibility aliases for internal adapters.
export type MessagingFieldDefinition = SupportFieldDefinition;
export type MessagingEntityDefinition = SupportEntityDefinition;
export type MessagingProjectSettings = SupportProjectSettings;
export type MessagingConfigurationEntity = SupportConfigurationEntity;
export type MessagingSettingsBootstrap = SupportSettingsBootstrap;
export const getMessagingSettings = getSupportSettings;
export const updateMessagingSettings = updateSupportSettings;
export const createMessagingConfiguration = createSupportConfiguration;
export const updateMessagingConfiguration = updateSupportConfiguration;
export const deleteMessagingConfiguration = deleteSupportConfiguration;
