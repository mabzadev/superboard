export interface I18nConfig {
	defaultLocale: string;
	locales: string[];
	fallback?: Record<string, string>;
	prefixDefaultLocale?: boolean;
}

export const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

const I18N_CONFIG_KEY = Symbol.for("emdash:i18n-config");

function configStore(): Record<symbol, I18nConfig | null | undefined> {
	return globalThis;
}

export function setI18nConfig(config: I18nConfig | null): void {
	configStore()[I18N_CONFIG_KEY] = config;
}

export function getI18nConfig(): I18nConfig | null {
	return configStore()[I18N_CONFIG_KEY] ?? null;
}

export function resolveConfiguredLocale(locale: string): string {
	const config = getI18nConfig();
	return (
		config?.locales.find((configured) => configured.toLowerCase() === locale.toLowerCase()) ??
		locale
	);
}

export function isValidLocaleCode(locale: string): boolean {
	return LOCALE_CODE_PATTERN.test(locale);
}

export function resolveContentCreateLocale(
	locale: unknown,
	config: I18nConfig | null = getI18nConfig(),
): string {
	if (locale !== undefined) {
		if (typeof locale !== "string") {
			throw new Error("Invalid locale code: expected a string");
		}
		if (!isValidLocaleCode(locale)) {
			throw new Error(`Invalid locale code: "${locale}"`);
		}

		const configured = config?.locales.find(
			(candidate) => candidate.toLowerCase() === locale.toLowerCase(),
		);
		if (config && !configured) {
			throw new Error(`Locale "${locale}" is not configured for this site`);
		}
		return configured ?? locale;
	}

	return config?.defaultLocale ?? "en";
}

export function isI18nEnabled(): boolean {
	const config = getI18nConfig();
	return config != null && config.locales.length > 1;
}

export function getFallbackChain(locale: string): string[] {
	const config = getI18nConfig();
	if (!config) return [locale];

	const chain: string[] = [locale];
	let current = locale;
	const visited = new Set<string>([locale]);

	while (config.fallback?.[current]) {
		// eslint-disable-next-line typescript/no-unnecessary-type-assertion -- noUncheckedIndexedAccess
		const next = config.fallback[current]!;
		if (visited.has(next)) break;
		chain.push(next);
		visited.add(next);
		current = next;
	}

	if (!visited.has(config.defaultLocale)) {
		chain.push(config.defaultLocale);
	}

	return chain;
}
