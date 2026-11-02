import type { CacheProviderConfig } from "astro";

import type { CloudflareCacheConfig } from "./runtime.js";

export type { CloudflareCacheConfig };

let deprecationWarned = false;

export function cloudflareCache(
	config: CloudflareCacheConfig = {},
): CacheProviderConfig<CloudflareCacheConfig> {
	if (!deprecationWarned) {
		deprecationWarned = true;
		console.warn(
			"[@emdash-cms/cloudflare] cloudflareCache() is deprecated. " +
				'Prefer native Workers Caching: wrangler "cache": { "enabled": true } ' +
				"and cacheCloudflare() from @astrojs/cloudflare/cache " +
				"(purge via cache.purge() — no CF_ZONE_ID / CF_CACHE_PURGE_TOKEN). " +
				"See https://docs.emdashcms.com/deployment/cloudflare#workers-cache",
		);
	}
	return {
		entrypoint: "@emdash-cms/cloudflare/cache",
		config,
	};
}
