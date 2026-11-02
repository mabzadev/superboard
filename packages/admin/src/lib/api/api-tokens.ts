import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export interface ApiTokenInfo {
	id: string;
	name: string;
	prefix: string;
	scopes: string[];
	userId: string;
	expiresAt: string | null;
	lastUsedAt: string | null;
	createdAt: string;
}

export interface ApiTokenCreateResult {
	token: string;
	info: ApiTokenInfo;
}

export interface CreateApiTokenInput {
	name: string;
	scopes: string[];
	expiresAt?: string;
}

export const API_TOKEN_SCOPES = {
	ContentRead: "content:read",
	ContentWrite: "content:write",
	MediaRead: "media:read",
	MediaWrite: "media:write",
	SchemaRead: "schema:read",
	SchemaWrite: "schema:write",
	TaxonomiesManage: "taxonomies:manage",
	MenusManage: "menus:manage",
	SettingsRead: "settings:read",
	SettingsManage: "settings:manage",
	McpTools: "mcp:tools",
	Admin: "admin",
} as const;

export type ApiTokenScopeValue = (typeof API_TOKEN_SCOPES)[keyof typeof API_TOKEN_SCOPES];

export async function fetchApiTokens(): Promise<ApiTokenInfo[]> {
	const response = await apiFetch(`${API_BASE}/admin/api-tokens`);
	const result = await parseApiResponse<{ items: ApiTokenInfo[] }>(
		response,
		"Failed to fetch API tokens",
	);
	return result.items;
}

export async function createApiToken(input: CreateApiTokenInput): Promise<ApiTokenCreateResult> {
	const response = await apiFetch(`${API_BASE}/admin/api-tokens`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});

	return parseApiResponse<ApiTokenCreateResult>(response, "Failed to create API token");
}

export async function revokeApiToken(id: string): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/api-tokens/${id}`, {
		method: "DELETE",
	});

	if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to revoke API token`));
}
