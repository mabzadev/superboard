const IPV4_MAPPED_IPV6_DOTTED_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_MAPPED_IPV6_HEX_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV4_TRANSLATED_HEX_PATTERN = /^::ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_EXPANDED_MAPPED_PATTERN =
	/^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const IPV4_COMPATIBLE_HEX_PATTERN = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const NAT64_HEX_PATTERN = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const IPV6_BRACKET_PATTERN = /^\[|\]$/g;

const IPV6_ULA_FC_PATTERN = /^fc[0-9a-f]{2}:/;
const IPV6_ULA_FD_PATTERN = /^fd[0-9a-f]{2}:/;

const TRAILING_DOT_PATTERN = /\.+$/;

const BLOCKED_PATTERNS: Array<{ start: number; end: number }> = [
	{ start: ip4ToNum(127, 0, 0, 0), end: ip4ToNum(127, 255, 255, 255) },
	{ start: ip4ToNum(10, 0, 0, 0), end: ip4ToNum(10, 255, 255, 255) },
	{ start: ip4ToNum(172, 16, 0, 0), end: ip4ToNum(172, 31, 255, 255) },
	{ start: ip4ToNum(192, 168, 0, 0), end: ip4ToNum(192, 168, 255, 255) },
	{ start: ip4ToNum(169, 254, 0, 0), end: ip4ToNum(169, 254, 255, 255) },
	{ start: ip4ToNum(0, 0, 0, 0), end: ip4ToNum(0, 255, 255, 255) },
];

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata.google",
	"::1",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
	"nip.io",
	"sslip.io",
	"xip.io",
	"traefik.me",
	"lvh.me",
	"localtest.me",
];

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function ip4ToNum(a: number, b: number, c: number, d: number): number {
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIpv4(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;

	const nums = parts.map(Number);
	if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;

	return ip4ToNum(nums[0], nums[1], nums[2], nums[3]);
}

export function normalizeIPv6MappedToIPv4(ip: string): string | null {
	let match = ip.match(IPV4_MAPPED_IPV6_HEX_PATTERN);
	if (!match) {
		match = ip.match(IPV4_TRANSLATED_HEX_PATTERN);
	}
	if (!match) {
		match = ip.match(IPV6_EXPANDED_MAPPED_PATTERN);
	}
	if (!match) {
		match = ip.match(IPV4_COMPATIBLE_HEX_PATTERN);
	}
	if (!match) {
		match = ip.match(NAT64_HEX_PATTERN);
	}
	if (match) {
		const high = parseInt(match[1] ?? "", 16);
		const low = parseInt(match[2] ?? "", 16);
		return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
	}
	return null;
}

function isPrivateIp(ip: string): boolean {
	const normalized = ip.toLowerCase();

	if (normalized === "::1" || normalized === "::ffff:127.0.0.1") return true;

	const hexIpv4 = normalizeIPv6MappedToIPv4(normalized);
	if (hexIpv4) return isPrivateIp(hexIpv4);

	const v4Match = normalized.match(IPV4_MAPPED_IPV6_DOTTED_PATTERN);
	const ipv4 = v4Match ? v4Match[1] : normalized;

	const num = parseIpv4(ipv4);
	if (num === null) {
		return (
			normalized.startsWith("fe80:") ||
			IPV6_ULA_FC_PATTERN.test(normalized) ||
			IPV6_ULA_FD_PATTERN.test(normalized)
		);
	}

	return BLOCKED_PATTERNS.some((range) => num >= range.start && num <= range.end);
}

export class SsrfError extends Error {
	code = "SSRF_BLOCKED" as const;

	constructor(message: string) {
		super(message);
		this.name = "SsrfError";
	}
}

const MAX_REDIRECTS = 5;

export function validateExternalUrl(url: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new SsrfError("Invalid URL");
	}

	if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
		throw new SsrfError(`Scheme '${parsed.protocol}' is not allowed`);
	}

	const hostname = parsed.hostname.replace(IPV6_BRACKET_PATTERN, "");

	const normalizedHost = hostname.toLowerCase().replace(TRAILING_DOT_PATTERN, "");

	if (BLOCKED_HOSTNAMES.has(normalizedHost)) {
		throw new SsrfError("URLs targeting internal hosts are not allowed");
	}

	for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
		if (normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)) {
			throw new SsrfError("URLs targeting wildcard DNS services are not allowed");
		}
	}

	if (isPrivateIp(normalizedHost)) {
		throw new SsrfError("URLs targeting private IP addresses are not allowed");
	}

	return parsed;
}

export type DnsResolver = (hostname: string) => Promise<string[]>;

let defaultResolver: DnsResolver | null = null;

