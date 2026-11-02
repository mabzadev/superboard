import type { EmDashRequestContext } from "./request-context.js";
import { getRequestContext } from "./request-context.js";

type CacheStore = WeakMap<EmDashRequestContext, Map<string, Promise<unknown>>>;

const STORE_KEY = Symbol.for("emdash:request-cache");
const g = globalThis as Record<symbol, unknown>;
const store: CacheStore =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[STORE_KEY] as CacheStore | undefined) ??
	(() => {
		const wm: CacheStore = new WeakMap();
		g[STORE_KEY] = wm;
		return wm;
	})();

export function requestCached<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const ctx = getRequestContext();
	if (!ctx) return fn();

	let cache = store.get(ctx);
	if (!cache) {
		cache = new Map();
		store.set(ctx, cache);
	}

	const existing = cache.get(key);
	if (existing) {
		if (ctx.metrics) ctx.metrics.cacheHits += 1;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- heterogeneous cache; key namespacing guarantees the stored promise resolves to T
		return existing as Promise<T>;
	}
	if (ctx.metrics) ctx.metrics.cacheMisses += 1;

	const promise = Promise.resolve()
		.then(fn)
		.catch((error) => {
			cache.delete(key);
			throw error;
		});
	cache.set(key, promise);
	return promise;
}

export function peekRequestCache<T>(key: string): Promise<T> | undefined {
	const ctx = getRequestContext();
	if (!ctx) return undefined;
	const cache = store.get(ctx);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- heterogeneous cache; caller is responsible for using a T-compatible key
	return cache?.get(key) as Promise<T> | undefined;
}

export function setRequestCacheEntry<T>(key: string, value: T): void {
	const ctx = getRequestContext();
	if (!ctx) return;

	let cache = store.get(ctx);
	if (!cache) {
		cache = new Map();
		store.set(ctx, cache);
	}

	if (cache.has(key)) return;
	cache.set(key, Promise.resolve(value));
}

export function clearRequestCacheEntry(key: string): void {
	const ctx = getRequestContext();
	if (!ctx) return;
	const cache = store.get(ctx);
	cache?.delete(key);
}
