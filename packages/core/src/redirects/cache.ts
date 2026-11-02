import { after } from "../after.js";
import type { Redirect } from "../database/repositories/redirect.js";
import {
	createSingleFlightCache,
	type SingleFlightCache,
	invalidateSingleFlightCache,
	singleFlightCached,
} from "../utils/single-flight-cache.js";
import type { CompiledPattern } from "./patterns.js";
import { compilePattern, interpolateDestination, matchPattern } from "./patterns.js";

export interface CachedRedirectRule {
	redirect: Redirect;
	compiled: CompiledPattern;
}

export interface CachedRedirects {
	exact: Map<string, Redirect>;
	patterns: CachedRedirectRule[];
}

interface RedirectCacheState {
	redirects: CachedRedirects | null;
	expiresAt: number;
	generation: number;
	refresh: SingleFlightCache<CachedRedirects>;
}

const REDIRECT_CACHE_TTL_MS = 30_000;
const REDIRECT_CACHE_MAX_REFRESH_ATTEMPTS = 3;
const REDIRECT_CACHE_KEY = Symbol.for("emdash:redirect-cache");
const g = globalThis as Record<symbol, unknown>;
const cacheState: RedirectCacheState =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[REDIRECT_CACHE_KEY] as RedirectCacheState | undefined) ??
	(() => {
		const state: RedirectCacheState = {
			redirects: null,
			expiresAt: 0,
			generation: 0,
			refresh: createSingleFlightCache<CachedRedirects>(),
		};
		g[REDIRECT_CACHE_KEY] = state;
		return state;
	})();

export function invalidateRedirectCache(): void {
	cacheState.generation++;
	cacheState.redirects = null;
	cacheState.expiresAt = 0;
	invalidateSingleFlightCache(cacheState.refresh);
}

function getCachedRedirects(): CachedRedirects | null {
	if (cacheState.redirects && Date.now() >= cacheState.expiresAt) {
		invalidateRedirectCache();
	}
	return cacheState.redirects;
}

function compileRedirects(redirects: Redirect[]): CachedRedirects {
	const exact = new Map<string, Redirect>();
	const patterns: CachedRedirectRule[] = [];
	for (const r of redirects) {
		if (r.isPattern) {
			patterns.push({ redirect: r, compiled: compilePattern(r.source) });
		} else {
			exact.set(r.source, r);
		}
	}
	return { exact, patterns };
}

function installCachedRedirects(redirects: CachedRedirects): CachedRedirects {
	cacheState.redirects = redirects;
	cacheState.expiresAt = Date.now() + REDIRECT_CACHE_TTL_MS;
	return cacheState.redirects;
}

export async function loadCachedRedirects(
	load: () => Promise<Redirect[]>,
): Promise<CachedRedirects> {
	for (let attempt = 0; attempt < REDIRECT_CACHE_MAX_REFRESH_ATTEMPTS; attempt++) {
		const cached = getCachedRedirects();
		if (cached) return cached;

		const generation = cacheState.generation;
		const loaded = await singleFlightCached(
			cacheState.refresh,
			async () => compileRedirects(await load()),
			{ anchor: (promise) => after(() => promise), ownerTimeoutMs: 30_000 },
		);

		if (generation === cacheState.generation) {
			return installCachedRedirects(loaded);
		}

		if (attempt === REDIRECT_CACHE_MAX_REFRESH_ATTEMPTS - 1) {
			return loaded;
		}
	}

	throw new Error("Redirect cache refresh exhausted without loading rules");
}

export function matchCachedPatterns(
	rules: CachedRedirectRule[],
	pathname: string,
): { redirect: Redirect; destination: string } | null {
	for (const { redirect, compiled } of rules) {
		const params = matchPattern(compiled, pathname);
		if (params) {
			const dest = interpolateDestination(redirect.destination, params);
			return { redirect, destination: dest };
		}
	}
	return null;
}
