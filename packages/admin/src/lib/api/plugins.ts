import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import { API_BASE, apiFetch, parseApiResponse, throwResponseError } from "./client.js";

export interface PluginInfo {
	id: string;
	name: string;
	version: string;
	package?: string;
	enabled: boolean;
	status: "installed" | "active" | "inactive";
	capabilities: string[];
	hasAdminPages: boolean;
	hasDashboardWidgets: boolean;
	hasHooks: boolean;
	hasSettings: boolean;
	installedAt?: string;
	activatedAt?: string;
	deactivatedAt?: string;
	source?: "config" | "marketplace" | "registry";
	lifecycleManaged?: boolean;
	lifecycleEnablePath?: string;
	lifecycleDisablePath?: string;
	configurationWhileDisabled?: boolean;
	configurationId?: string;
	lifecycleLocked?: boolean;
	marketplaceVersion?: string;
	registryPublisherDid?: string;
	registrySlug?: string;
	description?: string;
	iconUrl?: string;
	mcpToolsEnabled?: boolean;
	mcpTools?: Array<{
		name: string;
		description: string;
		route: string;
		permission: string;
		destructive: boolean;
	}>;
}

export async function fetchPlugins(): Promise<PluginInfo[]> {
	const response = await apiFetch(`${API_BASE}/admin/plugins`);
	const result = await parseApiResponse<{ items: PluginInfo[] }>(
		response,
		i18n._(msg`Failed to fetch plugins`),
	);
	return result.items;
}

export async function fetchPlugin(pluginId: string): Promise<PluginInfo> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}`);
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error(i18n._(msg`Plugin "${pluginId}" not found`));
		}
		await throwResponseError(response, i18n._(msg`Failed to fetch plugin`));
	}
	const result = await parseApiResponse<{ item: PluginInfo }>(
		response,
		i18n._(msg`Failed to fetch plugin`),
	);
	return result.item;
}

interface BaseSettingField {
	label: string;
	description?: string;
}

export type SettingField =
	| (BaseSettingField & { type: "string"; default?: string; multiline?: boolean })
	| (BaseSettingField & { type: "number"; default?: number; min?: number; max?: number })
	| (BaseSettingField & { type: "boolean"; default?: boolean })
	| (BaseSettingField & {
			type: "select";
			options: Array<{ value: string; label: string }>;
			default?: string;
	  })
	| (BaseSettingField & { type: "secret" })
	| (BaseSettingField & { type: "url"; default?: string; placeholder?: string })
	| (BaseSettingField & { type: "email"; default?: string; placeholder?: string });

export interface PluginSettingsResponse {
	schema: Record<string, SettingField>;
	values: Record<string, unknown>;
	secretsSet: Record<string, boolean>;
}

export async function fetchPluginSettings(pluginId: string): Promise<PluginSettingsResponse> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}/settings`);
	return parseApiResponse<PluginSettingsResponse>(
		response,
		i18n._(msg`Failed to fetch plugin settings`),
	);
}

export async function updatePluginSettings(
	pluginId: string,
	values: Record<string, unknown>,
): Promise<PluginSettingsResponse> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}/settings`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ values }),
	});
	return parseApiResponse<PluginSettingsResponse>(
		response,
		i18n._(msg`Failed to update plugin settings`),
	);
}

export async function enablePlugin(plugin: PluginInfo): Promise<PluginInfo> {
	const path =
		plugin.lifecycleManaged && plugin.lifecycleEnablePath
			? plugin.lifecycleEnablePath
			: `${API_BASE}/admin/plugins/${plugin.id}/enable`;
	const response = await apiFetch(path, {
		method: "POST",
		...(plugin.lifecycleManaged ? { headers: { "Idempotency-Key": crypto.randomUUID() } } : {}),
	});
	if (plugin.lifecycleManaged) {
		if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to enable plugin`));
		announceManagedPluginChange(plugin.id);
		return { ...plugin, enabled: true, status: "active" };
	}
	const result = await parseApiResponse<{ item: PluginInfo }>(
		response,
		i18n._(msg`Failed to enable plugin`),
	);
	return result.item;
}

export async function disablePlugin(plugin: PluginInfo): Promise<PluginInfo> {
	const path =
		plugin.lifecycleManaged && plugin.lifecycleDisablePath
			? plugin.lifecycleDisablePath
			: `${API_BASE}/admin/plugins/${plugin.id}/disable`;
	const response = await apiFetch(path, {
		method: "POST",
		...(plugin.lifecycleManaged ? { headers: { "Idempotency-Key": crypto.randomUUID() } } : {}),
	});
	if (plugin.lifecycleManaged) {
		if (!response.ok) await throwResponseError(response, i18n._(msg`Failed to disable plugin`));
		announceManagedPluginChange(plugin.id);
		return { ...plugin, enabled: false, status: "inactive" };
	}
	const result = await parseApiResponse<{ item: PluginInfo }>(
		response,
		i18n._(msg`Failed to disable plugin`),
	);
	return result.item;
}

export async function setPluginMcpEnabled(pluginId: string, enabled: boolean): Promise<void> {
	const response = await apiFetch(`${API_BASE}/admin/plugins/${pluginId}/mcp`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ enabled }),
	});
	if (!response.ok) {
		await throwResponseError(response, i18n._(msg`Failed to update plugin MCP access`));
	}
}

function announceManagedPluginChange(pluginId: string): void {
	if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
	const channel = new BroadcastChannel("superboard-plugin-lifecycle");
	try {
		// oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel is origin-scoped and has no targetOrigin parameter.
		channel.postMessage({ type: "plugin-state-changed", plugin_id: pluginId });
	} finally {
		channel.close();
	}
}
