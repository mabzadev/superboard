import type { CacheProviderFactory } from "astro";
import { env, waitUntil } from "cloudflare:workers";

const STORED_AT_HEADER = "X-EmDash-Stored-At";
const MAX_AGE_HEADER = "X-EmDash-Max-Age";
const SWR_HEADER = "X-EmDash-SWR";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

const MAX_AGE_REGEX = /max-age=(\d+)/;

const SWR_REGEX = /stale-while-revalidate=(\d+)/;

const INTERNAL_HEADERS = [STORED_AT_HEADER, MAX_AGE_HEADER, SWR_HEADER];

const DEFAULT_BOOKMARK_COOKIE = "__em_d1_bookmark";

export interface CloudflareCacheConfig {
	cacheName?: string;

	bookmarkCookie?: string;

	zoneId?: string;

	zoneIdEnvVar?: string;

	apiToken?: string;

	apiTokenEnvVar?: string;
}

function parseCdnCacheControl(header: string | null): { maxAge: number; swr: number } {
	let maxAge = 0;
	let swr = 0;
	if (!header) return { maxAge, swr };
	const maxAgeMatch = MAX_AGE_REGEX.exec(header);
	if (maxAgeMatch) maxAge = parseInt(maxAgeMatch[1]!, 10) || 0;
	const swrMatch = SWR_REGEX.exec(header);
	if (swrMatch) swr = parseInt(swrMatch[1]!, 10) || 0;
	return { maxAge, swr };
}

function normalizeCacheKey(url: URL): string {
	const normalized = new URL(url.toString());

	const trackingParams = [
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
		"fbclid",
		"gclid",
		"gbraid",
		"wbraid",
		"dclid",
		"msclkid",
		"twclid",
		"_ga",
		"_gl",
	];
	for (const param of trackingParams) {
		normalized.searchParams.delete(param);
	}
	normalized.searchParams.sort();

	return normalized.toString();
}

function resolveEnvValue(explicit: string | undefined, envVarName: string): string | undefined {
	if (explicit) return explicit;
	if (!(envVarName in env)) return undefined;
	const value: unknown = Reflect.get(env, envVarName);
	return typeof value === "string" ? value : undefined;
}

function stripInternalHeaders(response: Response): void {
	for (const header of INTERNAL_HEADERS) {
		response.headers.delete(header);
	}
}

function hasOnlyBookmarkCookies(response: Response, bookmarkCookie: string): boolean {
	const cookies = response.headers.getSetCookie();
	if (cookies.length === 0) return true;
	return cookies.every((c) => c.startsWith(`${bookmarkCookie}=`));
}

function prepareForCache(
	response: Response,
	maxAge: number,
	swr: number,
	bookmarkCookie: string,
): Response | null {
	if (!hasOnlyBookmarkCookies(response, bookmarkCookie)) {
		return null;
	}
	const prepared = new Response(response.body, response);
	prepared.headers.set(STORED_AT_HEADER, String(Date.now()));
	prepared.headers.set(MAX_AGE_HEADER, String(maxAge));
	prepared.headers.set(SWR_HEADER, String(swr));
	prepared.headers.delete("Set-Cookie");
	return prepared;
}

const factory: CacheProviderFactory<CloudflareCacheConfig> = (config) => {
	const cacheName = config?.cacheName ?? "emdash";
	const bookmarkCookie = config?.bookmarkCookie ?? DEFAULT_BOOKMARK_COOKIE;
	const zoneIdEnvVar = config?.zoneIdEnvVar ?? "CF_ZONE_ID";
	const apiTokenEnvVar = config?.apiTokenEnvVar ?? "CF_CACHE_PURGE_TOKEN";

	async function getCache(): Promise<Cache> {
		return caches.open(cacheName);
	}

	return {
		name: "cloudflare-cache-api",

		async onRequest(context, next) {
			if (context.request.method !== "GET") {
				return next();
			}

			const cookieHeader = context.request.headers.get("Cookie") ?? "";
			if (cookieHeader.includes("astro-session=")) {
				return next();
			}

			const cacheKey = normalizeCacheKey(context.url);
			const cache = await getCache();

			const cached = await cache.match(cacheKey);

			if (cached) {
				const storedAt = parseInt(cached.headers.get(STORED_AT_HEADER) ?? "0", 10);
				const maxAge = parseInt(cached.headers.get(MAX_AGE_HEADER) ?? "0", 10);
				const swr = parseInt(cached.headers.get(SWR_HEADER) ?? "0", 10);
				const ageSeconds = (Date.now() - storedAt) / 1000;

				if (ageSeconds < maxAge) {
					const hit = new Response(cached.body, cached);
					hit.headers.set("X-Astro-Cache", "HIT");
					stripInternalHeaders(hit);
					return hit;
				}

				if (swr > 0 && ageSeconds < maxAge + swr) {
					const stale = new Response(cached.body, cached);
					stale.headers.set("X-Astro-Cache", "STALE");
					stripInternalHeaders(stale);

					waitUntil(
						(async () => {
							try {
								const fresh = await next();
								const cdnCC = fresh.headers.get("CDN-Cache-Control");
								const parsed = parseCdnCacheControl(cdnCC);
								if (parsed.maxAge > 0 && fresh.ok) {
									const toStore = prepareForCache(fresh, parsed.maxAge, parsed.swr, bookmarkCookie);
									if (toStore) {
										await cache.put(cacheKey, toStore);
									}
								}
							} catch {}
						})(),
					);

					return stale;
				}

				await cache.delete(cacheKey);
			}

			const response = await next();

			const cdnCC = response.headers.get("CDN-Cache-Control");
			const { maxAge, swr } = parseCdnCacheControl(cdnCC);

			if (maxAge > 0 && response.ok) {
				const toStore = prepareForCache(response.clone(), maxAge, swr, bookmarkCookie);
				if (toStore) {
					await cache.put(cacheKey, toStore);
				}

				const miss = new Response(response.body, response);
				miss.headers.set("X-Astro-Cache", "MISS");
				return miss;
			}

			return response;
		},

		async invalidate(options) {
			if (options.tags) {
				const zoneId = resolveEnvValue(config?.zoneId, zoneIdEnvVar);
				const apiToken = resolveEnvValue(config?.apiToken, apiTokenEnvVar);

				if (!zoneId || !apiToken) {
					throw new Error(
						`[cloudflare-cache-api] Tag-based invalidation requires a Zone ID and API token. ` +
							`Set the ${zoneIdEnvVar} and ${apiTokenEnvVar} environment variables, ` +
							`or pass zoneId/apiToken in the cloudflareCache() config.`,
					);
				}

				const tags = Array.isArray(options.tags) ? options.tags : [options.tags];

				const response = await fetch(`${CF_API_BASE}/zones/${zoneId}/purge_cache`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ tags }),
				});

				if (!response.ok) {
					const body = await response.text().catch(() => "");
					throw new Error(
						`[cloudflare-cache-api] Cache purge failed (${response.status}): ${body}`,
					);
				}
			}

			if (options.path) {
				const cache = await getCache();
				await cache.delete(options.path);
			}
		},
	};
};

export default factory;
