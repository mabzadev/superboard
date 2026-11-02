import type {
	AuthDescriptor,
	DatabaseDescriptor,
	ObjectCacheDescriptor,
	StorageDescriptor,
} from "emdash";

import type { DurableObjectsConfig } from "./db/do-sql-types.js";
import type { PreviewDOConfig } from "./db/do-types.js";

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface D1Config {
	binding: string;

	session?: "disabled" | "auto" | "primary-first";

	bookmarkCookie?: string;

	coalesce?: boolean;
}

export interface HyperdriveConfig {
	binding?: string;

	cachedBinding?: string;

	preferUncachedAfterWriteMs?: number;

	migrationConnectionStringEnv?: string;

	max?: number;
}

export interface R2StorageConfig {
	binding: string;
	publicUrl?: string;
}

export interface AccessConfig {
	teamDomain: string;

	audience?: string;

	audienceEnvVar?: string;

	autoProvision?: boolean;

	defaultRole?: number;

	syncRoles?: boolean;

	roleMapping?: Record<string, number>;
}

export function d1(config: D1Config): DatabaseDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/db/d1",
		config,
		type: "sqlite",
		migrations: {
			entrypoint: "@emdash-cms/cloudflare/db/d1-migrations",
			manifestConfig: { binding: config.binding },
		},
		supportsRequestScope: true,
		supportsCoalescing: true,
		supportsCollectionDeletionGuard: true,
	};
}

export function hyperdrive(config: HyperdriveConfig = {}): DatabaseDescriptor {
	const binding = config.binding ?? "HYPERDRIVE";
	const connectionStringEnv =
		config.migrationConnectionStringEnv ??
		`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${binding.replaceAll("$", "_")}`;
	if (!ENVIRONMENT_VARIABLE_PATTERN.test(connectionStringEnv)) {
		throw new Error("migrationConnectionStringEnv must be a valid environment variable name.");
	}
	return {
		entrypoint: "@emdash-cms/cloudflare/db/hyperdrive",
		config: {
			binding,
			max: config.max,
			...(config.cachedBinding !== undefined ? { cachedBinding: config.cachedBinding } : {}),
			...(config.preferUncachedAfterWriteMs !== undefined
				? { preferUncachedAfterWriteMs: config.preferUncachedAfterWriteMs }
				: {}),
		},
		type: "postgres",
		migrations: {
			entrypoint: "@emdash-cms/cloudflare/db/hyperdrive-migrations",
			manifestConfig: { binding, connectionStringEnv },
		},
		supportsRequestScope: true,
		...(config.cachedBinding &&
		(config.preferUncachedAfterWriteMs === undefined || config.preferUncachedAfterWriteMs > 0)
			? { needsLastContentWriteAt: true }
			: {}),
	};
}

export type { PreviewDOConfig } from "./db/do-types.js";
export type { DurableObjectsConfig } from "./db/do-sql-types.js";

export function durableObjects(config: DurableObjectsConfig): DatabaseDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/db/do-sql",
		config,
		type: "sqlite",
		supportsRequestScope: true,
		supportsCoalescing: true,
		supportsCollectionDeletionGuard: true,
	};
}

export function previewDatabase(config: PreviewDOConfig): DatabaseDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/db/do",
		config,
		type: "sqlite",
	};
}

export function playgroundDatabase(config: PreviewDOConfig): DatabaseDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/db/playground",
		config,
		type: "sqlite",
	};
}

export function r2(config: R2StorageConfig): StorageDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/storage/r2",
		config: { binding: config.binding, publicUrl: config.publicUrl },
	};
}

export function access(config: AccessConfig): AuthDescriptor {
	return {
		type: "cloudflare-access",
		entrypoint: "@emdash-cms/cloudflare/auth",
		config,
	};
}

export function sandbox(): string {
	return "@emdash-cms/cloudflare/sandbox";
}

export interface KVCacheConfig {
	binding: string;
	defaultTtl?: number;
	revalidate?: number;
	timeout?: number;
	keyPrefix?: string;
}

export function kvCache(config: KVCacheConfig): ObjectCacheDescriptor {
	return {
		entrypoint: "@emdash-cms/cloudflare/cache/kv",
		config: {
			binding: config.binding,
			...(config.defaultTtl !== undefined ? { defaultTtl: config.defaultTtl } : {}),
			...(config.revalidate !== undefined ? { revalidate: config.revalidate } : {}),
			...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
			...(config.keyPrefix !== undefined ? { keyPrefix: config.keyPrefix } : {}),
		},
	};
}

export { cloudflareImages, type CloudflareImagesConfig } from "./media/images.js";
export { cloudflareStream, type CloudflareStreamConfig } from "./media/stream.js";

export { cloudflareCache, type CloudflareCacheConfig } from "./cache/config.js";
