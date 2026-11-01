import type { AbstractIntlMessages } from "next-intl";
import { use } from "react";

type IdentityLocale = "en" | "fr";

const loaders: Record<IdentityLocale, () => Promise<{ default: AbstractIntlMessages }>> = {
	en: () => import("./translations/en.json"),
	fr: () => import("./translations/fr.json"),
};
const loaded: Partial<Record<IdentityLocale, AbstractIntlMessages>> = {};
const pending: Partial<Record<IdentityLocale, Promise<AbstractIntlMessages>>> = {};

function loadIdentityMessages(locale: IdentityLocale): Promise<AbstractIntlMessages> {
	pending[locale] ??= loaders[locale]().then(
		(module) => (loaded[locale] = module.default),
		(error: unknown) => {
			delete pending[locale];
			throw error;
		},
	);
	return pending[locale];
}

/**
 * Loads only the active locale catalogue. The first render suspends inside the plugin
 * view boundary, which is still showing its loading state while the view chunk loads.
 */
export function useIdentityMessages(locale: string): AbstractIntlMessages {
	const language: IdentityLocale = locale === "fr" ? "fr" : "en";
	return loaded[language] ?? use(loadIdentityMessages(language));
}
