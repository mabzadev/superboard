import * as api from "../api-client.js";
import type {
  ApiClient,
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
  formatPlatformStatus,
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
 * The OpenGrow backend may inject an operational `_warning` string into a response. When
 * present, it's appended after the formatted output so the user
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

export async function handleGetStatus(token: string, client: ApiClient = api): Promise<ToolResult> {
  return success(format(await client.getStatus(token), formatStatus));
}

export async function handleGetPlatformStatus(
  token: string,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.getPlatformStatus(token), formatPlatformStatus));
}

export async function handleGetUsage(
  token: string,
  instanceId: string,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.getUsage(token, instanceId), formatUsage));
}

export async function handleCreateProject(
  token: string,
  name: string,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.createProject(token, name), formatCreateProject));
}

export async function handleCreateLink(
  token: string,
  projectId: string,
  data: CreateLinkData,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.createLink(token, projectId, data), (o) => formatLink(o, "Created")),
  );
}

export async function handleGetLink(
  token: string,
  projectId: string,
  path: string,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.getLink(token, projectId, path), (o) => formatLink(o, "Details")),
  );
}

export async function handleUpdateLink(
  token: string,
  projectId: string,
  linkId: number,
  data: UpdateLinkData,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.updateLink(token, projectId, linkId, data), (o) =>
      formatLink(o, "Updated"),
    ),
  );
}

export async function handleArchiveLink(
  token: string,
  projectId: string,
  linkId: number,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.archiveLink(token, projectId, linkId), (o) => formatLink(o, "Archived")),
  );
}

export async function handleSearchLinks(
  token: string,
  projectId: string,
  params: SearchLinksParams,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.searchLinks(token, projectId, params), formatSearchLinks));
}

export async function handleGetAnalyticsOverview(
  token: string,
  projectId: string,
  params: AnalyticsParams,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.getAnalyticsOverview(token, projectId, params), formatAnalyticsOverview),
  );
}

export async function handleGetLinkAnalytics(
  token: string,
  projectId: string,
  params: LinkAnalyticsParams,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.getLinkAnalytics(token, projectId, params), formatLinkAnalytics),
  );
}

export async function handleGetTopLinks(
  token: string,
  projectId: string,
  params: TopLinksParams,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.getTopLinks(token, projectId, params), formatTopLinks));
}

export async function handleConfigureRedirects(
  token: string,
  projectId: string,
  config: Record<string, unknown>,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.configureRedirects(token, projectId, config), formatRedirects),
  );
}

export async function handleConfigureSdk(
  token: string,
  instanceId: string,
  config: Record<string, unknown>,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(format(await client.configureSdk(token, instanceId, config), formatSdkConfig));
}

export async function handleCreateCampaign(
  token: string,
  projectId: string,
  name: string,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.createCampaign(token, projectId, name), (o) =>
      formatCampaign(o, "Created"),
    ),
  );
}

export async function handleListCampaigns(
  token: string,
  projectId: string,
  params: SearchCampaignsParams,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.searchCampaigns(token, projectId, params), formatListCampaigns),
  );
}

export async function handleArchiveCampaign(
  token: string,
  projectId: string,
  campaignId: number,
  client: ApiClient = api,
): Promise<ToolResult> {
  return success(
    format(await client.archiveCampaign(token, projectId, campaignId), (o) =>
      formatCampaign(o, "Archived"),
    ),
  );
}
