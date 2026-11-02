import { getEnvAllowedOrigins } from "../api/public-url.js";
import type { EmDashConfig } from "../astro/integration/runtime.js";

export type AllowedOriginSource = "config.allowedOrigins" | "EMDASH_ALLOWED_ORIGINS";

export interface TaggedOrigin {
	origin: string;
	source: AllowedOriginSource;
}

export function getConfiguredAllowedOrigins(config?: EmDashConfig): TaggedOrigin[] {
	const tagged: TaggedOrigin[] = [];
	if (config?.allowedOrigins) {
		for (const origin of config.allowedOrigins) {
			if (origin) tagged.push({ origin, source: "config.allowedOrigins" });
		}
	}
	for (const origin of getEnvAllowedOrigins()) {
		tagged.push({ origin, source: "EMDASH_ALLOWED_ORIGINS" });
	}
	return tagged;
}

export function validateOriginShape(tagged: TaggedOrigin[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const { origin, source } of tagged) {
		let parsed: URL;
		try {
			parsed = new URL(origin);
		} catch (e) {
			throw configError(source, `invalid URL: "${origin}"`, e);
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw configError(
				source,
				`origin must be http or https: "${origin}" (got ${parsed.protocol})`,
			);
		}
		if (parsed.hostname.endsWith(".")) {
			throw configError(
				source,
				`hostname has a trailing dot: "${origin}". Remove the trailing dot — assertion origins from the browser do not include it.`,
			);
		}
		if (parsed.hostname.split(".").includes("")) {
			throw configError(source, `hostname has empty labels: "${origin}"`);
		}
		if (!seen.has(parsed.origin)) {
			seen.add(parsed.origin);
			normalized.push(parsed.origin);
		}
	}
	return normalized;
}

export function validateAllowedOrigins(
	siteUrl: string | undefined,
	tagged: TaggedOrigin[],
): string[] {
	const normalized = validateOriginShape(tagged);
	if (normalized.length === 0) return normalized;

	if (!siteUrl) {
		throw new Error(
			`EmDash config error: allowedOrigins is set (${normalized.length} ${
				normalized.length === 1 ? "entry" : "entries"
			}) but siteUrl is not. Without a canonical siteUrl, rpId is derived from the request hostname, defeating multi-origin passkeys. Set siteUrl in astro.config.mjs or via EMDASH_SITE_URL.`,
		);
	}

	let siteHost: string;
	try {
		siteHost = new URL(siteUrl).hostname;
	} catch (e) {
		throw new Error(`EmDash config error: siteUrl is not a valid URL: "${siteUrl}"`, {
			cause: e,
		});
	}

	if (siteHost.endsWith(".")) {
		throw new Error(
			`EmDash config error: siteUrl "${siteUrl}" has a trailing-dot hostname, which cannot match assertion origins. Remove the trailing dot when using allowedOrigins.`,
		);
	}
	if (isIPLiteralHostname(siteHost)) {
		throw new Error(
			`EmDash config error: siteUrl "${siteUrl}" uses an IP-literal hostname. Multi-origin passkeys require a domain-based siteUrl — IP addresses cannot have valid subdomains for WebAuthn rpId.`,
		);
	}

	for (const { origin, source } of tagged) {
		const h = new URL(origin).hostname;
		if (h !== siteHost && !h.endsWith("." + siteHost)) {
			throw configError(
				source,
				`"${origin}" is not a subdomain of siteUrl "${siteUrl}". Allowed origins must be the same hostname as siteUrl or a subdomain of it.`,
			);
		}
	}

	return normalized;
}

function configError(source: AllowedOriginSource, detail: string, cause?: unknown): Error {
	const err = new Error(`EmDash config error in ${source}: ${detail}`);
	if (cause !== undefined) (err as Error & { cause?: unknown }).cause = cause;
	return err;
}

const IPV4_DOTTED_DECIMAL_RE = /^\d+(\.\d+){3}$/;

function isIPLiteralHostname(h: string): boolean {
	if (h.startsWith("[")) return true;
	return IPV4_DOTTED_DECIMAL_RE.test(h);
}
