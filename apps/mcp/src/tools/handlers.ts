import * as api from "../api-client.js";
import type {
  CreateLinkData,
  UpdateLinkData,
  SearchLinksParams,
  AnalyticsParams,
  LinkAnalyticsParams,
  TopLinksParams,
  SearchCampaignsParams,
} from "../api-client.js";
import type { ToolResult } from "../server.js";
import type { Obj } from "./utils.js";
import {
  formatStatus,
  formatUsage,
  formatCreateProject,
  formatLink,
  formatSearchLinks,
  formatAnalyticsOverview,
  formatLinkAnalytics,
  formatTopLinks,
  formatRedirects,
  formatSdkConfig,
  formatCampaign,
  formatListCampaigns,
} from "./formatters.js";

function success(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Stringify non-object API responses; pass objects to the formatter.
 *
 * The Grovs backend may inject a `_warning` string into any response (e.g., quota exceeded,
 * upcoming deprecation). When present, it's appended after the formatted output so the user
 * always sees it regardless of which tool was called.
 */
export function format(data: unknown, formatter: (d: Obj) => string): string {
  if (data === null || data === undefined || typeof data !== "object") {
    return JSON.stringify(data) ?? String(data);
  }
  const obj = data as Obj;
  const warning = obj._warning as string | undefined;
  let text = formatter(obj);
  if (warning) {
    text += `\n\n${warning}`;
  }
  return text;
}

// --- Handlers ---
// Each handler: call API, format result, return ToolResult.
// Named async functions give readable stack traces when debugging.

export async function handleGetStatus(token: string): Promise<ToolResult> {
  return success(format(await api.getStatus(token), formatStatus));
}

export async function handleGetUsage(token: string, instanceId: string): Promise<ToolResult> {
  return success(format(await api.getUsage(token, instanceId), formatUsage));
}

export async function handleCreateProject(token: string, name: string): Promise<ToolResult> {
  return success(format(await api.createProject(token, name), formatCreateProject));
}

export async function handleCreateLink(token: string, projectId: string, data: CreateLinkData): Promise<ToolResult> {
  return success(format(await api.createLink(token, projectId, data), (o) => formatLink(o, "Created")));
}

export async function handleGetLink(token: string, projectId: string, path: string): Promise<ToolResult> {
  return success(format(await api.getLink(token, projectId, path), (o) => formatLink(o, "Details")));
}

export async function handleUpdateLink(token: string, projectId: string, linkId: number, data: UpdateLinkData): Promise<ToolResult> {
  return success(format(await api.updateLink(token, projectId, linkId, data), (o) => formatLink(o, "Updated")));
}

export async function handleArchiveLink(token: string, projectId: string, linkId: number): Promise<ToolResult> {
  return success(format(await api.archiveLink(token, projectId, linkId), (o) => formatLink(o, "Archived")));
}

export async function handleSearchLinks(token: string, projectId: string, params: SearchLinksParams): Promise<ToolResult> {
  return success(format(await api.searchLinks(token, projectId, params), formatSearchLinks));
}

export async function handleGetAnalyticsOverview(token: string, projectId: string, params: AnalyticsParams): Promise<ToolResult> {
  return success(format(await api.getAnalyticsOverview(token, projectId, params), formatAnalyticsOverview));
}

export async function handleGetLinkAnalytics(token: string, projectId: string, params: LinkAnalyticsParams): Promise<ToolResult> {
  return success(format(await api.getLinkAnalytics(token, projectId, params), formatLinkAnalytics));
}

export async function handleGetTopLinks(token: string, projectId: string, params: TopLinksParams): Promise<ToolResult> {
  return success(format(await api.getTopLinks(token, projectId, params), formatTopLinks));
}

export async function handleConfigureRedirects(token: string, projectId: string, config: Record<string, unknown>): Promise<ToolResult> {
  return success(format(await api.configureRedirects(token, projectId, config), formatRedirects));
}

export async function handleConfigureSdk(token: string, instanceId: string, config: Record<string, unknown>): Promise<ToolResult> {
  return success(format(await api.configureSdk(token, instanceId, config), formatSdkConfig));
}

export async function handleCreateCampaign(token: string, projectId: string, name: string): Promise<ToolResult> {
  return success(format(await api.createCampaign(token, projectId, name), (o) => formatCampaign(o, "Created")));
}

export async function handleListCampaigns(token: string, projectId: string, params: SearchCampaignsParams): Promise<ToolResult> {
  return success(format(await api.searchCampaigns(token, projectId, params), formatListCampaigns));
}

export async function handleArchiveCampaign(token: string, projectId: string, campaignId: number): Promise<ToolResult> {
  return success(format(await api.archiveCampaign(token, projectId, campaignId), (o) => formatCampaign(o, "Archived")));
}
