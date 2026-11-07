import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { Fragment, createElement, useMemo, type ReactNode } from "react";

const messages = {
	en: {
		"libraries.title": "Libraries",
		"libraries.description":
			"Source version, latest release and installation of each SuperBoard SDK.",
		"libraries.loadError": "Unable to load the library catalogue",
		"libraries.unavailable": "Catalogue unavailable",
		"libraries.refresh": "Refresh",
		"git.title": "Git is the release authority",
		"git.description":
			"Source versions are changed by pull request. Production applications use only immutable release references; this back-office never rewrites package source or creates an unreviewed tag.",
		"status.unreleased": "Not published",
		"status.archived": "Archived",
		"status.internal": "Internal",
		"status.pending": "Release pending",
		"status.released": "Released",
		"version.source": "Source",
		"version.latest": "Latest release",
		"version.lifecycle": "Lifecycle",
		"candidate.badge": "Migration candidate",
		"candidate.note":
			"Planned for source version {version}; the immutable release below remains the production baseline until promotion.",
		"distribution.public": "Public metadata",
		"distribution.authentication": "Authentication required",
		"distribution.anonymous": "Anonymous install unavailable",
		"distribution.note":
			"The package record is public, but the registry rejects unauthenticated downloads. Configure {variables} before using the dependency command.",
		"distribution.variables": "{token} and {username}",
		"source.open": "Open source on {branch}",
		"source.version": "Version authority",
		"source.license": "{license} license",
		"ref.label": "Immutable ref",
		"ref.copy": "Copy {name} release ref",
		"ref.copied": "Release ref copied",
		"install.historical": "Historical dependency",
		"install.authenticated": "Authenticated dependency command",
		"install.default": "Installation",
		"install.warning":
			"This command alone is insufficient; configure the authenticated registry shown above first.",
		"install.copy": "Copy {name} installation",
		"install.copied": "Installation copied",
		"install.dependencyCopied": "Dependency command copied",
		"custom.title": "FlutterFlow custom code",
		"custom.description":
			"Reusable widgets, actions and event streams maintained in the SuperBoard monorepo; application projects keep only thin UI adapters.",
		"custom.counts":
			"{widgets} widgets · {actions} actions · {streams} event streams · {files} Git source files",
		"custom.widgets": "Widgets",
		"custom.actions": "Actions",
		"custom.streams": "Event streams",
		"custom.sourceFiles": "Git source files",
		"custom.adapters": "Reference-only UI adapters",
		"custom.adaptersNote":
			"These adapters belong to the acceptance application. They may compose public library calls but must not copy an HTTP, authentication or business protocol.",
		"custom.compatibility": "Compatibility only",
		"custom.releaseWorkflow": "Open controlled SDK release workflow",
		"flutterflow.title": "FlutterFlow library project · {name}",
		"flutterflow.description":
			"Git-managed reusable adapters deployed to FlutterFlow only after every SDK dependency has an immutable release tag.",
		"flutterflow.status": "Synchronization",
		"flutterflow.ready": "Ready to sync",
		"flutterflow.pendingOne": "{count} immutable tag pending",
		"flutterflow.pendingOther": "{count} immutable tags pending",
		"flutterflow.values": "Library values",
		"flutterflow.actions": "Custom actions",
		"flutterflow.tokenState": "Token App State",
		"flutterflow.forbidden": "Forbidden",
		"flutterflow.releases": "Required releases",
		"flutterflow.published": "Published",
		"flutterflow.pending": "Pending",
		"flutterflow.remote": "Remote project configuration",
		"flutterflow.remoteDetails":
			"Project ID: GitHub variable {variable} · API credential: environment secret {secret} · Environment: {environment}",
		"flutterflow.dsl": "Open Git-owned DSL",
		"flutterflow.workflow": "Open controlled update workflow",
		"advanced.title": "Advanced",
		"advanced.description":
			"Repository sources, release workflows and remote project settings, for maintainers.",
		"step.registerApp": "Register App",
		"step.registerDomain": "Register Domain",
		"step.urlScheme": "URL Scheme",
		"step.intentFilters": "Intent Filters",
		"step.addSdk": "Add the SDK",
		"step.push": "Push Notifications",
		"step.store": "Store Integration",
		"step.initialize": "Initialize SDK",
		"step.integrate": "Integrate the SDK",
		"step.default": "Complete this SDK integration step.",
		"step.ios.0": "Register the bundle and Apple development team used by your application.",
		"step.ios.1": "Declare the URL scheme used to return customers to the correct screen.",
		"step.ios.2": "Install the native SuperBoard package with Swift Package Manager.",
		"step.ios.3": "Connect APNs so messaging and link attribution can continue after install.",
		"step.ios.4":
			"Connect server-side App Store purchase events without exposing credentials in the app.",
		"step.ios.5": "Initialize SuperBoard once during application startup.",
		"step.android.0": "Register the Android package and signing certificate.",
		"step.android.1": "Declare verified intent filters for web and application deep links.",
		"step.android.2": "Add the SuperBoard Android package to your Gradle build.",
		"step.android.3": "Connect Firebase Cloud Messaging for attribution and support notifications.",
		"step.android.4":
			"Connect server-side Google Play purchase events without shipping credentials.",
		"step.android.5": "Initialize SuperBoard once from the Application class.",
		"step.web.0": "Register the public domain allowed to initialize the Web SDK.",
		"step.web.1": "Install the SuperBoard Web package with your package manager.",
		"step.web.2": "Initialize the SDK once and forward client-side navigation events.",
		"wizard.intro":
			"Complete the {count}-step {platform} SDK integration and verify it against this project.",
		"wizard.sdk": "{platform} SDK",
		"wizard.saved": "{platform} setup saved",
		"wizard.verified": "SDK configuration verified",
		"wizard.removed": "SDK configuration removed",
		"wizard.reload": "Reload",
		"wizard.remove": "Remove setup",
		"wizard.removeTitle": "Remove the {platform} setup?",
		"wizard.removeDescription":
			"The registration, runtime policy and progress saved for this platform are deleted. This cannot be undone.",
		"wizard.removeConfirm": "Remove",
		"wizard.cancel": "Cancel",
		"status.loading": "Loading…",
		"status.configured": "Configured",
		"status.verified": "Verified",
		"status.error": "Error",
		"status.notConfigured": "Not configured",
		optional: "Optional",
		"registration.title": "Registration",
		"registration.description": "Identifiers SuperBoard uses to recognise this application.",
		"field.bundleId": "Bundle ID",
		"field.teamId": "Apple Team ID",
		"field.packageName": "Package name",
		"field.sha256": "SHA-256 certificate",
		"field.domain": "Application domain",
		"runtime.title": "Runtime policy",
		"runtime.description":
			"Maintenance and update policy returned to the SDK. Leave versions empty to disable update enforcement.",
		"runtime.minimumVersion": "Minimum version",
		"runtime.recommendedVersion": "Recommended version",
		"runtime.storeUrl": "Store URL",
		"runtime.maintenance": "Maintenance mode",
		"runtime.maintenanceDescription": "Takes priority over update prompts for this platform.",
		"runtime.maintenanceMessage": "Maintenance message",
		"runtime.maintenancePlaceholder": "The service is temporarily unavailable.",
		"push.label": "Push secret reference",
		"push.hint":
			"Save only a Secret Store or operator-managed reference. The API rejects credential values and private key material.",
		"scope.title": "Project-scoped configuration",
		"scope.description":
			"These instructions use the selected project and environment. Switching projects resets the setup context.",
		"sidebar.complete": "{count}/{total} complete",
		"sidebar.exit": "Exit guide",
		"nav.back": "Back",
		"nav.step": "Step {current} of {total}",
		"nav.skip": "Skip",
		"nav.saving": "Saving…",
		"nav.saveFinish": "Save & Finish",
		"nav.finish": "Finish Setup",
		"nav.saveContinue": "Save & Continue",
		"nav.continue": "Continue",
	},
	fr: {
		"libraries.title": "Bibliothèques",
		"libraries.description":
			"Version source, dernière version publiée et installation de chaque SDK SuperBoard.",
		"libraries.loadError": "Impossible de charger le catalogue des bibliothèques",
		"libraries.unavailable": "Catalogue indisponible",
		"libraries.refresh": "Actualiser",
		"git.title": "Git fait foi pour les versions",
		"git.description":
			"Les versions sources changent par pull request. Les applications en production n’utilisent que des références de version immuables ; cette console ne réécrit jamais les sources d’un package et ne crée aucun tag non relu.",
		"status.unreleased": "Non publiée",
		"status.archived": "Archivée",
		"status.internal": "Interne",
		"status.pending": "Publication en attente",
		"status.released": "Publiée",
		"version.source": "Source",
		"version.latest": "Dernière version publiée",
		"version.lifecycle": "Cycle de vie",
		"candidate.badge": "Candidat à la migration",
		"candidate.note":
			"Prévu pour la version source {version} ; la version immuable ci-dessous reste la référence de production jusqu’à sa promotion.",
		"distribution.public": "Métadonnées publiques",
		"distribution.authentication": "Authentification requise",
		"distribution.anonymous": "Installation anonyme impossible",
		"distribution.note":
			"La fiche du package est publique, mais le registre refuse les téléchargements non authentifiés. Configurez {variables} avant d’utiliser la commande de dépendance.",
		"distribution.variables": "{token} et {username}",
		"source.open": "Ouvrir la source sur {branch}",
		"source.version": "Source de la version",
		"source.license": "Licence {license}",
		"ref.label": "Référence immuable",
		"ref.copy": "Copier la référence de version de {name}",
		"ref.copied": "Référence de version copiée",
		"install.historical": "Dépendance historique",
		"install.authenticated": "Commande de dépendance authentifiée",
		"install.default": "Installation",
		"install.warning":
			"Cette commande ne suffit pas : configurez d’abord le registre authentifié indiqué ci-dessus.",
		"install.copy": "Copier l’installation de {name}",
		"install.copied": "Installation copiée",
		"install.dependencyCopied": "Commande de dépendance copiée",
		"custom.title": "Code personnalisé FlutterFlow",
		"custom.description":
			"Widgets, actions et flux d’événements réutilisables maintenus dans le monorepo SuperBoard ; les projets d’application ne gardent que de fins adaptateurs d’interface.",
		"custom.counts":
			"{widgets} widgets · {actions} actions · {streams} flux d’événements · {files} fichiers sources Git",
		"custom.widgets": "Widgets",
		"custom.actions": "Actions",
		"custom.streams": "Flux d’événements",
		"custom.sourceFiles": "Fichiers sources Git",
		"custom.adapters": "Adaptateurs d’interface de référence",
		"custom.adaptersNote":
			"Ces adaptateurs appartiennent à l’application de recette. Ils peuvent composer des appels publics de la bibliothèque mais ne doivent copier aucun protocole HTTP, d’authentification ou métier.",
		"custom.compatibility": "Compatibilité uniquement",
		"custom.releaseWorkflow": "Ouvrir le workflow contrôlé de publication des SDK",
		"flutterflow.title": "Projet de bibliothèque FlutterFlow · {name}",
		"flutterflow.description":
			"Adaptateurs réutilisables gérés dans Git, déployés sur FlutterFlow seulement quand chaque SDK requis a un tag de version immuable.",
		"flutterflow.status": "Synchronisation",
		"flutterflow.ready": "Prêt à synchroniser",
		"flutterflow.pendingOne": "{count} tag immuable en attente",
		"flutterflow.pendingOther": "{count} tags immuables en attente",
		"flutterflow.values": "Valeurs de la bibliothèque",
		"flutterflow.actions": "Actions personnalisées",
		"flutterflow.tokenState": "Jeton dans l’App State",
		"flutterflow.forbidden": "Interdit",
		"flutterflow.releases": "Versions requises",
		"flutterflow.published": "Publiée",
		"flutterflow.pending": "En attente",
		"flutterflow.remote": "Configuration du projet distant",
		"flutterflow.remoteDetails":
			"ID du projet : variable GitHub {variable} · Accès API : secret d’environnement {secret} · Environnement : {environment}",
		"flutterflow.dsl": "Ouvrir le DSL géré dans Git",
		"flutterflow.workflow": "Ouvrir le workflow contrôlé de mise à jour",
		"advanced.title": "Avancé",
		"advanced.description":
			"Sources du dépôt, workflows de publication et réglages du projet distant, pour les mainteneurs.",
		"step.registerApp": "Enregistrer l’application",
		"step.registerDomain": "Enregistrer le domaine",
		"step.urlScheme": "Schéma d’URL",
		"step.intentFilters": "Filtres d’intention",
		"step.addSdk": "Ajouter le SDK",
		"step.push": "Notifications push",
		"step.store": "Intégration du store",
		"step.initialize": "Initialiser le SDK",
		"step.integrate": "Intégrer le SDK",
		"step.default": "Terminez cette étape d’intégration du SDK.",
		"step.ios.0":
			"Enregistrez le bundle et l’équipe de développement Apple utilisés par votre application.",
		"step.ios.1":
			"Déclarez le schéma d’URL qui ramène les clients vers le bon écran de l’application.",
		"step.ios.2": "Installez le package natif SuperBoard avec Swift Package Manager.",
		"step.ios.3":
			"Connectez APNs pour que les messages et l’attribution des liens continuent après l’installation.",
		"step.ios.4":
			"Connectez côté serveur les événements d’achat App Store, sans exposer d’identifiants dans l’application.",
		"step.ios.5": "Initialisez SuperBoard une seule fois au démarrage de l’application.",
		"step.android.0": "Enregistrez le package Android et son certificat de signature.",
		"step.android.1":
			"Déclarez des filtres d’intention vérifiés pour les liens profonds web et applicatifs.",
		"step.android.2": "Ajoutez le package Android SuperBoard à votre build Gradle.",
		"step.android.3":
			"Connectez Firebase Cloud Messaging pour l’attribution et les notifications du support.",
		"step.android.4":
			"Connectez côté serveur les événements d’achat Google Play, sans livrer d’identifiants.",
		"step.android.5": "Initialisez SuperBoard une seule fois depuis la classe Application.",
		"step.web.0": "Enregistrez le domaine public autorisé à initialiser le SDK Web.",
		"step.web.1": "Installez le package Web SuperBoard avec votre gestionnaire de paquets.",
		"step.web.2":
			"Initialisez le SDK une seule fois et transmettez les événements de navigation côté client.",
		"wizard.intro":
			"Suivez les {count} étapes d’intégration du SDK {platform}, puis vérifiez-la sur ce projet.",
		"wizard.sdk": "SDK {platform}",
		"wizard.saved": "Configuration {platform} enregistrée",
		"wizard.verified": "Configuration du SDK vérifiée",
		"wizard.removed": "Configuration du SDK supprimée",
		"wizard.reload": "Recharger",
		"wizard.remove": "Supprimer la configuration",
		"wizard.removeTitle": "Supprimer la configuration {platform} ?",
		"wizard.removeDescription":
			"L’enregistrement, la politique d’exécution et la progression enregistrés pour cette plateforme sont supprimés. Action irréversible.",
		"wizard.removeConfirm": "Supprimer",
		"wizard.cancel": "Annuler",
		"status.loading": "Chargement…",
		"status.configured": "Configurée",
		"status.verified": "Vérifiée",
		"status.error": "En erreur",
		"status.notConfigured": "Non configurée",
		optional: "Facultatif",
		"registration.title": "Enregistrement",
		"registration.description":
			"Identifiants qui permettent à SuperBoard de reconnaître cette application.",
		"field.bundleId": "Bundle ID",
		"field.teamId": "Apple Team ID",
		"field.packageName": "Nom du package",
		"field.sha256": "Certificat SHA-256",
		"field.domain": "Domaine de l’application",
		"runtime.title": "Politique d’exécution",
		"runtime.description":
			"Règles de maintenance et de mise à jour renvoyées au SDK. Laissez les versions vides pour ne pas imposer de mise à jour.",
		"runtime.minimumVersion": "Version minimale",
		"runtime.recommendedVersion": "Version recommandée",
		"runtime.storeUrl": "URL du store",
		"runtime.maintenance": "Mode maintenance",
		"runtime.maintenanceDescription":
			"Prioritaire sur les invitations à mettre à jour pour cette plateforme.",
		"runtime.maintenanceMessage": "Message de maintenance",
		"runtime.maintenancePlaceholder": "Le service est temporairement indisponible.",
		"push.label": "Référence du secret push",
		"push.hint":
			"N’enregistrez qu’une référence du Secret Store ou gérée par l’opérateur. L’API refuse les valeurs d’identifiants et les clés privées.",
		"scope.title": "Configuration propre au projet",
		"scope.description":
			"Ces instructions utilisent le projet et l’environnement sélectionnés. Changer de projet réinitialise le contexte de configuration.",
		"sidebar.complete": "{count}/{total} terminées",
		"sidebar.exit": "Quitter le guide",
		"nav.back": "Retour",
		"nav.step": "Étape {current} sur {total}",
		"nav.skip": "Passer",
		"nav.saving": "Enregistrement…",
		"nav.saveFinish": "Enregistrer et terminer",
		"nav.finish": "Terminer la configuration",
		"nav.saveContinue": "Enregistrer et continuer",
		"nav.continue": "Continuer",
	},
} as const satisfies Record<"en" | "fr", Record<string, string>>;

export type SdkMessage = keyof (typeof messages)["en"];
type Values = Record<string, string | number>;

const placeholder = /\{(\w+)\}/gu;

export function useSdkI18n() {
	const locale = useOptionalFrontContext()?.locale === "fr" ? "fr" : "en";
	return useMemo(() => {
		const catalog: Record<SdkMessage, string> = messages[locale];
		const t = (id: SdkMessage, values: Values = {}) =>
			catalog[id].replace(placeholder, (match, name: string) =>
				name in values ? String(values[name]) : match,
			);
		const rich = (id: SdkMessage, values: Record<string, ReactNode>) =>
			catalog[id]
				.split(placeholder)
				.map((part, index) =>
					createElement(Fragment, { key: index }, index % 2 === 1 ? values[part] : part),
				);
		return { locale, t, rich };
	}, [locale]);
}
