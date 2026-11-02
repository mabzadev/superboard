import { getRequestContext } from "../request-context.js";
import { getFallbackChain, getI18nConfig, isI18nEnabled } from "./config.js";

export function resolveLocale(explicit?: string): string | undefined {
	if (explicit !== undefined) return explicit;
	const ctxLocale = getRequestContext()?.locale;
	if (ctxLocale !== undefined) return ctxLocale;
	const cfg = getI18nConfig();
	if (cfg && isI18nEnabled()) return cfg.defaultLocale;
	return undefined;
}

export function resolveLocaleChain(explicit?: string): string[] {
	const locale = resolveLocale(explicit);
	if (locale === undefined) return [];
	if (!isI18nEnabled()) return [locale];
	return getFallbackChain(locale);
}

const REPEATED_SLASHES = /\/{2,}/g;

export function interpolateUrlPattern(options: {
	pattern: string | null;
	collection: string;
	slug: string;
	id: string;
}): string {
	const { pattern, collection, slug, id } = options;
	const basePattern = pattern ?? `/${encodeURIComponent(collection)}/{slug}`;
	let path = basePattern
		.replace("{slug}", encodeURIComponent(slug))
		.replace("{id}", encodeURIComponent(id));
	path = path.replace(REPEATED_SLASHES, "/");
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	if (!path.startsWith("/")) path = `/${path}`;
	return path;
}

export async function localizePath(path: string, locale: string): Promise<string | null> {
	const segment = await resolveLocaleSegment(locale);
	if (segment === undefined) return null;
	if (segment === null || segment === "") return normalizePath(path);
	return normalizePath(`/${segment}${path}`);
}

async function resolveLocaleSegment(locale: string): Promise<string | null | undefined> {
	const i18n = await readAstroI18nConfig();
	if (!i18n || !i18n.locales || i18n.locales.length <= 1) return null;

	const isDefault = locale === i18n.defaultLocale;
	if (isDefault && !i18n.prefixDefaultLocale) return "";

	for (const entry of i18n.locales) {
		if (typeof entry === "string") {
			if (entry === locale) return entry;
		} else if (entry.codes.includes(locale)) {
			return entry.path;
		}
	}

	return undefined;
}

interface AstroI18nConfig {
	defaultLocale: string;
	locales: Array<string | { codes: readonly string[]; path: string }>;
	prefixDefaultLocale?: boolean;
}

let astroI18nCache: AstroI18nConfig | null | undefined;

async function readAstroI18nConfig(): Promise<AstroI18nConfig | null> {
	if (astroI18nCache !== undefined) return astroI18nCache;

	try {
		const mod = (await import("astro:config/server")) as {
			i18n?: {
				defaultLocale: string;
				locales: Array<string | { codes: readonly string[]; path: string }>;
				routing?: { prefixDefaultLocale?: boolean } | string;
			};
		};
		if (!mod.i18n) {
			astroI18nCache = null;
			return null;
		}
		const routing = mod.i18n.routing;
		astroI18nCache = {
			defaultLocale: mod.i18n.defaultLocale,
			locales: mod.i18n.locales,
			prefixDefaultLocale:
				typeof routing === "object" ? (routing.prefixDefaultLocale ?? false) : false,
		};
		return astroI18nCache;
	} catch {
		const cfg = getI18nConfig();
		if (!cfg || !isI18nEnabled()) {
			astroI18nCache = null;
			return null;
		}
		astroI18nCache = {
			defaultLocale: cfg.defaultLocale,
			locales: cfg.locales,
			prefixDefaultLocale: cfg.prefixDefaultLocale,
		};
		return astroI18nCache;
	}
}

export function _resetAstroI18nCacheForTests(): void {
	astroI18nCache = undefined;
}

function normalizePath(path: string): string {
	let p = path.replace(REPEATED_SLASHES, "/");
	if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
	if (!p.startsWith("/")) p = `/${p}`;
	return p;
}
