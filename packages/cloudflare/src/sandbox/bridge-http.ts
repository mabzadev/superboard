const MAX_REDIRECTS = 5;

const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata.google"]);

const BLOCKED_HOSTNAME_SUFFIXES = [
	"nip.io",
	"sslip.io",
	"xip.io",
	"traefik.me",
	"lvh.me",
	"localtest.me",
	"localhost",
];

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
	[ip4(127, 0, 0, 0), ip4(127, 255, 255, 255)],
	[ip4(10, 0, 0, 0), ip4(10, 255, 255, 255)],
	[ip4(172, 16, 0, 0), ip4(172, 31, 255, 255)],
	[ip4(192, 168, 0, 0), ip4(192, 168, 255, 255)],
	[ip4(169, 254, 0, 0), ip4(169, 254, 255, 255)],
	[ip4(0, 0, 0, 0), ip4(0, 255, 255, 255)],
];

function ip4(a: number, b: number, c: number, d: number): number {
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const IPV6_BRACKET_PATTERN = /^\[|\]$/g;

const TRAILING_DOT_PATTERN = /\.+$/;

const IPV6_ULA_FC_PATTERN = /^fc[0-9a-f]{2}:/;
const IPV6_ULA_FD_PATTERN = /^fd[0-9a-f]{2}:/;

const IPV4_MAPPED_IPV6_HEX_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function parseIpv4(ip: string): number | null {
	const m = IPV4_PATTERN.exec(ip);
	if (!m) return null;
	const parts = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
	if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
	return ip4(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

function normalizeIPv4MappedIPv6(ip: string): string | null {
	const match = IPV4_MAPPED_IPV6_HEX_PATTERN.exec(ip);
	if (!match) return null;
	const high = parseInt(match[1]!, 16);
	const low = parseInt(match[2]!, 16);
	return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

function isPrivateLiteral(hostname: string): boolean {
	const bare = hostname.replace(IPV6_BRACKET_PATTERN, "").toLowerCase();
	if (bare === "::1" || bare === "::ffff:127.0.0.1") return true;

	const mapped = normalizeIPv4MappedIPv6(bare);
	if (mapped !== null) {
		const num = parseIpv4(mapped);
		if (num !== null) {
			return BLOCKED_IPV4_RANGES.some(([start, end]) => num >= start && num <= end);
		}
	}

	const num = parseIpv4(bare);
	if (num !== null) {
		return BLOCKED_IPV4_RANGES.some(([start, end]) => num >= start && num <= end);
	}

	if (bare.includes(":")) {
		return (
			bare.startsWith("fe80:") || IPV6_ULA_FC_PATTERN.test(bare) || IPV6_ULA_FD_PATTERN.test(bare)
		);
	}
	return false;
}

function isBlockedHostname(hostname: string): boolean {
	const normalised = hostname
		.replace(IPV6_BRACKET_PATTERN, "")
		.replace(TRAILING_DOT_PATTERN, "")
		.toLowerCase();

	if (BLOCKED_HOSTNAMES.has(normalised)) return true;
	for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
		if (normalised === suffix || normalised.endsWith(`.${suffix}`)) return true;
	}
	return false;
}

function isHostAllowed(host: string, allowedHosts: string[]): boolean {
	const normHost = host.replace(TRAILING_DOT_PATTERN, "").toLowerCase();
	return allowedHosts.some((pattern) => {
		const p = pattern.replace(TRAILING_DOT_PATTERN, "").toLowerCase();
		if (p === "*") return true;
		if (p.startsWith("*.")) {
			const suffix = p.slice(1);
			return normHost.endsWith(suffix) || normHost === p.slice(2);
		}
		return normHost === p;
	});
}

function stripCredentialHeaders(init: RequestInit): RequestInit {
	if (!init.headers) return init;
	const headers = new Headers(init.headers);
	for (const name of CREDENTIAL_HEADERS) {
		headers.delete(name);
	}
	return { ...init, headers };
}

export interface SandboxHttpFetchOptions {
	capabilities: string[];
	allowedHosts: string[];
	fetchImpl?: typeof fetch;
}

export interface SandboxHttpFetchResult {
	status: number;
	headers: Record<string, string>;
	text: string;
}

export async function sandboxHttpFetch(
	url: string,
	init: RequestInit | undefined,
	options: SandboxHttpFetchOptions,
): Promise<SandboxHttpFetchResult> {
	const { capabilities, allowedHosts } = options;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	const hasUnrestricted = capabilities.includes("network:request:unrestricted");
	const hasFetch = capabilities.includes("network:request") || hasUnrestricted;
	if (!hasFetch) {
		throw new Error("Missing capability: network:request");
	}

	if (!hasUnrestricted && allowedHosts.length === 0) {
		throw new Error(
			"Plugin has no allowed hosts configured. Add hosts to allowedHosts to enable HTTP requests.",
		);
	}

	let currentUrl = url;
	let currentInit: RequestInit | undefined = init;

	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		const parsed = new URL(currentUrl);
		const hostname = parsed.hostname;

		if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
			throw new Error(`Unsupported scheme: ${parsed.protocol}`);
		}

		if (isPrivateLiteral(hostname) || isBlockedHostname(hostname)) {
			throw new Error(`Blocked fetch to internal host: ${hostname}`);
		}

		if (!hasUnrestricted && !isHostAllowed(hostname, allowedHosts)) {
			throw new Error(`Host not allowed: ${hostname}`);
		}

		const response = await fetchImpl(currentUrl, {
			...currentInit,
			redirect: "manual",
		});

		if (response.status < 300 || response.status >= 400) {
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});
			return {
				status: response.status,
				headers,
				text: await response.text(),
			};
		}

		const location = response.headers.get("Location");
		if (!location) {
			const headers: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				headers[key] = value;
			});
			return {
				status: response.status,
				headers,
				text: await response.text(),
			};
		}

		const previousOrigin = parsed.origin;
		currentUrl = new URL(location, currentUrl).href;
		const nextOrigin = new URL(currentUrl).origin;
		if (previousOrigin !== nextOrigin && currentInit) {
			currentInit = stripCredentialHeaders(currentInit);
		}
	}

	throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}
