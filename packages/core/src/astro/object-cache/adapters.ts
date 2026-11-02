import type { ObjectCacheDescriptor, ObjectCacheRuntimeConfig } from "../../object-cache/types.js";

export interface MemoryCacheOptions extends ObjectCacheRuntimeConfig {
	maxEntries?: number;
}

export function memoryCache(options: MemoryCacheOptions = {}): ObjectCacheDescriptor {
	return {
		entrypoint: "emdash/object-cache/memory",
		config: { ...options },
	};
}
