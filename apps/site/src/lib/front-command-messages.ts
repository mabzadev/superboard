import type { UserFrontLocale } from "./user-front-catalogs.js";

/**
 * Command palette strings. They live with the lazily loaded palette instead of the shell catalogs
 * so the shell bundle does not carry them.
 */
export const FRONT_COMMAND_MESSAGES = {
	en: {
		title: "Command palette",
		placeholder: "Search pages and actions…",
		results: "Results",
		empty: "No results for “{query}”",
		hint: "↑ ↓ to move · Enter to open · Esc to close",
		"group.recent": "Recent pages",
		"group.actions": "Quick actions",
		"group.pages": "Pages",
		create_dynamic_link: "Create a dynamic link",
		create_email: "Create an email",
		invite_member: "Invite a team member",
		api_keys: "API keys",
		switch_test: "Switch to Test data",
		switch_production: "Switch to Production data",
		theme_dark: "Switch to dark mode",
		theme_light: "Switch to light mode",
		language: "Change language to {language}",
	},
	fr: {
		title: "Palette de commandes",
		placeholder: "Rechercher une page ou une action…",
		results: "Résultats",
		empty: "Aucun résultat pour « {query} »",
		hint: "↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer",
		"group.recent": "Pages récentes",
		"group.actions": "Actions rapides",
		"group.pages": "Pages",
		create_dynamic_link: "Créer un lien dynamique",
		create_email: "Créer un e-mail",
		invite_member: "Inviter un membre de l’équipe",
		api_keys: "Clés API",
		switch_test: "Passer aux données de test",
		switch_production: "Passer aux données de production",
		theme_dark: "Passer en mode sombre",
		theme_light: "Passer en mode clair",
		language: "Changer la langue : {language}",
	},
} as const satisfies Record<UserFrontLocale, Record<string, string>>;

const PLACEHOLDER = /\{(\w+)\}/gu;

export type FrontCommandMessageId = keyof (typeof FRONT_COMMAND_MESSAGES)["en"];

export function frontCommandMessage(
	locale: UserFrontLocale,
	id: FrontCommandMessageId,
	values: Record<string, string> = {},
): string {
	return FRONT_COMMAND_MESSAGES[locale][id].replace(
		PLACEHOLDER,
		(match, name: string) => values[name] ?? match,
	);
}
