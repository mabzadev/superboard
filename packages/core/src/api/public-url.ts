export interface SiteUrlConfig {
	siteUrl?: string;
}

let _envSiteUrl: string | undefined | null = null;

export function _resetEnvCache(): void {
	_envSiteUrl = null;
	_envAllowedOrigins = null;
}

function getEnvSiteUrl(): string | undefined {
	if (_envSiteUrl !== null) return _envSiteUrl || undefined;
	try {
		const value =
			(typeof process !== "undefined" && process.env?.EMDASH_SITE_URL) ||
			(typeof process !== "undefined" && process.env?.SITE_URL) ||
			"";
		if (value) {
			const parsed = new URL(value);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				_envSiteUrl = "";
				return undefined;
			}
			_envSiteUrl = parsed.origin;
		} else {
			_envSiteUrl = "";
		}
	} catch {
		_envSiteUrl = "";
	}
	return _envSiteUrl || undefined;
}

export function getPublicOrigin(url: URL, config?: SiteUrlConfig): string {
	return getConfiguredOrigin(config) || url.origin;
}

export function getConfiguredOrigin(config?: SiteUrlConfig): string | undefined {
	return config?.siteUrl || getEnvSiteUrl() || undefined;
}

let _envAllowedOrigins: string[] | null = null;

export function getEnvAllowedOrigins(): string[] {
	if (_envAllowedOrigins !== null) return _envAllowedOrigins;
	const raw = typeof process !== "undefined" ? process.env?.EMDASH_ALLOWED_ORIGINS || "" : "";
	const parsed: string[] = [];
	for (const entry of raw.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		let u: URL;
		try {
			u = new URL(trimmed);
		} catch (e) {
			throw new Error(`EmDash config error in EMDASH_ALLOWED_ORIGINS: invalid URL: "${trimmed}"`, {
				cause: e,
			});
		}
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			throw new Error(
				`EmDash config error in EMDASH_ALLOWED_ORIGINS: origin must be http or https: "${trimmed}" (got ${u.protocol})`,
			);
		}
		parsed.push(u.origin);
	}
	_envAllowedOrigins = parsed;
	return parsed;
}

export function getPublicUrl(url: URL, config: SiteUrlConfig | undefined, path: string): string {
	return `${getPublicOrigin(url, config)}${path}`;
}
