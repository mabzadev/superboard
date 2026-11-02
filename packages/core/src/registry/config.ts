import { isDid } from "@atcute/lexicons/syntax";

import type { RegistryConfig, RegistryConfigInput } from "./types.js";

export interface ManifestRegistryConfig {
	aggregatorUrl: string;
	acceptLabelers?: string;
	policy?: {
		minimumReleaseAgeSeconds?: number;
		minimumReleaseAgeExclude?: string[];
	};
}

export function canonicalCapabilitiesForDriftCheck(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry === "string" && entry.length > 0) {
			seen.add(entry);
		}
	}
	return [...seen].toSorted();
}

export function releaseExemptFromMinimumAge(
	exclude: readonly string[] | undefined,
	publisherDid: string,
	slug: string,
): boolean {
	if (!exclude || exclude.length === 0) return false;
	const didLower = publisherDid.toLowerCase();
	const slugLower = slug.toLowerCase();
	const fullDid = `${didLower}/${slugLower}`;

	for (const entry of exclude) {
		if (entry === didLower) return true;
		if (entry === fullDid) return true;
	}
	return false;
}

const DURATION_PATTERN = /^(\d+)(s|m|h|d|w)$/;

const TRAILING_SLASHES = /\/+$/;

const TRAILING_DOT = /\.$/;

const REGISTRY_PACKAGE_SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function parseDurationSeconds(duration: string | number): number {
	if (typeof duration === "number") {
		if (!Number.isFinite(duration) || duration < 0) {
			throw new Error(`Invalid duration: ${duration} (must be a non-negative finite number)`);
		}
		return Math.floor(duration);
	}

	const match = duration.match(DURATION_PATTERN);
	if (!match) {
		throw new Error(
			`Invalid duration format: "${duration}". Use a duration string like "48h", "7d", "30m", or a number of seconds.`,
		);
	}

	const value = parseInt(match[1], 10);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 24 * 60 * 60;
		case "w":
			return value * 7 * 24 * 60 * 60;
		default:
			throw new Error(`Unknown duration unit: ${unit}`);
	}
}

export function validateAggregatorUrl(aggregatorUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(aggregatorUrl);
	} catch {
		throw new Error(`registry.aggregatorUrl is not a valid URL: ${aggregatorUrl}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`registry.aggregatorUrl must use http or https: ${aggregatorUrl}`);
	}
	if (parsed.username || parsed.password) {
		throw new Error("registry.aggregatorUrl must not contain embedded credentials (user:pass@)");
	}

	const rawHostname = parsed.hostname.toLowerCase().replace(TRAILING_DOT, "");
	const hostname =
		rawHostname.startsWith("[") && rawHostname.endsWith("]")
			? rawHostname.slice(1, -1)
			: rawHostname;
	const isLocalhost =
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname.startsWith("::ffff:127.") ||
		hostname.startsWith("::ffff:7f00:");

	if (!import.meta.env.DEV) {
		if (parsed.protocol === "http:") {
			throw new Error(`registry.aggregatorUrl must use https in production: ${aggregatorUrl}`);
		}
		if (isLocalhost) {
			throw new Error(
				`registry.aggregatorUrl points at localhost; allowed only in dev: ${aggregatorUrl}`,
			);
		}
	} else if (parsed.protocol === "http:" && !isLocalhost) {
		throw new Error(
			`registry.aggregatorUrl must use https (http allowed only for localhost in dev): ${aggregatorUrl}`,
		);
	}

	return parsed;
}

export function coerceRegistryConfig(
	input: RegistryConfigInput | undefined,
): RegistryConfig | undefined {
	if (input === undefined) return undefined;
	if (typeof input === "string") return { aggregatorUrl: input };
	return input;
}

export function normalizeRegistryConfig(
	input: RegistryConfigInput | undefined,
): ManifestRegistryConfig | null {
	const config = coerceRegistryConfig(input);
	if (!config) return null;

	const aggregatorUrl = config.aggregatorUrl?.trim();
	if (!aggregatorUrl) {
		throw new Error("registry.aggregatorUrl is required when registry is configured");
	}

	validateAggregatorUrl(aggregatorUrl);

	const out: ManifestRegistryConfig = {
		aggregatorUrl: aggregatorUrl.replace(TRAILING_SLASHES, ""),
	};

	if (config.acceptLabelers) {
		out.acceptLabelers = config.acceptLabelers;
	}

	const policy: ManifestRegistryConfig["policy"] = {};
	let hasPolicy = false;

	if (config.policy?.minimumReleaseAge !== undefined) {
		policy.minimumReleaseAgeSeconds = parseDurationSeconds(config.policy.minimumReleaseAge);
		hasPolicy = true;
	}

	if (config.policy?.minimumReleaseAgeExclude !== undefined) {
		const list = config.policy.minimumReleaseAgeExclude.map((entry) => {
			const trimmed = entry.trim();
			if (!trimmed) {
				throw new Error("registry.policy.minimumReleaseAgeExclude entries cannot be empty");
			}
			const lower = trimmed.toLowerCase();
			const [did, slug, ...extra] = lower.split("/");
			if (
				!did ||
				!isDid(did) ||
				extra.length > 0 ||
				(slug !== undefined && !REGISTRY_PACKAGE_SLUG_PATTERN.test(slug))
			) {
				throw new Error(
					`registry.policy.minimumReleaseAgeExclude entry must be a DID or <did>/<slug>: ${trimmed}`,
				);
			}
			return lower;
		});
		if (list.length > 0) {
			policy.minimumReleaseAgeExclude = list;
			hasPolicy = true;
		}
	}

	if (hasPolicy) {
		out.policy = policy;
	}

	return out;
}
