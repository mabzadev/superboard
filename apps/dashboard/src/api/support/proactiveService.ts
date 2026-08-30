import {
  createSupportResource,
  deleteSupportResource,
  listSupportResource,
  postSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportCampaign = SupportEntity & {
  inbox_id: string;
  name: string;
  campaign_type: "one_off" | "ongoing";
  message: string;
  audience: Record<string, unknown>;
  status:
    | "draft"
    | "scheduled"
    | "running"
    | "paused"
    | "completed"
    | "cancelled";
  scheduled_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export const listSupportCampaigns = (
  projectRef: string,
  query?: SupportCursorQuery
) =>
  listSupportResource<SupportCampaign>(
    projectRef,
    "proactive-support/campaigns",
    query
  );

export const createSupportCampaign = (
  projectRef: string,
  input: Pick<
    SupportCampaign,
    | "inbox_id"
    | "name"
    | "campaign_type"
    | "message"
    | "audience"
    | "scheduled_at"
  >
) =>
  createSupportResource<SupportCampaign, typeof input>(
    projectRef,
    "proactive-support/campaigns",
    input
  );

export const updateSupportCampaign = (
  projectRef: string,
  id: string,
  input: Partial<
    Pick<
      SupportCampaign,
      | "inbox_id"
      | "name"
      | "campaign_type"
      | "message"
      | "audience"
      | "scheduled_at"
    >
  >
) =>
  updateSupportResource<SupportCampaign, typeof input>(
    projectRef,
    "proactive-support/campaigns",
    id,
    input
  );

export const deleteSupportCampaign = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "proactive-support/campaigns", id);

export const runSupportCampaignAction = (
  projectRef: string,
  id: string,
  action: "schedule" | "start" | "pause" | "resume" | "cancel",
  scheduledAt?: string
) =>
  postSupportAction<SupportCampaign>(
    projectRef,
    `proactive-support/campaigns/${encodeURIComponent(id)}/${action}`,
    action === "schedule" ? { scheduled_at: scheduledAt } : {}
  );
