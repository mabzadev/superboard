import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export interface MarketplaceAuthor {
	name: string;
	verified: boolean;
}

export interface MarketplaceAuditSummary {
	verdict: "pass" | "warn" | "fail";
	riskScore: number;
}

export interface MarketplaceImageAuditSummary {
	verdict: "pass" | "warn" | "fail";
}

export interface MarketplaceVersion {
	version: string;
	minEmDashVersion?: string;
	bundleSize: number;
	changelog?: string;
	readme?: string;
	screenshotUrls?: string[];
	audit?: MarketplaceAuditSummary;
	imageAudit?: MarketplaceImageAuditSummary;
	publishedAt: string;
}

export interface MarketplacePluginSummary {
	id: string;
	name: string;
	description?: string;
	author: MarketplaceAuthor;
	capabilities: string[];
	keywords?: string[];
	installCount: number;
	iconUrl?: string;
	latestVersion?: {
		version: string;
		audit?: MarketplaceAuditSummary;
		imageAudit?: MarketplaceImageAuditSummary;
	};
	createdAt: string;
	updatedAt: string;
}

export interface MarketplacePluginDetail extends MarketplacePluginSummary {
	license?: string;
	repositoryUrl?: string;
	homepageUrl?: string;
	latestVersion?: MarketplaceVersion;
}

export interface MarketplaceSearchResult {
	items: MarketplacePluginSummary[];
	nextCursor?: string;
}

export interface MarketplaceSearchOpts {
	q?: string;
	capability?: string;
	sort?: "installs" | "updated" | "created" | "name";
	cursor?: string;
	limit?: number;
}

export interface PluginUpdateInfo {
	pluginId: string;
	installed: string;
	latest: string;
	hasCapabilityChanges: boolean;
}

export interface InstallPluginOpts {
	version?: string;
	confirmMcpTools?: boolean;
}

export interface PluginMcpConsentTool {
	name: string;
	description: string;
	route: string;
	permission: string;
	destructive: boolean;
}

export class PluginMcpConsentRequiredError extends Error {
	constructor(readonly tools: PluginMcpConsentTool[]) {
		super(i18n._(msg`Plugin MCP tools require explicit consent`));
		this.name = "PluginMcpConsentRequiredError";
	}
}

function isPluginMcpConsentTool(value: unknown): value is PluginMcpConsentTool {
	if (!value || typeof value !== "object") return false;
	return (
		typeof Reflect.get(value, "name") === "string" &&
		typeof Reflect.get(value, "description") === "string" &&
		typeof Reflect.get(value, "route") === "string" &&
		typeof Reflect.get(value, "permission") === "string" &&
		typeof Reflect.get(value, "destructive") === "boolean"
	);
}

function getMcpConsentTools(body: unknown): PluginMcpConsentTool[] | null {
	if (!body || typeof body !== "object") return null;
	const error = Reflect.get(body, "error");
	if (!error || typeof error !== "object") return null;
	if (Reflect.get(error, "code") !== "MCP_TOOL_CONSENT_REQUIRED") return null;
	const details = Reflect.get(error, "details");
	if (!details || typeof details !== "object") return null;
	const tools = Reflect.get(details, "mcpTools");
	if (!Array.isArray(tools) || tools.length === 0) return null;
	const valid = tools.filter(isPluginMcpConsentTool);
	return valid.length > 0 ? valid : null;
}

export interface UpdatePluginOpts {
	confirmCapabilityChanges?: boolean;
	confirmMcpTools?: boolean;
}

export interface UninstallPluginOpts {
	deleteData?: boolean;
}

const MARKETPLACE_BASE = `${API_BASE}/admin/plugins/marketplace`;

