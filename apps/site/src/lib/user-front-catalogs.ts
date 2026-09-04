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
			"Manage the selected identity View through its verified plugin renderer.",
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
		"site.front.loading_description": "The selected View is loading.",
		"site.front.empty": "Nothing here yet",
		"site.front.empty_description": "The selected View has no data to display.",
		"site.front.error": "View error",
		"site.front.error_description": "The selected plugin renderer could not complete.",
		"site.front.view_configuration_error":
			"This View needs a valid renderer and at least one plugin data source.",
		"site.front.forbidden_description": "Your grants do not allow this View.",
		"site.front.not_found_description":
			"The published SuperBoard configuration does not expose this URL.",
		"site.front.dependency_unavailable_description": "A required plugin dependency is unavailable.",
		"site.front.unavailable_description": "No verified SuperBoard configuration can be rendered.",
		"site.front.route_manifest": "Front Route Manifest",
		"site.front.description":
			"This View comes from the published SuperBoard configuration and is rendered by its plugin.",
		"site.front.unavailable": "SuperBoard unavailable",
		"site.front.not_found": "Page not found",
		"site.front.forbidden": "Access denied",
		"site.front.dependency_unavailable": "Dependency unavailable",
		"site.front.fail_closed": "Fail-closed runtime state",
		"site.front.fail_closed_description":
			"No unverified or partial configuration is rendered. EmDash Admin remains available to repair and publish a complete configuration.",
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
			"Gérez la View d’identité sélectionnée avec son renderer de plugin vérifié.",
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
		"site.front.loading_description": "La View sélectionnée est en cours de chargement.",
		"site.front.empty": "Aucun contenu pour le moment",
		"site.front.empty_description": "La View sélectionnée n’a aucune donnée à afficher.",
		"site.front.error": "Erreur de View",
		"site.front.error_description": "Le renderer du plugin sélectionné n’a pas pu aboutir.",
		"site.front.view_configuration_error":
			"Cette View exige un renderer valide et au moins une source de données du plugin.",
		"site.front.forbidden_description": "Vos permissions n’autorisent pas cette View.",
		"site.front.not_found_description":
			"La configuration SuperBoard publiée n’expose pas cette URL.",
		"site.front.dependency_unavailable_description":
			"Une dépendance obligatoire du plugin est indisponible.",
		"site.front.unavailable_description":
			"Aucune configuration SuperBoard vérifiée ne peut être rendue.",
		"site.front.route_manifest": "Manifeste des routes Front",
		"site.front.description":
			"Cette View provient de la configuration SuperBoard publiée et est rendue par son plugin.",
		"site.front.unavailable": "SuperBoard indisponible",
		"site.front.not_found": "Page introuvable",
		"site.front.forbidden": "Accès refusé",
		"site.front.dependency_unavailable": "Dépendance indisponible",
		"site.front.fail_closed": "État runtime fermé par défaut",
		"site.front.fail_closed_description":
			"Aucune configuration non vérifiée ou partielle n’est rendue. L’administration EmDash reste disponible pour réparer et publier une configuration complète.",
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
