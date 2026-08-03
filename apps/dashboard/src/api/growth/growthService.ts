import { DELETE, GET, PATCH, POST } from "@/lib/api";
import { config } from "@/lib/config";

export type GrowthContracts = {
  platforms: Array<{ id: "apple" | "google"; devices: string[]; public_metadata: boolean }>;
  sources: Array<{ id: string; configured: boolean; capabilities: string[] }>;
  automation_triggers: string[];
  automation_actions: string[];
  automation_trigger_actions: Record<string, string[]>;
  limits: Record<string, number>;
};

export type GrowthStoreEntity = {
  id: string;
  platform: "apple" | "google";
  app_identifier: string;
  display_name?: string | null;
  country: string;
  language: string;
  device: string;
  is_primary?: number;
  enabled: number;
};

export type GrowthKeyword = {
  id: string;
  app_id: string;
  keyword: string;
  platform: string;
  app_identifier: string;
  app_name?: string | null;
  country: string;
  language: string;
  rank?: number | null;
  volume?: number | null;
  search_popularity?: number | null;
  difficulty?: number | null;
  installs?: number | null;
  relevancy?: number | null;
  chance?: number | null;
  kei?: number | null;
  source?: string | null;
  observed_date?: string | null;
  enabled: number;
};

export type GrowthRecommendation = {
  id: string;
  kind: string;
  priority: "low" | "medium" | "high";
  title: string;
  summary: string;
  status: "open" | "dismissed" | "completed";
  updated_at: string;
};

export type GrowthAutomation = {
  id: string;
  name: string;
  trigger_type: string;
  action_type: "chat" | "push" | "in_app" | "inbox";
  trigger_config: Record<string, unknown>;
  action_config: Record<string, unknown>;
  enabled: boolean;
  run_count: number;
  failed_count: number;
};

const path = (projectId: string, resource: string) => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/growth/projects/${projectId}${resource}`;
};

export const getGrowthContracts = async (projectId: string): Promise<GrowthContracts> =>
  (await GET(path(projectId, "/contracts"))).data.data;

export const getGrowthOverview = async (projectId: string) =>
  (await GET(path(projectId, "/overview"))).data.data;

export const getGrowthApps = async (projectId: string): Promise<GrowthStoreEntity[]> =>
  (await GET(path(projectId, "/apps"))).data.data;

export const createGrowthApp = async (projectId: string, input: Record<string, unknown>) =>
  (await POST(path(projectId, "/apps"), input)).data.data;

export const updateGrowthApp = async (projectId: string, id: string, input: Record<string, unknown>) =>
  (await PATCH(path(projectId, `/apps/${id}`), input)).data.data;

export const deleteGrowthApp = async (projectId: string, id: string) =>
  DELETE(path(projectId, `/apps/${id}`));

export const getGrowthKeywords = async (projectId: string): Promise<GrowthKeyword[]> =>
  (await GET(path(projectId, "/keywords"))).data.data;

export const createGrowthKeyword = async (projectId: string, input: Record<string, unknown>) =>
  (await POST(path(projectId, "/keywords"), input)).data.data;

export const updateGrowthKeyword = async (projectId: string, id: string, input: Record<string, unknown>) =>
  (await PATCH(path(projectId, `/keywords/${id}`), input)).data.data;

export const deleteGrowthKeyword = async (projectId: string, id: string) =>
  DELETE(path(projectId, `/keywords/${id}`));

export const getGrowthCompetitors = async (projectId: string): Promise<GrowthStoreEntity[]> =>
  (await GET(path(projectId, "/competitors"))).data.data;

export const createGrowthCompetitor = async (projectId: string, input: Record<string, unknown>) =>
  (await POST(path(projectId, "/competitors"), input)).data.data;

export const updateGrowthCompetitor = async (projectId: string, id: string, input: Record<string, unknown>) =>
  (await PATCH(path(projectId, `/competitors/${id}`), input)).data.data;

export const deleteGrowthCompetitor = async (projectId: string, id: string) =>
  DELETE(path(projectId, `/competitors/${id}`));

export const queueGrowthSync = async (projectId: string) =>
  (await POST(path(projectId, "/sync"), {})).data.data;

export const getGrowthRecommendations = async (projectId: string): Promise<GrowthRecommendation[]> =>
  (await GET(path(projectId, "/recommendations"))).data.data;

export const updateGrowthRecommendation = async (projectId: string, id: string, status: GrowthRecommendation["status"]) =>
  (await PATCH(path(projectId, `/recommendations/${id}`), { status })).data.data;

export const getGrowthAutomations = async (projectId: string): Promise<GrowthAutomation[]> =>
  (await GET(path(projectId, "/automations"))).data.data;

export const createGrowthAutomation = async (projectId: string, input: Record<string, unknown>) =>
  (await POST(path(projectId, "/automations"), input)).data.data;

export const updateGrowthAutomation = async (projectId: string, id: string, input: Record<string, unknown>) =>
  (await PATCH(path(projectId, `/automations/${id}`), input)).data.data;

export const deleteGrowthAutomation = async (projectId: string, id: string) =>
  DELETE(path(projectId, `/automations/${id}`));
