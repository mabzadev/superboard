const DEFAULT_BASE_URL = "https://mcp.grovs.io";
const REQUEST_TIMEOUT_MS = 30_000;

function baseUrl(): string {
  return process.env.GROVS_API_URL || DEFAULT_BASE_URL;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(0, "Request timed out");
    }
    throw new ApiError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new ApiError(res.status, res.statusText || "Unknown error");
    }
    throw new ApiError(res.status, "Invalid JSON response from server");
  }

  if (!res.ok) {
    const msg =
      (data as Record<string, unknown>).error ||
      (data as Record<string, unknown>).message ||
      res.statusText;
    throw new ApiError(res.status, String(msg));
  }

  return data;
}

// --- Status ---

export async function getStatus(token: string): Promise<unknown> {
  return request("GET", "/api/v1/mcp/status", token);
}

// --- Usage ---

export async function getUsage(token: string, instanceId: string): Promise<unknown> {
  return request("GET", `/api/v1/mcp/usage?instance_id=${encodeURIComponent(instanceId)}`, token);
}

// --- Projects ---

export async function createProject(token: string, name: string): Promise<unknown> {
  return request("POST", "/api/v1/mcp/projects", token, { name });
}

// --- Links ---

// Per-platform redirect:
//   • string                                       → app + custom URL (open app if installed, else this URL)
//   • { url, open_app_if_installed?: boolean }    → explicit form; false skips the app-open attempt
export type CustomRedirect = string | { url: string; open_app_if_installed?: boolean };

export interface CreateLinkData {
  name: string;
  path?: string;
  title?: string;
  subtitle?: string;
  image_url?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  custom_redirects?: Record<string, CustomRedirect>;
  campaign_id?: number;
}

export async function createLink(token: string, projectId: string, data: CreateLinkData): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/links?project_id=${encodeURIComponent(projectId)}`,
    token,
    data,
  );
}

export async function getLink(token: string, projectId: string, path: string): Promise<unknown> {
  return request(
    "GET",
    `/api/v1/mcp/links/by-path/${encodeURIComponent(path)}?project_id=${encodeURIComponent(projectId)}`,
    token,
  );
}

export interface UpdateLinkData {
  name?: string;
  path?: string;
  title?: string;
  subtitle?: string;
  image_url?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  custom_redirects?: Record<string, CustomRedirect>;
  campaign_id?: number;
}

export async function updateLink(
  token: string,
  projectId: string,
  linkId: number,
  data: UpdateLinkData,
): Promise<unknown> {
  return request(
    "PATCH",
    `/api/v1/mcp/links/${encodeURIComponent(linkId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
    data,
  );
}

export async function archiveLink(token: string, projectId: string, linkId: number): Promise<unknown> {
  return request(
    "DELETE",
    `/api/v1/mcp/links/${encodeURIComponent(linkId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
  );
}

export interface SearchLinksParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: string;
}

export async function searchLinks(token: string, projectId: string, params: SearchLinksParams): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/links/search?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
  );
}

// --- Analytics ---

export interface AnalyticsParams {
  start_date?: string;
  end_date?: string;
  platform?: string;
}

export async function getAnalyticsOverview(
  token: string,
  projectId: string,
  params: AnalyticsParams,
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/overview?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
  );
}

export interface LinkAnalyticsParams {
  path: string;
  start_date?: string;
  end_date?: string;
}

export async function getLinkAnalytics(
  token: string,
  projectId: string,
  params: LinkAnalyticsParams,
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/link?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
  );
}

export interface TopLinksParams {
  start_date?: string;
  end_date?: string;
  platform?: string;
  limit?: number;
}

export async function getTopLinks(token: string, projectId: string, params: TopLinksParams): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/top_links?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
  );
}

// --- Configuration ---

export async function configureRedirects(
  token: string,
  projectId: string,
  config: Record<string, unknown>,
): Promise<unknown> {
  return request(
    "PUT",
    `/api/v1/mcp/redirects?project_id=${encodeURIComponent(projectId)}`,
    token,
    config,
  );
}

export async function configureSdk(
  token: string,
  instanceId: string,
  config: Record<string, unknown>,
): Promise<unknown> {
  return request(
    "PUT",
    `/api/v1/mcp/sdk?instance_id=${encodeURIComponent(instanceId)}`,
    token,
    config,
  );
}

// --- Campaigns ---

export async function createCampaign(token: string, projectId: string, name: string): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/campaigns?project_id=${encodeURIComponent(projectId)}`,
    token,
    { name },
  );
}

export interface SearchCampaignsParams {
  page?: number;
  per_page?: number;
  term?: string;
  sort_by?: string;
  ascendent?: boolean;
  start_date?: string;
  end_date?: string;
  platform?: string;
  archived?: boolean;
}

export async function searchCampaigns(
  token: string,
  projectId: string,
  params: SearchCampaignsParams,
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/campaigns/search?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
  );
}

export async function archiveCampaign(token: string, projectId: string, campaignId: number): Promise<unknown> {
  return request(
    "DELETE",
    `/api/v1/mcp/campaigns/${encodeURIComponent(campaignId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
  );
}
