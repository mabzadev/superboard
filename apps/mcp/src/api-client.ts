const REQUEST_TIMEOUT_MS = 30_000;

export type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiRuntime = {
  baseUrl: string;
  fetcher: ApiFetch;
  timeoutMs: number;
};

export interface ApiClient {
  getStatus(token: string): Promise<unknown>;
  getPlatformStatus(token: string): Promise<unknown>;
  getUsage(token: string, instanceId: string): Promise<unknown>;
  createProject(token: string, name: string): Promise<unknown>;
  createLink(token: string, projectId: string, data: CreateLinkData): Promise<unknown>;
  getLink(token: string, projectId: string, path: string): Promise<unknown>;
  updateLink(
    token: string,
    projectId: string,
    linkId: number,
    data: UpdateLinkData,
  ): Promise<unknown>;
  archiveLink(token: string, projectId: string, linkId: number): Promise<unknown>;
  searchLinks(token: string, projectId: string, params: SearchLinksParams): Promise<unknown>;
  getAnalyticsOverview(token: string, projectId: string, params: AnalyticsParams): Promise<unknown>;
  getLinkAnalytics(token: string, projectId: string, params: LinkAnalyticsParams): Promise<unknown>;
  getTopLinks(token: string, projectId: string, params: TopLinksParams): Promise<unknown>;
  configureRedirects(
    token: string,
    projectId: string,
    config: Record<string, unknown>,
  ): Promise<unknown>;
  configureSdk(
    token: string,
    instanceId: string,
    config: Record<string, unknown>,
  ): Promise<unknown>;
  createCampaign(token: string, projectId: string, name: string): Promise<unknown>;
  searchCampaigns(
    token: string,
    projectId: string,
    params: SearchCampaignsParams,
  ): Promise<unknown>;
  archiveCampaign(token: string, projectId: string, campaignId: number): Promise<unknown>;
}

export function normalizeApiBaseUrl(value: unknown, variable = "SUPERBOARD_API_URL"): string {
  const configured = String(value || "").trim();
  if (!configured) {
    throw new ApiError(0, `${variable} is required; select an application target explicitly`);
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ApiError(0, `${variable} must be an absolute HTTP(S) origin`);
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password) {
    throw new ApiError(0, `${variable} must be an absolute HTTP(S) origin without credentials`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new ApiError(
      0,
      `${variable} must contain an origin only, without a path, query, or fragment`,
    );
  }
  return parsed.origin;
}

export function configuredApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SUPERBOARD_API_URL) {
    return normalizeApiBaseUrl(env.SUPERBOARD_API_URL, "SUPERBOARD_API_URL");
  }
  return normalizeApiBaseUrl(env.OPENGROW_API_URL, "SUPERBOARD_API_URL");
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
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  let res: Response;
  try {
    res = await runtime.fetcher(`${runtime.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(runtime.timeoutMs),
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

function processRuntime(): ApiRuntime {
  return {
    baseUrl: configuredApiBaseUrl(),
    fetcher: globalThis.fetch,
    timeoutMs: REQUEST_TIMEOUT_MS,
  };
}

export function createApiClient(options: {
  baseUrl: string;
  fetcher?: ApiFetch;
  timeoutMs?: number;
}): ApiClient {
  const runtime: ApiRuntime = {
    baseUrl: normalizeApiBaseUrl(options.baseUrl, "SuperBoard API base URL"),
    fetcher: options.fetcher ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  };
  if (!Number.isFinite(runtime.timeoutMs) || runtime.timeoutMs <= 0) {
    throw new ApiError(0, "API request timeout must be a positive number");
  }
  return {
    getStatus: (token) => getStatus(token, runtime),
    getPlatformStatus: (token) => getPlatformStatus(token, runtime),
    getUsage: (token, instanceId) => getUsage(token, instanceId, runtime),
    createProject: (token, name) => createProject(token, name, runtime),
    createLink: (token, projectId, data) => createLink(token, projectId, data, runtime),
    getLink: (token, projectId, path) => getLink(token, projectId, path, runtime),
    updateLink: (token, projectId, linkId, data) =>
      updateLink(token, projectId, linkId, data, runtime),
    archiveLink: (token, projectId, linkId) => archiveLink(token, projectId, linkId, runtime),
    searchLinks: (token, projectId, params) => searchLinks(token, projectId, params, runtime),
    getAnalyticsOverview: (token, projectId, params) =>
      getAnalyticsOverview(token, projectId, params, runtime),
    getLinkAnalytics: (token, projectId, params) =>
      getLinkAnalytics(token, projectId, params, runtime),
    getTopLinks: (token, projectId, params) => getTopLinks(token, projectId, params, runtime),
    configureRedirects: (token, projectId, config) =>
      configureRedirects(token, projectId, config, runtime),
    configureSdk: (token, instanceId, config) => configureSdk(token, instanceId, config, runtime),
    createCampaign: (token, projectId, name) => createCampaign(token, projectId, name, runtime),
    searchCampaigns: (token, projectId, params) =>
      searchCampaigns(token, projectId, params, runtime),
    archiveCampaign: (token, projectId, campaignId) =>
      archiveCampaign(token, projectId, campaignId, runtime),
  };
}

// --- Status ---

export async function getStatus(
  token: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request("GET", "/api/v1/mcp/status", token, undefined, runtime);
}

export async function getPlatformStatus(
  token: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request("GET", "/api/v1/mcp/platform-status", token, undefined, runtime);
}

// --- Usage ---

export async function getUsage(
  token: string,
  instanceId: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "GET",
    `/api/v1/mcp/usage?instance_id=${encodeURIComponent(instanceId)}`,
    token,
    undefined,
    runtime,
  );
}

// --- Projects ---

export async function createProject(
  token: string,
  name: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request("POST", "/api/v1/mcp/projects", token, { name }, runtime);
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

export async function createLink(
  token: string,
  projectId: string,
  data: CreateLinkData,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/links?project_id=${encodeURIComponent(projectId)}`,
    token,
    data,
    runtime,
  );
}

