import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";

export type PluginStatus = "active" | "inactive";
export type PluginSource = "config" | "marketplace" | "registry";

export function isPluginStateEnabled(
	status: string | undefined,
	defaultEnabled: boolean = true,
): boolean {
	return status === "active" || (status === undefined && defaultEnabled);
}

function toPluginStatus(value: string): PluginStatus {
	if (value === "active") return "active";
	return "inactive";
}

function toPluginSource(value: string | undefined | null): PluginSource {
	if (value === "marketplace") return "marketplace";
	if (value === "registry") return "registry";
	return "config";
}

export interface PluginState {
	pluginId: string;
	status: PluginStatus;
	version: string;
	installedAt: Date;
	activatedAt: Date | null;
	deactivatedAt: Date | null;
	source: PluginSource;
	marketplaceVersion: string | null;
	displayName: string | null;
	description: string | null;
	registryPublisherDid: string | null;
	registrySlug: string | null;
	mcpToolsEnabled: boolean;
	mcpToolsConsent: string | null;
}

export class PluginStateRepository {
	constructor(private db: Kysely<Database>) {}

	async get(pluginId: string): Promise<PluginState | null> {
		const row = await this.db
			.selectFrom("_plugin_state")
			.selectAll()
			.where("plugin_id", "=", pluginId)
			.executeTakeFirst();

		if (!row) return null;

		return rowToPluginState(row);
	}

	async getAll(): Promise<PluginState[]> {
		const rows = await this.db.selectFrom("_plugin_state").selectAll().execute();
		return rows.map(rowToPluginState);
	}

	async getMarketplacePlugins(): Promise<PluginState[]> {
		const rows = await this.db
			.selectFrom("_plugin_state")
			.selectAll()
			.where("source", "=", "marketplace")
			.execute();
		return rows.map(rowToPluginState);
	}

	async getRegistryPlugins(): Promise<PluginState[]> {
		const rows = await this.db
			.selectFrom("_plugin_state")
			.selectAll()
			.where("source", "=", "registry")
			.execute();
		return rows.map(rowToPluginState);
	}

	async upsert(
		pluginId: string,
		version: string,
		status: PluginStatus,
		opts?: {
			source?: PluginSource;
			marketplaceVersion?: string;
			displayName?: string;
			description?: string;
			registryPublisherDid?: string;
			registrySlug?: string;
			mcpToolsEnabled?: boolean;
			mcpToolsConsent?: string | null;
		},
	): Promise<PluginState> {
		const now = new Date().toISOString();
		const existing = await this.get(pluginId);

		if (existing) {
			const updates: Record<string, string | number | null> = {
				status,
				version,
			};

			if (status === "active" && existing.status !== "active") {
				updates.activated_at = now;
			} else if (status === "inactive" && existing.status !== "inactive") {
				updates.deactivated_at = now;
			}

			if (opts?.source) updates.source = opts.source;
			if (opts?.marketplaceVersion !== undefined) {
				updates.marketplace_version = opts.marketplaceVersion;
			}
			if (opts?.displayName !== undefined) {
				updates.display_name = opts.displayName;
			}
			if (opts?.description !== undefined) {
				updates.description = opts.description;
			}
			if (opts?.registryPublisherDid !== undefined) {
				updates.registry_publisher_did = opts.registryPublisherDid;
			}
			if (opts?.registrySlug !== undefined) {
				updates.registry_slug = opts.registrySlug;
			}
			if (opts?.mcpToolsEnabled !== undefined) {
				updates.mcp_tools_enabled = opts.mcpToolsEnabled ? 1 : 0;
			}
			if (opts?.mcpToolsConsent !== undefined) {
				updates.mcp_tools_consent = opts.mcpToolsConsent;
			}

			await this.db
				.updateTable("_plugin_state")
				.set(updates)
				.where("plugin_id", "=", pluginId)
				.execute();
		} else {
			await this.db
				.insertInto("_plugin_state")
				.values({
					plugin_id: pluginId,
					status,
					version,
					installed_at: now,
					activated_at: status === "active" ? now : null,
					deactivated_at: null,
					data: null,
					source: opts?.source ?? "config",
					marketplace_version: opts?.marketplaceVersion ?? null,
					display_name: opts?.displayName ?? null,
					description: opts?.description ?? null,
					registry_publisher_did: opts?.registryPublisherDid ?? null,
					registry_slug: opts?.registrySlug ?? null,
					mcp_tools_enabled: opts?.mcpToolsEnabled ? 1 : 0,
					mcp_tools_consent: opts?.mcpToolsConsent ?? null,
				})
				.execute();
		}

		return (await this.get(pluginId))!;
	}

	async enable(pluginId: string, version: string): Promise<PluginState> {
		return this.upsert(pluginId, version, "active");
	}

	async disable(pluginId: string, version: string): Promise<PluginState> {
		return this.upsert(pluginId, version, "inactive");
	}

	async delete(pluginId: string): Promise<boolean> {
		const result = await this.db
			.deleteFrom("_plugin_state")
			.where("plugin_id", "=", pluginId)
			.executeTakeFirst();

		return (result.numDeletedRows ?? 0) > 0;
	}
}

interface PluginStateRow {
	plugin_id: string;
	status: string;
	version: string;
	installed_at: string;
	activated_at: string | null;
	deactivated_at: string | null;
	source: string;
	marketplace_version: string | null;
	display_name: string | null;
	description: string | null;
	registry_publisher_did: string | null;
	registry_slug: string | null;
	mcp_tools_enabled: number;
	mcp_tools_consent: string | null;
}

function rowToPluginState(row: PluginStateRow): PluginState {
	return {
		pluginId: row.plugin_id,
		status: toPluginStatus(row.status),
		version: row.version,
		installedAt: new Date(row.installed_at),
		activatedAt: row.activated_at ? new Date(row.activated_at) : null,
		deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at) : null,
		source: toPluginSource(row.source),
		marketplaceVersion: row.marketplace_version ?? null,
		displayName: row.display_name ?? null,
		description: row.description ?? null,
		registryPublisherDid: row.registry_publisher_did ?? null,
		registrySlug: row.registry_slug ?? null,
		mcpToolsEnabled: row.mcp_tools_enabled === 1,
		mcpToolsConsent: row.mcp_tools_consent ?? null,
	};
}
