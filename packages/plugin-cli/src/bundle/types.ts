export {
	CAPABILITY_RENAMES,
	capabilitiesToDeclaredAccess,
	declaredAccessToCapabilities,
	isDeprecatedCapability,
	type CurrentPluginCapability,
	type DeclaredAccess,
	type DeprecatedPluginCapability,
	type ManifestHookEntry,
	type ManifestMcpTool,
	type ManifestRouteEntry,
	type PluginMcpManifestConfig,
	type PluginAdminConfig,
	type PluginCapability,
	type PluginManifest,
	type PluginStorageConfig,
	type StorageCollectionConfig,
} from "@emdash-cms/plugin-types";

import type {
	PluginAdminConfig,
	PluginCapability,
	PluginStorageConfig,
} from "@emdash-cms/plugin-types";

export interface ResolvedMcpTool {
	description: string;
	route: string;
	input: unknown;
	output?: unknown;
	destructive?: boolean;
}

export interface ResolvedPlugin {
	id: string;
	version: string;
	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: PluginStorageConfig;
	hooks: Record<
		string,
		{
			handler?: unknown;
			priority?: number;
			timeout?: number;
			dependencies?: string[];
			errorPolicy?: string;
			exclusive?: boolean;
			pluginId?: string;
		}
	>;
	routes: Record<
		string,
		{
			handler?: unknown;
			public?: boolean;
			permission?: string;
		}
	>;
	mcp?: { tools: Record<string, ResolvedMcpTool> };
	admin: PluginAdminConfig;
}
