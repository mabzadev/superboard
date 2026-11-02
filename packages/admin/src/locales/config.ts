import { ENABLED_LOCALES, LOCALES, SOURCE_LOCALE } from "./locales.js";

export type { LocaleDefinition as SupportedLocale } from "./locales.js";

function isValidLocale(code: string): boolean {
	try {
		const locale = new Intl.Locale(code);
		return locale.baseName !== "";
	} catch {
		if (import.meta.env.DEV) {
			throw new Error(`Invalid locale code: "${code}"`);
		}
		return false;
	}
}

declare const __EMDASH_PSEUDO_LOCALE__: boolean;

const PSEUDO_LOCALE =
	typeof __EMDASH_PSEUDO_LOCALE__ !== "undefined" && __EMDASH_PSEUDO_LOCALE__
		? LOCALES.find((l) => l.code === "pseudo")
		: undefined;

export const SUPPORTED_LOCALES = [
	...ENABLED_LOCALES.filter((l) => isValidLocale(l.code)),
	...(PSEUDO_LOCALE ? [PSEUDO_LOCALE] : []),
];

export const SUPPORTED_LOCALE_CODES = new Set(SUPPORTED_LOCALES.map((l) => l.code));

export const DEFAULT_LOCALE = SOURCE_LOCALE.code;

const BASE_LANGUAGE_MAP = new Map<string, string>();
const SCRIPT_LANGUAGE_MAP = new Map<string, string>();

for (const l of SUPPORTED_LOCALES) {
	const base = l.code.split("-")[0]!.toLowerCase();
	if (!BASE_LANGUAGE_MAP.has(base)) {
		BASE_LANGUAGE_MAP.set(base, l.code);
	}

	const maximized = new Intl.Locale(l.code).maximize();
	if (maximized.script) {
		const scriptKey = `${maximized.language}-${maximized.script}`.toLowerCase();
		if (!SCRIPT_LANGUAGE_MAP.has(scriptKey)) {
			SCRIPT_LANGUAGE_MAP.set(scriptKey, l.code);
		}
	}
}

function matchLocale(tag: string): string | undefined {
	const trimmed = tag.trim();
	if (!trimmed) return undefined;
	let canonical: string;
	try {
		canonical = new Intl.Locale(trimmed).baseName;
	} catch {
		return undefined;
	}

	if (SUPPORTED_LOCALE_CODES.has(canonical)) return canonical;

	const locale = new Intl.Locale(trimmed);
	if (locale.script) {
		const scriptKey = `${locale.language}-${locale.script}`.toLowerCase();
		const scriptMatch = SCRIPT_LANGUAGE_MAP.get(scriptKey);
		if (scriptMatch) return scriptMatch;
	}

	const base = canonical.split("-")[0]!.toLowerCase();
	return BASE_LANGUAGE_MAP.get(base);
}

const LOCALE_LABELS = new Map(SUPPORTED_LOCALES.map((l) => [l.code, l.label]));

export function getLocaleLabel(code: string): string {
	return LOCALE_LABELS.get(code) ?? code.toUpperCase();
}

const LOCALE_DIRS = new Map(SUPPORTED_LOCALES.map((l) => [l.code, l.dir]));

export function getLocaleDir(code: string): "ltr" | "rtl" {
	return LOCALE_DIRS.get(code) ?? "ltr";
}

const LOCALE_COOKIE_RE = /(?:^|;\s*)emdash-locale=([^;]+)/;

export function resolveLocale(request: Request): string {
	const cookieHeader = request.headers.get("cookie") ?? "";
	const cookieMatch = cookieHeader.match(LOCALE_COOKIE_RE);
	const cookieLocale = cookieMatch?.[1]?.trim() ?? "";

	if (SUPPORTED_LOCALE_CODES.has(cookieLocale)) return cookieLocale;

	const acceptLang = request.headers.get("accept-language") ?? "";
	for (const entry of acceptLang.split(",")) {
		const tag = entry.split(";")[0]!.trim();
		const matched = matchLocale(tag);
		if (matched) return matched;
	}

	return DEFAULT_LOCALE;
}
