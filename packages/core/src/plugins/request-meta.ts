import type { EmDashConfig } from "../astro/integration/runtime.js";
import { getTrustedProxyHeaders, normalizeTrustedHeaders } from "../auth/trusted-proxy.js";
import type { GeoInfo, RequestMeta } from "./types.js";

interface CfProperties {
	country?: string;
	region?: string;
	city?: string;
}

const IP_PATTERN = /^[\da-fA-F.:]+$/;

function parseFirstForwardedIp(header: string): string | null {
	const first = header.split(",")[0];
	const trimmed = first?.trim();
	if (!trimmed) return null;
	return IP_PATTERN.test(trimmed) ? trimmed : null;
}

function readIpFromHeader(headers: Headers, name: string): string | null {
	const value = headers.get(name);
	if (!value) return null;
	if (name.endsWith("forwarded-for")) {
		return parseFirstForwardedIp(value);
	}
	const trimmed = value.trim();
	if (!trimmed) return null;
	return IP_PATTERN.test(trimmed) ? trimmed : null;
}

function getCfObject(request: Request): CfProperties | undefined {
	return (request as unknown as { cf?: CfProperties }).cf;
}

function extractGeo(cf: CfProperties | undefined): GeoInfo | null {
	if (!cf) return null;

	const country = cf.country ?? null;
	const region = cf.region ?? null;
	const city = cf.city ?? null;

	if (country === null && region === null && city === null) return null;

	return { country, region, city };
}

export function extractRequestMeta(
	request: Request,
	configOrTrustedHeaders?: EmDashConfig | null | { trustedProxyHeaders?: string[] } | string[],
): RequestMeta {
	const headers = request.headers;
	const cf = getCfObject(request);
	const trusted = resolveTrustedHeaders(configOrTrustedHeaders);

	let ip: string | null = null;

	if (cf) {
		const cfIp = headers.get("cf-connecting-ip")?.trim();
		if (cfIp && IP_PATTERN.test(cfIp)) {
			ip = cfIp;
		}
		if (!ip) {
			const xff = headers.get("x-forwarded-for");
			ip = xff ? parseFirstForwardedIp(xff) : null;
		}
	}

	if (!ip) {
		for (const name of trusted) {
			const value = readIpFromHeader(headers, name);
			if (value) {
				ip = value;
				break;
			}
		}
	}

	const userAgent = headers.get("user-agent")?.trim() || null;
	const referer = headers.get("referer")?.trim() || null;
	const geo = extractGeo(cf);

	return { ip, userAgent, referer, geo };
}

function resolveTrustedHeaders(
	value: EmDashConfig | null | { trustedProxyHeaders?: string[] } | string[] | undefined,
): string[] {
	if (Array.isArray(value)) {
		return normalizeTrustedHeaders(value);
	}
	return getTrustedProxyHeaders(value);
}

const SANDBOX_STRIPPED_HEADERS = new Set([
	"cookie",
	"set-cookie",
	"authorization",
	"proxy-authorization",
	"cf-access-jwt-assertion",
	"cf-access-client-id",
	"cf-access-client-secret",
	"x-emdash-request",
]);

export function sanitizeHeadersForSandbox(headers: Headers): Record<string, string> {
	const safe: Record<string, string> = {};
	headers.forEach((value, key) => {
		if (!SANDBOX_STRIPPED_HEADERS.has(key)) {
			safe[key] = value;
		}
	});
	return safe;
}
