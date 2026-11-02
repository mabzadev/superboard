import type { ManifestHookEntry, ManifestRouteEntry } from "@emdash-cms/plugin-types";

import type { AuthDescriptor, AuthProviderDescriptor } from "../../auth/types.js";
import type { RuntimeMigrationConfig } from "../../database/migrations/policy.js";
import type { DatabaseDescriptor } from "../../db/adapters.js";
import type { MediaProviderDescriptor } from "../../media/types.js";
import type { ObjectCacheDescriptor } from "../../object-cache/types.js";
import type {
	FieldWidgetConfig,
	PluginMcpManifestConfig,
	PortableTextBlockConfig,
	ResolvedPlugin,
	SettingField,
} from "../../plugins/types.js";
import type { ExperimentalConfig } from "../../registry/types.js";
import type { StorageDescriptor } from "../storage/types.js";

export type { ExperimentalConfig, RegistryConfig } from "../../registry/types.js";

export type { ResolvedPlugin };
export type { MediaProviderDescriptor };

export interface PluginAdminPage {
	path: string;
	label: string;
	icon?: string;
}

export interface PluginDashboardWidget {
	id: string;
	size?: "full" | "half" | "third";
	title?: string;
}

export interface StorageCollectionDeclaration {
	indexes?: string[];
	uniqueIndexes?: string[];
}

export interface PluginDescriptor<TOptions = Record<string, unknown>> {
	id: string;
	version: string;
	defaultEnabled?: boolean;
	lifecycleManaged?: boolean;
	lifecycleEnablePath?: string;
	lifecycleDisablePath?: string;
	entrypoint: string;
	options?: TOptions;
	format?: "standard" | "native";
	adminEntry?: string;
	componentsEntry?: string;
	adminPages?: PluginAdminPage[];
	adminWidgets?: PluginDashboardWidget[];
	settingsSchema?: Record<string, SettingField>;
	portableTextBlocks?: PortableTextBlockConfig[];
	fieldWidgets?: FieldWidgetConfig[];

	capabilities?: string[];
	allowedHosts?: string[];
	storage?: Record<string, StorageCollectionDeclaration>;
	mcp?: PluginMcpManifestConfig;
	routes?: Array<ManifestRouteEntry | string>;
	hooks?: Array<ManifestHookEntry | string>;
}

export type SandboxedPluginDescriptor<TOptions = Record<string, unknown>> =
	PluginDescriptor<TOptions>;

export interface EmDashConfig {
	database?: DatabaseDescriptor;
	migrations?: RuntimeMigrationConfig;
	storage?: StorageDescriptor;

	objectCache?: ObjectCacheDescriptor;
	images?: boolean;
	plugins?: PluginDescriptor[];
	sandboxed?: SandboxedPluginDescriptor[];
	sandboxRunner?: string;

	sandbox?: boolean;

	auth?: AuthDescriptor;

	authProviders?: AuthProviderDescriptor[];

	mcp?: boolean;

	marketplace?: string;

	experimental?: ExperimentalConfig;

	maxUploadSize?: number;

	siteUrl?: string;

	allowedOrigins?: string[];
	trustedProxyHeaders?: string[];

	middleware?: {
		outer: string | URL;
	};

	playground?: {
		middlewareEntrypoint: string;
	};

	mediaProviders?: MediaProviderDescriptor[];

	fonts?:
		| false
		| {
				scripts?: string[];
		  };

	admin?: {
		logo?: string;
		siteName?: string;
		favicon?: string;
	};

	toolbar?: "server" | "client" | false;

	astroVersion?: string;
}

const STORED_CONFIG_KEY = Symbol.for("emdash:stored-config");
const configHolder = globalThis as Record<symbol, unknown>;

export function getStoredConfig(): EmDashConfig | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	return (configHolder[STORED_CONFIG_KEY] as EmDashConfig | undefined) ?? null;
}

export function setStoredConfig(config: EmDashConfig): void {
	configHolder[STORED_CONFIG_KEY] = config;
}