export async function searchMarketplace(
	opts: MarketplaceSearchOpts = {},
): Promise<MarketplaceSearchResult> {
	const params = new URLSearchParams();
	if (opts.q) params.set("q", opts.q);
	if (opts.capability) params.set("capability", opts.capability);
	if (opts.sort) params.set("sort", opts.sort);
	if (opts.cursor) params.set("cursor", opts.cursor);
	if (opts.limit) params.set("limit", String(opts.limit));

	const qs = params.toString();
	const url = `${MARKETPLACE_BASE}${qs ? `?${qs}` : ""}`;
	const response = await apiFetch(url);
	return parseApiResponse<MarketplaceSearchResult>(response, "Marketplace search failed");
}

export async function fetchMarketplacePlugin(id: string): Promise<MarketplacePluginDetail> {
	const response = await apiFetch(`${MARKETPLACE_BASE}/${encodeURIComponent(id)}`);
	if (response.status === 404) {
		throw new Error(`Plugin "${id}" not found in marketplace`);
	}
	return parseApiResponse<MarketplacePluginDetail>(response, "Failed to fetch plugin");
}

export async function installMarketplacePlugin(
	id: string,
	opts: InstallPluginOpts = {},
): Promise<void> {
	const response = await apiFetch(`${MARKETPLACE_BASE}/${encodeURIComponent(id)}/install`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
	if (!response.ok) {
		const body: unknown = await response
			.clone()
			.json()
			.catch(() => null);
		const mcpTools = getMcpConsentTools(body);
		if (mcpTools) throw new PluginMcpConsentRequiredError(mcpTools);
		await throwResponseError(response, i18n._(msg`Failed to install plugin`));
	}
}

export async function updateMarketplacePlugin(
	id: string,
	opts: UpdatePluginOpts = {},
): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${encodeURIComponent(id)}/update`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
	if (!response.ok) {
		const body: unknown = await response
			.clone()
			.json()
			.catch(() => null);
		const mcpTools = getMcpConsentTools(body);
		if (mcpTools) throw new PluginMcpConsentRequiredError(mcpTools);
		await throwResponseError(response, i18n._(msg`Failed to update plugin`));
	}
}

export async function uninstallMarketplacePlugin(
	id: string,
	opts: UninstallPluginOpts = {},
): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${encodeURIComponent(id)}/uninstall`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(opts),
	});
	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to uninstall plugin`));
}

export async function checkPluginUpdates(): Promise<PluginUpdateInfo[]> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/updates`);
	const result = await parseApiResponse<{ items: PluginUpdateInfo[] }>(
		response,
		"Failed to check for updates",
	);
	return result.items;
}

import type { MessageDescriptor } from "@lingui/core";

export const CAPABILITY_LABELS: Record<string, MessageDescriptor> = {
	"content:read": msg`Read your content`,
	"content:write": msg`Create, update, and delete content`,
	"taxonomies:read": msg`Read your taxonomies and terms`,
	"media:read": msg`Access your media library`,
	"media:write": msg`Upload and manage media`,
	"users:read": msg`Read user accounts`,
	"network:request": msg`Make network requests`,
	"network:request:unrestricted": msg`Make network requests to any host (unrestricted)`,
	"read:content": msg`Read your content`,
	"write:content": msg`Create, update, and delete content`,
	"read:media": msg`Access your media library`,
	"write:media": msg`Upload and manage media`,
	"read:users": msg`Read user accounts`,
	"network:fetch": msg`Make network requests`,
	"network:fetch:any": msg`Make network requests to any host (unrestricted)`,
};

const NETWORK_REQUEST_CAPABILITIES = new Set(["network:request", "network:fetch"]);

export function describeCapability(capability: string, allowedHosts?: string[]): string {
	const descriptor = CAPABILITY_LABELS[capability];
	const base = descriptor ? i18n._(descriptor) : capability;
	if (NETWORK_REQUEST_CAPABILITIES.has(capability) && allowedHosts && allowedHosts.length > 0) {
		return i18n._(msg`${base} to: ${allowedHosts.join(", ")}`);
	}
	return base;
}