export function setDefaultDnsResolver(resolver: DnsResolver | null): DnsResolver | null {
	const previous = defaultResolver;
	defaultResolver = resolver;
	return previous;
}

const DOH_TIMEOUT_MS = 3000;

const DEFAULT_DOH_URL = "https://cloudflare-dns.com/dns-query";

interface DohAnswer {
	data: string;
}

interface DohResponse {
	Status: number;
	Answer: DohAnswer[];
}

function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
	return typeof obj === "object" && obj !== null && key in obj;
}

function parseDohResponse(raw: unknown): DohResponse {
	if (!hasProperty(raw, "Status") || typeof raw.Status !== "number") {
		throw new Error("DoH response missing Status field");
	}
	const answers: DohAnswer[] = [];
	if (hasProperty(raw, "Answer") && Array.isArray(raw.Answer)) {
		for (const entry of raw.Answer) {
			if (hasProperty(entry, "data") && typeof entry.data === "string") {
				answers.push({ data: entry.data });
			}
		}
	}
	return { Status: raw.Status, Answer: answers };
}

export const cloudflareDohResolver: DnsResolver = async (hostname) => {
	async function query(type: "A" | "AAAA"): Promise<string[]> {
		const params = new URLSearchParams({ name: hostname, type });
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);
		try {
			const response = await globalThis.fetch(`${DEFAULT_DOH_URL}?${params.toString()}`, {
				headers: { Accept: "application/dns-json" },
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(`DoH lookup failed: ${response.status}`);
			}
			const raw = await response.json();
			const body = parseDohResponse(raw);
			if (body.Status === 3) return [];
			if (body.Status !== 0) {
				throw new Error(`DoH ${type} lookup failed: rcode=${body.Status}`);
			}
			return body.Answer.map((a) => a.data).filter(isIpLiteral);
		} finally {
			clearTimeout(timeout);
		}
	}

	const [a, aaaa] = await Promise.all([query("A"), query("AAAA")]);
	return [...a, ...aaaa];
};

export async function resolveAndValidateExternalUrl(
	url: string,
	options?: { resolver?: DnsResolver },
): Promise<URL> {
	return (await resolveAndValidateExternalUrlTarget(url, options)).url;
}

export interface ResolvedExternalUrlTarget {
	url: URL;
	addresses: readonly string[];
}

export async function resolveAndValidateExternalUrlTarget(
	url: string,
	options?: { resolver?: DnsResolver },
): Promise<ResolvedExternalUrlTarget> {
	const parsed = validateExternalUrl(url);

	const hostname = parsed.hostname.replace(IPV6_BRACKET_PATTERN, "");

	if (isIpLiteral(hostname)) {
		return { url: parsed, addresses: [hostname] };
	}

	const resolver = options?.resolver ?? defaultResolver ?? cloudflareDohResolver;

	let addresses: string[];
	try {
		addresses = await resolver(hostname);
	} catch (error) {
		throw new SsrfError(
			`Could not resolve hostname: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (addresses.length === 0) {
		throw new SsrfError("Hostname resolved to no addresses");
	}

	for (const ip of addresses) {
		if (!isIpLiteral(ip)) {
			throw new SsrfError("Hostname resolver returned a non-IP address");
		}
		if (isPrivateIp(ip)) {
			throw new SsrfError("Hostname resolves to a private IP address");
		}
	}

	return { url: parsed, addresses };
}

function isIpLiteral(host: string): boolean {
	if (parseIpv4(host) !== null) return true;
	return host.includes(":");
}

const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

export async function ssrfSafeFetch(
	url: string,
	init?: RequestInit,
	options?: { resolver?: DnsResolver },
): Promise<Response> {
	let currentUrl = url;
	let currentInit = init;

	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		await resolveAndValidateExternalUrl(currentUrl, options);

		const response = await globalThis.fetch(currentUrl, {
			...currentInit,
			redirect: "manual",
		});

		if (response.status < 300 || response.status >= 400) {
			return response;
		}

		const location = response.headers.get("Location");
		if (!location) {
			return response;
		}

		const previousOrigin = new URL(currentUrl).origin;
		currentUrl = new URL(location, currentUrl).href;
		const nextOrigin = new URL(currentUrl).origin;

		if (previousOrigin !== nextOrigin && currentInit) {
			currentInit = stripCredentialHeaders(currentInit);
		}
	}

	throw new SsrfError(`Too many redirects (max ${MAX_REDIRECTS})`);
}

export function stripCredentialHeaders(init: RequestInit): RequestInit {
	if (!init.headers) return init;

	const headers = new Headers(init.headers);
	for (const name of CREDENTIAL_HEADERS) {
		headers.delete(name);
	}

	return { ...init, headers };
}
