export interface ObjectCacheBackend {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, ttlSeconds?: number): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface ObjectCacheDescriptor {
	entrypoint: string;
	config: ObjectCacheRuntimeConfig;
}

export interface ObjectCacheRuntimeConfig {
	defaultTtl?: number;
	revalidate?: number;
	keyPrefix?: string;
	timeout?: number;
	[key: string]: unknown;
}

export type CreateObjectCacheBackendFn = (config: ObjectCacheRuntimeConfig) => ObjectCacheBackend;
