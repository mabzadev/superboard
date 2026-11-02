export interface LocaleDefinition {
	code: string;
	label: string;
	enabled: boolean;
	dir?: "rtl" | "ltr";
}

export const LOCALES: LocaleDefinition[] = [
	{ code: "en", label: "English", enabled: true },
	{ code: "ar", label: "العربية", enabled: true, dir: "rtl" },
	{ code: "eu", label: "Euskara", enabled: true },
	{ code: "ca", label: "Català", enabled: true },
	{ code: "zh-CN", label: "简体中文", enabled: true },
	{ code: "zh-TW", label: "繁體中文", enabled: true },
	{ code: "cs", label: "Čeština", enabled: true },
	{ code: "nl", label: "Nederlands", enabled: true },
	{ code: "en-GB", label: "English (UK)", enabled: true },
	{ code: "fa", label: "فارسی", enabled: true, dir: "rtl" },
	{ code: "fr", label: "Français", enabled: true },
	{ code: "de", label: "Deutsch", enabled: true },
	{ code: "hi", label: "हिन्दी", enabled: true },
	{ code: "hu", label: "Magyar", enabled: true },
	{ code: "id", label: "Bahasa Indonesia", enabled: true },
	{ code: "ja", label: "日本語", enabled: true },
	{ code: "ko", label: "한국어", enabled: false },
	{ code: "nb", label: "Norsk bokmål", enabled: true },
	{ code: "pl", label: "Polski", enabled: true },
	{ code: "pt-BR", label: "Português (Brasil)", enabled: true },
	{ code: "sr-Latn", label: "Srpski", enabled: true },
	{ code: "es-419", label: "Español (Latinoamérica)", enabled: true },
	{ code: "es-ES", label: "Español (España)", enabled: true },
	{ code: "sv", label: "Svenska", enabled: true },
	{ code: "th", label: "ไทย", enabled: true },
	{ code: "tr", label: "Türkçe", enabled: true },
	{ code: "uk", label: "Українська", enabled: true },
	{ code: "pseudo", label: "Pseudo", enabled: false },
];

export const SOURCE_LOCALE = LOCALES[0]!;

export const LOCALE_CODES = LOCALES.map((l) => l.code);

export const TARGET_LOCALES = LOCALES.slice(1);

export const ENABLED_LOCALES = LOCALES.filter((l) => l.enabled);
