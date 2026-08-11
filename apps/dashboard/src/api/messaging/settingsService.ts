import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

export type MessagingFieldDefinition = {
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

export type MessagingEntityDefinition = {
  label: string;
  description: string;
  fields: MessagingFieldDefinition[];
};

export type MessagingProjectSettings = {
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

export type MessagingConfigurationEntity = {
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

export type MessagingSettingsBootstrap = {
  settings: MessagingProjectSettings;
  entities: MessagingConfigurationEntity[];
  catalog: Record<string, MessagingEntityDefinition>;
};

const path = (projectId: string, resource = "") => {
  return `${config.apiPath}/support/projects/${projectId}/settings${resource}`;
};

export const getMessagingSettings = async (
  projectId: string
): Promise<{ data: MessagingSettingsBootstrap }> =>
  (await GET(path(projectId))).data;

export const updateMessagingSettings = async (
  projectId: string,
  settings: MessagingProjectSettings
) => (await PATCH(path(projectId), settings)).data;

export const createMessagingConfiguration = async (
  projectId: string,
  entity: Pick<
    MessagingConfigurationEntity,
    "entity_type" | "name" | "enabled" | "position" | "configuration"
  >
) => (await POST(path(projectId, "/entities"), entity, { retry: false })).data;

export const updateMessagingConfiguration = async (
  projectId: string,
  entityId: string,
  entity: Pick<
    MessagingConfigurationEntity,
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

export const deleteMessagingConfiguration = async (
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
