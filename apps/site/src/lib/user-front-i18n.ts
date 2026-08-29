import { setupI18n } from "@lingui/core";

export const USER_FRONT_CATALOGS = {
	en: {
		"user.page.sign_in": "Sign in",
		"user.page.profile": "Profile",
		"user.page.users": "Users",
		"user.login.title": "Operator sign in",
		"user.login.description": "Continue with the EmDash passkey that protects this SuperBoard instance.",
		"user.profile.title": "Operator profile",
		"user.profile.description": "Review the identity used by this operator session.",
		"user.members.title": "Application users",
		"user.members.description": "Review application-user access independently from operator authentication.",
		"user.action.passkey": "Continue with Passkey",
		"user.field.name": "Name",
		"user.field.email": "Email",
		"user.field.role": "Role",
		"user.field.status": "Status",
		"user.status.active": "Active",
		"user.status.disabled": "Disabled",
		"site.admin.open": "Open EmDash Admin",
		"site.front.route_manifest": "Front Route Manifest",
		"site.front.description": "This surface is resolved from the active immutable Front Release. Renderer slots remain isolated from the generic Core runtime.",
		"site.front.unavailable": "Front unavailable",
		"site.front.not_found": "Page not found",
		"site.front.forbidden": "Access denied",
		"site.front.dependency_unavailable": "Dependency unavailable",
		"site.front.fail_closed": "Fail-closed runtime state",
		"site.front.fail_closed_description": "No unverified draft or partial release is rendered. EmDash Admin remains available to repair and publish a complete Front Release.",
	},
	fr: {
		"user.page.sign_in": "Connexion",
		"user.page.profile": "Profil",
		"user.page.users": "Utilisateurs",
		"user.login.title": "Connexion opérateur",
		"user.login.description": "Continuez avec la passkey EmDash qui protège cette instance SuperBoard.",
		"user.profile.title": "Profil opérateur",
		"user.profile.description": "Consultez l’identité utilisée par cette session opérateur.",
		"user.members.title": "Utilisateurs de l’application",
		"user.members.description": "Consultez les accès applicatifs indépendamment de l’authentification opérateur.",
		"user.action.passkey": "Continuer avec une passkey",
		"user.field.name": "Nom",
		"user.field.email": "E-mail",
		"user.field.role": "Rôle",
		"user.field.status": "Statut",
		"user.status.active": "Actif",
		"user.status.disabled": "Désactivé",
		"site.admin.open": "Ouvrir l’administration EmDash",
		"site.front.route_manifest": "Manifeste des routes Front",
		"site.front.description": "Cette surface provient de la Release Front immuable active. Les emplacements de renderer restent isolés du runtime Core générique.",
		"site.front.unavailable": "Front indisponible",
		"site.front.not_found": "Page introuvable",
		"site.front.forbidden": "Accès refusé",
		"site.front.dependency_unavailable": "Dépendance indisponible",
		"site.front.fail_closed": "État runtime fermé par défaut",
		"site.front.fail_closed_description": "Aucun brouillon non vérifié ni release partielle n’est rendu. L’administration EmDash reste disponible pour réparer et publier une Release Front complète.",
	},
} as const;

export type UserFrontLocale = keyof typeof USER_FRONT_CATALOGS;
export type UserFrontMessageId = keyof (typeof USER_FRONT_CATALOGS)["en"];

export function createUserFrontI18n(locale: UserFrontLocale) {
	return setupI18n({ locale, messages: { [locale]: USER_FRONT_CATALOGS[locale] } });
}
