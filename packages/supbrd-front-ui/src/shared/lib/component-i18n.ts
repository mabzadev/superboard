import { useMemo } from "react";

import { useOptionalFrontContext } from "../../context.js";
import { createFrontI18n } from "../../i18n.js";

const english = {
	"table.noResults": "No results found",
	"table.noResultsHint": "Try adjusting your search or filters",
	"filter.platforms": "Platforms",
	"filter.types": "Types",
	"filter.all.platforms": "All",
	"filter.all.ads": "All",
	"filter.quickLinks": "Quick Links",
	"filter.existingUsers": "Existing users",
	"filter.newUsers": "New users",
	"filter.allUsers": "All users",
	"confirm.title": "Are you absolutely sure?",
	"confirm.description": "This action cannot be undone. This will permanently delete the item.",
	"confirm.delete": "Delete",
	"confirm.deleting": "Deleting...",
	"confirm.cancel": "Cancel",
	"dialog.close": "Close",
	"loader.label": "Loading",
	"date.placeholder": "Pick a date range",
	"date.today": "Today",
	"date.lastWeek": "Last week",
	"date.lastMonth": "Last month",
	"date.last3Months": "Last 3 months",
	"notification.genericError": "Something went wrong, please try again",
	"notification.export":
		"We're preparing your CSV. You'll receive an email with a download link valid for 24 hours.",
	"notification.view": "View",
	"redirectRules.title": "Redirect rules required",
	"redirectRules.description":
		"You need to configure redirect rules before creating links or campaigns.",
	"redirectRules.heading": "Set up redirect rules first",
	"redirectRules.body":
		"Before creating links, you need to configure how they behave on each platform. This defines where users are sent when they click your links.",
	"redirectRules.configure": "Configure Redirect Rules",
	"redirectRules.later": "Maybe later",
};

export type ComponentMessage = keyof typeof english;

const french: Record<ComponentMessage, string> = {
	"table.noResults": "Aucun résultat",
	"table.noResultsHint": "Modifiez votre recherche ou vos filtres",
	"filter.platforms": "Plateformes",
	"filter.types": "Types",
	"filter.all.platforms": "Toutes",
	"filter.all.ads": "Tous",
	"filter.quickLinks": "Liens rapides",
	"filter.existingUsers": "Utilisateurs existants",
	"filter.newUsers": "Nouveaux utilisateurs",
	"filter.allUsers": "Tous les utilisateurs",
	"confirm.title": "Voulez-vous vraiment continuer ?",
	"confirm.description": "Cette action est irréversible. L’élément sera définitivement supprimé.",
	"confirm.delete": "Supprimer",
	"confirm.deleting": "Suppression…",
	"confirm.cancel": "Annuler",
	"dialog.close": "Fermer",
	"loader.label": "Chargement",
	"date.placeholder": "Choisir une période",
	"date.today": "Aujourd’hui",
	"date.lastWeek": "Dernière semaine",
	"date.lastMonth": "Dernier mois",
	"date.last3Months": "3 derniers mois",
	"notification.genericError": "Une erreur s’est produite, veuillez réessayer",
	"notification.export":
		"Nous préparons votre fichier CSV. Vous recevrez un e-mail avec un lien de téléchargement valable 24 heures.",
	"notification.view": "Voir",
	"redirectRules.title": "Règles de redirection requises",
	"redirectRules.description":
		"Configurez les règles de redirection avant de créer des liens ou des campagnes.",
	"redirectRules.heading": "Configurez d’abord les règles de redirection",
	"redirectRules.body":
		"Avant de créer des liens, configurez leur comportement sur chaque plateforme. Cela définit où sont envoyés les utilisateurs qui cliquent sur vos liens.",
	"redirectRules.configure": "Configurer les règles de redirection",
	"redirectRules.later": "Plus tard",
};

export type ComponentLocale = "en" | "fr";

export function componentLocale(locale: string | undefined): ComponentLocale {
	return locale?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function componentI18n(locale: string | undefined) {
	const resolved = componentLocale(locale);
	const i18n = createFrontI18n({
		locale: resolved,
		messages: { [resolved]: resolved === "fr" ? french : english },
	});
	return (id: ComponentMessage) => i18n._(id);
}

export function useComponentLocale(): ComponentLocale {
	return componentLocale(useOptionalFrontContext()?.locale);
}

export function useComponentI18n() {
	const locale = useComponentLocale();
	return useMemo(() => componentI18n(locale), [locale]);
}
