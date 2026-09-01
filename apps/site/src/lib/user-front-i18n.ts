import { setupI18n } from "@lingui/core";

export const USER_FRONT_CATALOGS = {
	en: {
		"user.page.sign_in": "Sign in",
		"user.page.profile": "Profile",
		"user.page.users": "Users",
		"user.login.title": "Operator sign in",
		"user.login.description":
			"Continue with the EmDash passkey that protects this SuperBoard instance.",
		"user.profile.title": "Operator profile",
		"user.profile.description": "Review the identity used by this operator session.",
		"user.members.title": "Application users",
		"user.members.description":
			"Review application-user access independently from operator authentication.",
		"user.admin.title": "Identity administration",
		"user.admin.description":
			"Manage the selected identity surface through its verified plugin renderer.",
		"user.action.passkey": "Continue with Passkey",
		"user.field.name": "Name",
		"user.field.email": "Email",
		"user.field.role": "Role",
		"user.field.status": "Status",
		"user.status.active": "Active",
		"user.status.disabled": "Disabled",
		"site.admin.open": "Open EmDash Admin",
		"site.front.title": "SuperBoard",
		"site.front.navigation": "SuperBoard navigation",
		"site.front.loading": "Loading",
		"site.front.loading_description": "The selected surface is loading.",
		"site.front.empty": "Nothing here yet",
		"site.front.empty_description": "The selected surface has no data to display.",
		"site.front.error": "Surface error",
		"site.front.error_description": "The selected plugin renderer could not complete.",
		"site.front.forbidden_description": "Your grants do not allow this surface.",
		"site.front.not_found_description": "The active Front Release does not expose this path.",
		"site.front.dependency_unavailable_description": "A required plugin dependency is unavailable.",
		"site.front.unavailable_description": "No verified Front Release can be rendered.",
		"site.front.route_manifest": "Front Route Manifest",
		"site.front.description":
			"This surface is resolved from the active immutable Front Release. Renderer slots remain isolated from the generic Core runtime.",
		"site.front.unavailable": "Front unavailable",
		"site.front.not_found": "Page not found",
		"site.front.forbidden": "Access denied",
		"site.front.dependency_unavailable": "Dependency unavailable",
		"site.front.fail_closed": "Fail-closed runtime state",
		"site.front.fail_closed_description":
			"No unverified draft or partial release is rendered. EmDash Admin remains available to repair and publish a complete Front Release.",
		"site.preview.operator_required": "Operator session required",
		"site.preview.not_found": "Preview not found or expired",
		"site.preview.verification_failed": "Preview verification failed",
		"site.meta.instance": "instance",
		"site.meta.state": "state",
		"site.meta.release": "release",
		"site.meta.source": "source",
	},
	fr: {
		"user.page.sign_in": "Connexion",
		"user.page.profile": "Profil",
		"user.page.users": "Utilisateurs",
		"user.login.title": "Connexion opérateur",
		"user.login.description":
			"Continuez avec la passkey EmDash qui protège cette instance SuperBoard.",
		"user.profile.title": "Profil opérateur",
		"user.profile.description": "Consultez l’identité utilisée par cette session opérateur.",
		"user.members.title": "Utilisateurs de l’application",
		"user.members.description":
			"Consultez les accès applicatifs indépendamment de l’authentification opérateur.",
		"user.admin.title": "Administration des identités",
		"user.admin.description":
			"Gérez la surface d’identité sélectionnée avec son renderer de plugin vérifié.",
		"user.action.passkey": "Continuer avec une passkey",
		"user.field.name": "Nom",
		"user.field.email": "E-mail",
		"user.field.role": "Rôle",
		"user.field.status": "Statut",
		"user.status.active": "Actif",
		"user.status.disabled": "Désactivé",
		"site.admin.open": "Ouvrir l’administration EmDash",
		"site.front.title": "SuperBoard",
		"site.front.navigation": "Navigation SuperBoard",
		"site.front.loading": "Chargement",
		"site.front.loading_description": "La surface sélectionnée est en cours de chargement.",
		"site.front.empty": "Aucun contenu pour le moment",
		"site.front.empty_description": "La surface sélectionnée n’a aucune donnée à afficher.",
		"site.front.error": "Erreur de surface",
		"site.front.error_description": "Le renderer du plugin sélectionné n’a pas pu aboutir.",
		"site.front.forbidden_description": "Vos permissions n’autorisent pas cette surface.",
		"site.front.not_found_description": "La Release Front active n’expose pas ce chemin.",
		"site.front.dependency_unavailable_description":
			"Une dépendance obligatoire du plugin est indisponible.",
		"site.front.unavailable_description": "Aucune Release Front vérifiée ne peut être rendue.",
		"site.front.route_manifest": "Manifeste des routes Front",
		"site.front.description":
			"Cette surface provient de la Release Front immuable active. Les emplacements de renderer restent isolés du runtime Core générique.",
		"site.front.unavailable": "Front indisponible",
		"site.front.not_found": "Page introuvable",
		"site.front.forbidden": "Accès refusé",
		"site.front.dependency_unavailable": "Dépendance indisponible",
		"site.front.fail_closed": "État runtime fermé par défaut",
		"site.front.fail_closed_description":
			"Aucun brouillon non vérifié ni release partielle n’est rendu. L’administration EmDash reste disponible pour réparer et publier une Release Front complète.",
		"site.preview.operator_required": "Session opérateur requise",
		"site.preview.not_found": "Preview introuvable ou expirée",
		"site.preview.verification_failed": "Échec de la vérification de la preview",
		"site.meta.instance": "instance",
		"site.meta.state": "état",
		"site.meta.release": "release",
		"site.meta.source": "source",
	},
} as const;

export type UserFrontLocale = keyof typeof USER_FRONT_CATALOGS;
export type UserFrontMessageId = keyof (typeof USER_FRONT_CATALOGS)["en"];

export function createUserFrontI18n(locale: UserFrontLocale) {
	return setupI18n({ locale, messages: { [locale]: USER_FRONT_CATALOGS[locale] } });
}

export function resolveUserFrontLocale(value: string | null): UserFrontLocale {
	return value?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function userFrontMessage(locale: UserFrontLocale, id: UserFrontMessageId): string {
	return createUserFrontI18n(locale)._(id);
}
