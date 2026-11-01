import { useOptionalFrontContext } from "@superboard/front-ui/context";

const messages = {
	en: {
		"environment.description": "Manage this environment’s project, team, usage and infrastructure.",
		"environment.sections": "Environment settings sections",
		"tab.general": "General",
		"tab.team": "Team",
		"tab.usage": "Usage",
		"tab.infrastructure": "Infrastructure",
		"general.title": "Project",
		"general.description": "Identity of the project served by this environment.",
		"general.name": "Project name",
		"general.instance": "Instance ID",
		"general.environments": "Environments",
		"general.environmentsDescription":
			"Production and test data sets of this project. The active one is used across the console.",
		"general.production": "Production",
		"general.test": "Test",
		"general.active": "Active",
		"general.deployment": "Deployment",
		"general.console": "Console",
		"general.api": "API",
		"general.maintenance": "Maintenance mode",
		"general.maintenanceDescription":
			"Maintenance mode is a runtime policy returned to each SDK, so it is set per platform.",
		"general.unavailable": "No project is linked to this environment yet.",
		"danger.title": "Danger Zone",
		"danger.description": "Irreversible actions that permanently affect this project.",
		"danger.deleteTitle": "Delete this project",
		"danger.deleteDescription":
			"Permanently remove all links, data, and shared resources. This cannot be undone.",
		"danger.delete": "Delete Project",
		"danger.deleted": "Project deleted",
		"team.title": "Team Members",
		"team.description": "Manage who has access to this project.",
		"team.add": "Add member",
		"team.member": "Member",
		"team.role": "Role",
		"team.invited": "Invited",
		"team.removed": "The user was deleted",
		"usage.title": "Active Users",
		"usage.description": "Daily active users over the selected period.",
		"usage.export": "Export",
		"usage.last7Days": "Last 7 days",
		"usage.last30Days": "Last 30 days",
		"usage.last3Months": "Last 3 months",
		"sdk.title": "SDK & apps",
		"sdk.description":
			"Install the SuperBoard SDKs and register the Web, iOS and Android applications of this project.",
		"sdk.sections": "SDK & apps sections",
		"sdk.libraries": "SDK libraries",
		"sdk.web": "Web",
		"sdk.ios": "iOS",
		"sdk.android": "Android",
	},
	fr: {
		"environment.description":
			"Gérez le projet, l’équipe, l’utilisation et l’infrastructure de cet environnement.",
		"environment.sections": "Sections des paramètres de l’environnement",
		"tab.general": "Général",
		"tab.team": "Équipe",
		"tab.usage": "Utilisation",
		"tab.infrastructure": "Infrastructure",
		"general.title": "Projet",
		"general.description": "Identité du projet servi par cet environnement.",
		"general.name": "Nom du projet",
		"general.instance": "ID de l’instance",
		"general.environments": "Environnements",
		"general.environmentsDescription":
			"Jeux de données de production et de test de ce projet. Celui qui est actif s’applique à toute la console.",
		"general.production": "Production",
		"general.test": "Test",
		"general.active": "Actif",
		"general.deployment": "Déploiement",
		"general.console": "Console",
		"general.api": "API",
		"general.maintenance": "Mode maintenance",
		"general.maintenanceDescription":
			"Le mode maintenance est une politique d’exécution renvoyée à chaque SDK : il se règle par plateforme.",
		"general.unavailable": "Aucun projet n’est encore associé à cet environnement.",
		"danger.title": "Zone de danger",
		"danger.description": "Actions irréversibles qui affectent définitivement ce projet.",
		"danger.deleteTitle": "Supprimer ce projet",
		"danger.deleteDescription":
			"Supprime définitivement tous les liens, données et ressources partagées. Action irréversible.",
		"danger.delete": "Supprimer le projet",
		"danger.deleted": "Projet supprimé",
		"team.title": "Membres de l’équipe",
		"team.description": "Gérez les personnes qui ont accès à ce projet.",
		"team.add": "Ajouter un membre",
		"team.member": "Membre",
		"team.role": "Rôle",
		"team.invited": "Invité",
		"team.removed": "L’utilisateur a été supprimé",
		"usage.title": "Utilisateurs actifs",
		"usage.description": "Utilisateurs actifs par jour sur la période sélectionnée.",
		"usage.export": "Exporter",
		"usage.last7Days": "7 derniers jours",
		"usage.last30Days": "30 derniers jours",
		"usage.last3Months": "3 derniers mois",
		"sdk.title": "SDK et applications",
		"sdk.description":
			"Installez les SDK SuperBoard et enregistrez les applications Web, iOS et Android de ce projet.",
		"sdk.sections": "Sections SDK et applications",
		"sdk.libraries": "Bibliothèques SDK",
		"sdk.web": "Web",
		"sdk.ios": "iOS",
		"sdk.android": "Android",
	},
} as const satisfies Record<"en" | "fr", Record<string, string>>;

export type SettingsMessage = keyof (typeof messages)["en"];

/** Operator-language copy for the core settings front (EN fallback outside the Front shell). */
export function useSettingsI18n() {
	const locale = useOptionalFrontContext()?.locale === "fr" ? "fr" : "en";
	const catalog: Record<SettingsMessage, string> = messages[locale];
	return { locale, t: (id: SettingsMessage) => catalog[id] };
}
