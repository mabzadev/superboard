declare module "virtual:emdash/config" {
	import type { I18nConfig } from "./i18n/config.js";
	import type {
		AuthDescriptor,
		AuthProviderDescriptor,
		DatabaseDescriptor,
		StorageDescriptor,
	} from "./index.js";

	interface VirtualConfig {
		database?: DatabaseDescriptor;
		migrations?: import("./database/migrations/policy.js").RuntimeMigrationConfig;
		storage?: StorageDescriptor;
		auth?: AuthDescriptor;
		authProviders?: AuthProviderDescriptor[];
		i18n?: I18nConfig | null;
		toolbar?: "server" | "client" | false;
		siteUrl?: string;
		astroCspEnabled?: boolean;
		trailingSlash?: "always" | "never" | "ignore";
	}

	const config: VirtualConfig;
	export default config;
}

declare module "virtual:emdash/dialect" {
	import type { Dialect, Kysely } from "kysely";

	import type { DatabaseDialectType } from "./db/adapters.js";
	import type { ExecuteCollectionDeletionGuard } from "./db/adapters.js";

	export const createDialect: ((config: unknown) => Dialect) | undefined;
	export const dialectType: DatabaseDialectType | undefined;

	export const createCoalescingDialect: ((config: unknown) => Dialect | null) | undefined;

	export interface RequestScopedDbOpts {
		config: unknown;
		isAuthenticated: boolean;
		endedAuthenticated?: () => boolean;
		isWrite: boolean;
		canUseCachedBinding?: boolean;
		cookies: {
			get(name: string): { value: string } | undefined;
			set(name: string, value: string, options: Record<string, unknown>): void;
		};
		url: URL;
		lastContentWriteAt?: number;
	}
	export interface RequestScopedDb {
		db: Kysely<unknown>;
		commit: () => void;
		close?: () => void;
	}
	export const createRequestScopedDb: (opts: RequestScopedDbOpts) => RequestScopedDb | null;
	export const executeCollectionDeletionGuard: ExecuteCollectionDeletionGuard | undefined;
}

declare module "virtual:emdash/storage" {
	import type { Storage } from "./storage/types.js";

	export const createStorage: ((config: Record<string, unknown>) => Storage) | undefined;
}

declare module "virtual:emdash/object-cache" {
	import type {
		CreateObjectCacheBackendFn,
		ObjectCacheRuntimeConfig,
	} from "./object-cache/types.js";

	export const createObjectCache: CreateObjectCacheBackendFn | undefined;
	export const objectCacheConfig: ObjectCacheRuntimeConfig | undefined;
}

declare module "virtual:emdash/auth" {
	import type { AuthResult } from "./auth/types.js";

	export const authenticate:
		| ((request: Request, config: unknown) => Promise<AuthResult>)
		| undefined;
}

declare module "virtual:emdash/storage" {
	import type { Storage } from "./storage/types.js";

	export const createStorage: ((config: Record<string, unknown>) => Storage) | null;
}

declare module "virtual:emdash/auth" {
	import type { AuthResult } from "./auth/types.js";

	export const authenticate: ((request: Request, config: unknown) => Promise<AuthResult>) | null;
}

declare module "virtual:emdash/plugins" {
	import type { ResolvedPlugin } from "./plugins/types.js";

	export const plugins: ResolvedPlugin[];
}

declare module "virtual:emdash/sandbox-runner" {
	import type { SandboxRunner, SandboxRunnerFactory, SandboxOptions } from "./plugins/types.js";

	export const createSandboxRunner: SandboxRunnerFactory | null;
	export const CloudflareSandboxRunner: (new (options: SandboxOptions) => SandboxRunner) | null;
}

declare module "virtual:emdash/sandboxed-plugins" {
	import type { PluginDescriptor } from "./astro/integration/runtime.js";

	export const sandboxedPlugins: PluginDescriptor[];
}

declare module "virtual:emdash/block-components" {
	export const pluginBlockComponents: Record<string, unknown>;
}

declare module "virtual:emdash/auth-providers" {
	import type { ComponentType } from "react";

	interface AuthProviderEntry {
		id: string;
		label: string;
		LoginButton?: ComponentType;
		LoginForm?: ComponentType;
		SetupStep?: ComponentType<{ onComplete: () => void }>;
	}

	export const authProviders: Record<string, AuthProviderEntry>;
}

declare module "virtual:emdash/wait-until" {
	export const waitUntil: ((promise: Promise<unknown>) => void) | undefined;
}

declare module "virtual:emdash/env" {
	export const env: Record<string, unknown> | undefined;
}

declare module "virtual:emdash/build" {
	export const buildTime: number;
}

declare module "virtual:emdash/scheduler" {
	import type { CreateSchedulerFn } from "./emdash-runtime.js";
	export const createScheduler: CreateSchedulerFn | null;
}

declare module "virtual:emdash/admin-registry" {
	export const pluginAdmins: Record<
		string,
		{
			pages?: Record<string, unknown>;
			widgets?: Record<string, unknown>;
			fields?: Record<string, unknown>;
			contentEditorPanels?: readonly unknown[];
			contentListColumns?: readonly unknown[];
		}
	>;
}
