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
		"usage.users": "Users",
		"usage.last3Months": "Last 3 months",
		"sdk.title": "SDK & apps",
		"sdk.description":
			"Install the SuperBoard SDKs and register the Web, iOS and Android applications of this project.",
		"sdk.sections": "SDK & apps sections",
		"sdk.libraries": "SDK libraries",
		"sdk.web": "Web",
		"sdk.ios": "iOS",
		"sdk.android": "Android",
		"store.appleTitle": "App Store Server API",
		"store.appleDescription":
			"Lets SuperBoard verify App Store purchases on the server, in the production and test environments. The private key is encrypted when saved and never shown again.",
		"store.googleTitle": "Google Play Developer API",
		"store.googleDescription":
			"Lets SuperBoard verify Google Play purchases on the server, in the production and test environments. The service account key is encrypted when saved and never shown again.",
		"store.configured": "Configured",
		"store.notConfigured": "Not configured",
		"store.loading": "Loading the store credentials…",
		"store.loadError": "The store credentials could not be loaded.",
		"store.retry": "Retry",
		"store.bundleId": "Bundle ID",
		"store.packageName": "Package name",
		"store.keyId": "Key ID",
		"store.issuerId": "Issuer ID",
		"store.appleAppId": "Apple app ID",
		"store.appleAppIdHint": "Numeric App Store ID of the application, shown in App Store Connect.",
		"store.privateKey": "Private key (.p8)",
		"store.serviceAccount": "Service account",
		"store.serviceAccountKey": "Service account key (.json)",
		"store.save": "Save credentials",
		"store.saving": "Saving…",
		"store.replace": "Replace credentials",
		"store.cancel": "Cancel",
		"store.registersIos":
			"Saving also registers the bundle ID and Apple Team ID entered in step 1:",
		"store.registersAndroid":
			"Saving also registers the package name and SHA-256 certificate entered in step 1:",
		"store.missingIosRegistration": "Enter the bundle ID and Apple Team ID in step 1 first.",
		"store.missingAndroidRegistration":
			"Enter the package name and SHA-256 certificate in step 1 first.",
		"store.confirmTitle": "Replace the configured credentials?",
		"store.confirmDescription":
			"Purchase verification uses the new credentials as soon as they are saved. The current credentials cannot be recovered.",
		"store.confirm": "Replace",
		"store.saved": "Store credentials saved",
		"store.errorRequired": "Fill in every field and choose the key file.",
		"store.errorAppleAppId": "The Apple app ID contains digits only.",
		"store.errorAppleKey": "Choose the .p8 private key downloaded from App Store Connect.",
		"store.errorGoogleKey": "Choose the JSON key of a Google Cloud service account.",
		"store.errorBillingCopy":
			"The billing service could not secure a copy of these credentials. The configured credentials were not changed; try again in a few minutes.",
		"store.errorRejected": "The credentials were rejected. Check the key file and the identifiers.",
		"store.errorUnknown":
			"The credentials could not be saved. The configured credentials were not changed.",
		"store.referenceLabel": "Secret reference (optional)",
		"store.referenceHint":
			"Where your team keeps these credentials, for example secret://store/app-store. Purchase verification uses the credentials saved above, not this reference.",
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
		"usage.users": "Utilisateurs",
		"usage.last3Months": "3 derniers mois",
		"sdk.title": "SDK et applications",
		"sdk.description":
			"Installez les SDK SuperBoard et enregistrez les applications Web, iOS et Android de ce projet.",
		"sdk.sections": "Sections SDK et applications",
		"sdk.libraries": "Bibliothèques SDK",
		"sdk.web": "Web",
		"sdk.ios": "iOS",
		"sdk.android": "Android",
		"store.appleTitle": "App Store Server API",
		"store.appleDescription":
			"Permet à SuperBoard de vérifier les achats App Store sur le serveur, dans les environnements de production et de test. La clé privée est chiffrée à l’enregistrement et n’est plus jamais affichée.",
		"store.googleTitle": "Google Play Developer API",
		"store.googleDescription":
			"Permet à SuperBoard de vérifier les achats Google Play sur le serveur, dans les environnements de production et de test. La clé du compte de service est chiffrée à l’enregistrement et n’est plus jamais affichée.",
		"store.configured": "Configuré",
		"store.notConfigured": "Non configuré",
		"store.loading": "Chargement des identifiants du store…",
		"store.loadError": "Impossible de charger les identifiants du store.",
		"store.retry": "Réessayer",
		"store.bundleId": "Bundle ID",
		"store.packageName": "Nom du package",
		"store.keyId": "ID de clé",
		"store.issuerId": "ID d’émetteur",
		"store.appleAppId": "Identifiant Apple de l’app",
		"store.appleAppIdHint":
			"Identifiant numérique App Store de l’application, affiché dans App Store Connect.",
		"store.privateKey": "Clé privée (.p8)",
		"store.serviceAccount": "Compte de service",
		"store.serviceAccountKey": "Clé du compte de service (.json)",
		"store.save": "Enregistrer les identifiants",
		"store.saving": "Enregistrement…",
		"store.replace": "Remplacer les identifiants",
		"store.cancel": "Annuler",
		"store.registersIos":
			"L’enregistrement inscrit aussi le Bundle ID et l’Apple Team ID saisis à l’étape 1 :",
		"store.registersAndroid":
			"L’enregistrement inscrit aussi le nom du package et le certificat SHA-256 saisis à l’étape 1 :",
		"store.missingIosRegistration":
			"Saisissez d’abord le Bundle ID et l’Apple Team ID à l’étape 1.",
		"store.missingAndroidRegistration":
			"Saisissez d’abord le nom du package et le certificat SHA-256 à l’étape 1.",
		"store.confirmTitle": "Remplacer les identifiants configurés ?",
		"store.confirmDescription":
			"La vérification des achats utilise les nouveaux identifiants dès leur enregistrement. Les identifiants actuels ne pourront pas être récupérés.",
		"store.confirm": "Remplacer",
		"store.saved": "Identifiants du store enregistrés",
		"store.errorRequired": "Remplissez tous les champs et choisissez le fichier de clé.",
		"store.errorAppleAppId": "L’identifiant Apple de l’app ne contient que des chiffres.",
		"store.errorAppleKey": "Choisissez la clé privée .p8 téléchargée depuis App Store Connect.",
		"store.errorGoogleKey": "Choisissez la clé JSON d’un compte de service Google Cloud.",
		"store.errorBillingCopy":
			"Le service de facturation n’a pas pu sécuriser une copie de ces identifiants. Les identifiants configurés n’ont pas été modifiés ; réessayez dans quelques minutes.",
		"store.errorRejected":
			"Les identifiants ont été refusés. Vérifiez le fichier de clé et les identifiants saisis.",
		"store.errorUnknown":
			"Les identifiants n’ont pas pu être enregistrés. Les identifiants configurés n’ont pas été modifiés.",
		"store.referenceLabel": "Référence de secret (facultatif)",
		"store.referenceHint":
			"Emplacement où votre équipe conserve ces identifiants, par exemple secret://store/app-store. La vérification des achats utilise les identifiants enregistrés ci-dessus, pas cette référence.",
	},
} as const satisfies Record<"en" | "fr", Record<string, string>>;

export type SettingsMessage = keyof (typeof messages)["en"];

export function useSettingsI18n() {
	const locale = useOptionalFrontContext()?.locale === "fr" ? "fr" : "en";
	const catalog: Record<SettingsMessage, string> = messages[locale];
	return { locale, t: (id: SettingsMessage) => catalog[id] };
}
