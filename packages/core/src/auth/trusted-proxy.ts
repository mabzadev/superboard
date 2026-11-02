import type { EmDashConfig } from "../astro/integration/runtime.js";

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/;

export function normalizeTrustedHeaders(names: readonly string[]): string[] {
	return names
		.map((h) => h.trim().toLowerCase())
		.filter((h) => h.length > 0 && HEADER_NAME_PATTERN.test(h));
}

function isValidHeaderName(name: string): boolean {
	return HEADER_NAME_PATTERN.test(name);
}

let _envCache: string[] | null = null;

export function _resetTrustedProxyHeadersCache(): void {
	_envCache = null;
}

function getEnvTrustedHeaders(): string[] {
	if (_envCache !== null) return _envCache;
	let raw: string | undefined;
	try {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- import.meta.env shape varies by bundler
		const importMetaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })
			.env;
		raw =
			(typeof process !== "undefined" ? process.env?.EMDASH_TRUSTED_PROXY_HEADERS : undefined) ||
			importMetaEnv?.EMDASH_TRUSTED_PROXY_HEADERS;
	} catch {
		raw = undefined;
	}
	if (!raw) {
		_envCache = [];
		return _envCache;
	}
	_envCache = raw
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0 && isValidHeaderName(s));
	return _envCache;
}

export function getTrustedProxyHeaders(config: EmDashConfig | null | undefined): string[] {
	if (config && config.trustedProxyHeaders !== undefined) {
		return config.trustedProxyHeaders
			.map((h) => h.trim().toLowerCase())
			.filter((h) => h.length > 0 && isValidHeaderName(h));
	}
	return getEnvTrustedHeaders();
}