export async function getLink(
  token: string,
  projectId: string,
  path: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "GET",
    `/api/v1/mcp/links/by-path/${encodeURIComponent(path)}?project_id=${encodeURIComponent(projectId)}`,
    token,
    undefined,
    runtime,
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
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "PATCH",
    `/api/v1/mcp/links/${encodeURIComponent(linkId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
    data,
    runtime,
  );
}

export async function archiveLink(
  token: string,
  projectId: string,
  linkId: number,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "DELETE",
    `/api/v1/mcp/links/${encodeURIComponent(linkId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
    undefined,
    runtime,
  );
}

export interface SearchLinksParams {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: string;
}

export async function searchLinks(
  token: string,
  projectId: string,
  params: SearchLinksParams,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/links/search?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
    runtime,
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
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/overview?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
    runtime,
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
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/link?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
    runtime,
  );
}

export interface TopLinksParams {
  start_date?: string;
  end_date?: string;
  platform?: string;
  limit?: number;
}

export async function getTopLinks(
  token: string,
  projectId: string,
  params: TopLinksParams,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/analytics/top_links?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
    runtime,
  );
}

// --- Configuration ---

export async function configureRedirects(
  token: string,
  projectId: string,
  config: Record<string, unknown>,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "PUT",
    `/api/v1/mcp/redirects?project_id=${encodeURIComponent(projectId)}`,
    token,
    config,
    runtime,
  );
}

export async function configureSdk(
  token: string,
  instanceId: string,
  config: Record<string, unknown>,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "PUT",
    `/api/v1/mcp/sdk?instance_id=${encodeURIComponent(instanceId)}`,
    token,
    config,
    runtime,
  );
}

// --- Campaigns ---

export async function createCampaign(
  token: string,
  projectId: string,
  name: string,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/campaigns?project_id=${encodeURIComponent(projectId)}`,
    token,
    { name },
    runtime,
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
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "POST",
    `/api/v1/mcp/campaigns/search?project_id=${encodeURIComponent(projectId)}`,
    token,
    params,
    runtime,
  );
}

export async function archiveCampaign(
  token: string,
  projectId: string,
  campaignId: number,
  runtime: ApiRuntime = processRuntime(),
): Promise<unknown> {
  return request(
    "DELETE",
    `/api/v1/mcp/campaigns/${encodeURIComponent(campaignId)}?project_id=${encodeURIComponent(projectId)}`,
    token,
    undefined,
    runtime,
  );
}
