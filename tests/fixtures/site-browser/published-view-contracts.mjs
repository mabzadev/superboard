import { expect } from "@playwright/test";

function control(role, en, fr, api) {
	return {
		description: `${role}: ${en} / ${fr}`,
		api,
		async check(page, locale) {
			await expect(
				page
					.locator("main")
					.getByRole(role, { name: locale === "fr" ? fr : en, exact: true })
					.first(),
			).toBeVisible();
		},
	};
}

function text(en, fr, api) {
	return {
		description: `${en} / ${fr}`,
		api,
		async check(page, locale) {
			await expect(
				page
					.locator("main")
					.getByText(locale === "fr" ? fr : en, { exact: true })
					.first(),
			).toBeVisible();
		},
	};
}

function withHeading(contract, en, fr) {
	return {
		...contract,
		description: `${en} / ${fr}: ${contract.description}`,
		async check(page, locale) {
			await contract.check(page, locale);
			await expect(
				page.locator("main").getByRole("heading", { name: locale === "fr" ? fr : en, exact: true }),
			).toBeVisible();
		},
	};
}

export const publishedViewContracts = {
	"/superboard-system/home": text(
		"Vplusflare Backend as a Service. Choose a section to manage this environment.",
		"Backend as a Service de Vplusflare. Choisissez une rubrique pour gérer cet environnement.",
	),
	"/auth/users": control("columnheader", "Account", "Compte", /application-users/),
	"/auth/customers": control("button", "Add customer", "Add customer", /customers/),
	"/auth/apps": control("columnheader", "Client ID", "ID Client", /apps/),
	"/auth/directory/users": {
		...control("button", "Invite User", "Inviter un utilisateur", /users/),
		informationalAlerts: ["No users found", "Aucun utilisateur trouvé"],
	},
	"/auth/roles": control("columnheader", "Note", "Remarque", /roles/),
	"/auth/scopes": control("columnheader", "Client Type", "Type de client", /scopes/),
	"/auth/orgs": control("columnheader", "Slug", "Identifiant", /orgs/),
	"/auth/saml": text("SAML", "SAML", /saml\/idps/),
	"/auth/logs": control("columnheader", "Receiver", "Destinataire", /logs\/sign-in/),
	"/auth/user-attributes": control(
		"columnheader",
		"Include in ID Token Body",
		"Inclure dans le corps du token ID",
		/user-attributes/,
	),
	"/auth/referrals": text("No referrals yet", "No referrals yet", /referrals/),
	"/auth/access-key": control("button", "Create Access Key", "Create Access Key", /access-key/),
	"/auth/settings": control(
		"textbox",
		"Sign-in page logo",
		"Logo de la page de connexion",
		/configuration/,
	),
	"/data/content": control("button", "Create collection", "Créer la collection", /collections/),
	"/data/files": control("button", "Upload", "Transférer", /objects/),
	"/data/settings": text("Default language", "Langue par défaut", /settings/),
	"/monetization/customers": control("columnheader", "Identity", "Identity", /customers/),
	"/monetization/products": control("button", "New iOS product", "Nouveau produit iOS", /products/),
	"/monetization/offerings": control("button", "New offering", "Nouvelle offre", /offerings/),
	"/monetization/entitlements": control(
		"button",
		"Add entitlement",
		"Ajouter un droit d’accès",
		/entitlements/,
	),
	"/monetization/settings": control(
		"checkbox",
		"Enable purchases",
		"Activer les achats",
		/settings/,
	),
	"/communication/campaigns": withHeading(
		control("button", "Add email", "Ajouter un e-mail", /email_templates/),
		"Campaign email",
		"E-mails de campagne",
	),
	"/communication/email": withHeading(
		control("button", "Add email", "Ajouter un e-mail", /email_templates/),
		"Transactional email",
		"E-mail transactionnel",
	),
	"/communication/in-app-messages": control(
		"button",
		"Add message",
		"Ajouter un message",
		/notifications/,
	),
	"/communication/settings": control(
		"button",
		"Save profile",
		"Enregistrer l’expéditeur",
		/settings\/smtp/,
	),
	"/acquisition/paywalls": control("button", "Create paywall", "Créer un paywall", /paywalls/),
	"/acquisition/onboardings": control(
		"button",
		"Create onboarding",
		"Créer un parcours d’accueil",
		/onboardings/,
	),
	"/acquisition/dynamic-links": control("button", "Create link", "Créer un lien", /dynamic-links/),
	"/acquisition/settings": control(
		"button",
		"New environment",
		"Nouvel environnement",
		/environments/,
	),
	"/support/inbox": withHeading(
		control("button", "Add an item", "Ajouter un élément", /inboxes/),
		"Inbox",
		"Boîte de réception",
	),
	"/support/help-center": withHeading(
		control("button", "Add an item", "Ajouter un élément", /portals/),
		"Help Center",
		"Centre d’aide",
	),
	"/support/settings": text("Business name", "Nom de l’entreprise", /settings/),
	"/analytics": text("Unique people", "Personnes uniques", /analytics_overview/),
	"/analytics/home": withHeading(
		text("Unique people", "Personnes uniques", /analytics_overview/),
		"Dashboard",
		"Dashboard",
	),
	"/analytics/users": control("tab", "User profiles", "Profils utilisateurs", /analytics_sessions/),
	"/analytics/installations": control(
		"columnheader",
		"Installed",
		"Date d’installation",
		/installations/,
	),
	"/analytics/views": text("Tracked views", "Vues suivies", /analytics_views/),
	"/analytics/dimensions": text("Platforms & versions", "Plateformes et versions", /dimensions/),
	"/analytics/cohorts": control("button", "Create cohort", "Créer une cohorte", /cohorts/),
	"/analytics/events": control("button", "Apply filter", "Appliquer le filtre", /analytics_events/),
	"/analytics/insights": control(
		"button",
		"Run funnel",
		"Analyser l’entonnoir",
		/analytics_retention/,
	),
	"/analytics/purchases": text(
		"No verified purchase facts in this period.",
		"Aucun achat vérifié pendant cette période.",
		/purchases/,
	),
	"/analytics/reports": control(
		"button",
		"Export events",
		"Exporter les événements",
		/analytics_reports/,
	),
	"/analytics/alerts": control("button", "Create alert", "Créer une alerte", /alerts/),
	"/analytics/crashes": control("combobox", "Crash status", "État du plantage", /crashes/),
	"/analytics/feedback": control("columnheader", "Comment", "Commentaire", /feedback/),
	"/analytics/remote-config": {
		...control("button", "Publish", "Publier", /remote_config/),
		informationalAlerts: [
			"Stable assignmentsRollout buckets are computed from a pseudonymous identity, project and key. The same installation always receives the same result.",
			"Affectations stablesLa répartition dépend d’une identité pseudonymisée, du projet et de la clé. Une même installation reçoit toujours le même résultat.",
		],
	},
	"/analytics/settings": text("Observed applications", "Applications observées", /applications/),
	"/core/libraries": {
		...text("SuperBoard Flutter", "SuperBoard Flutter", /sdk-catalog|libraries/),
		informationalAlerts: [
			"Git is the release authoritySource versions are changed by pull request. Production applications use only immutable release references; this back-office never rewrites package source or creates an unreviewed tag.",
		],
	},
	"/core/settings": control("columnheader", "Service", "Service", /deployment-configuration/),
	"/core/web-setup": text("Application domain", "Application domain", /app\/projects/),
	"/core/ios-setup": text("Apple Team ID", "Apple Team ID", /app\/projects/),
	"/core/android-setup": text("SHA-256 certificate", "SHA-256 certificate", /app\/projects/),
	"/core/infrastructure": {
		...text(
			"Latest observed service health",
			"Dernier état observé des services",
			/observability|platform/,
		),
		informationalAlerts: [
			"Runtime metrics unavailableCloudflare analytics read credentials are not configured",
		],
		limitations: [
			"Cloudflare Analytics Engine metrics are unconfigured in the isolated local instance",
		],
	},
	"/core/audit": control(
		"button",
		"Create immutable archive",
		"Créer une archive immuable",
		/audit/,
	),
	"/core/gateway": control(
		"button",
		"Save draft route",
		"Enregistrer la route brouillon",
		/gateway/,
	),
	"/core/mcp": control("button", "Run tool", "Exécuter l’outil", /mcp/),
	"/_emdash/admin/plugins-manager": withHeading(
		control("switch", /.+/u, /.+/u, /plugins/),
		"Communication",
		"Communication",
	),
	"/acquisition/paywalls/statistics": {
		description: "Paywall statistics filters, event metrics and series, with no paywall editor",
		api: /paywalls.*statistics/u,
		async check(page, locale) {
			const main = page.locator("main");
			await expect(main.getByText("impression", { exact: true })).toBeVisible();
			await expect(
				main.getByText(locale === "fr" ? "Évolution dans le temps" : "Time series", {
					exact: true,
				}),
			).toBeVisible();
			await expect(
				main.getByRole("columnheader", {
					name: locale === "fr" ? "Événement" : "Event",
					exact: true,
				}),
			).toBeVisible();
			await expect(main.locator('input[type="date"]')).toHaveCount(2);
			await expect(
				main.getByRole("button", {
					name: /Save immutable draft|Enregistrer une version|Save paywall|Enregistrer le paywall/u,
				}),
			).toHaveCount(0);
		},
	},
};
