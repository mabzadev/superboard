import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { createFrontI18n } from "@superboard/front-ui/i18n";
import { useMemo } from "react";

const french: Record<string, string> = {
	"Stripe web payments": "Paiements web Stripe",
	"Application origin": "Origine de l’application",
	"Stripe webhook endpoint": "Adresse de notification Stripe",
	"Enable Checkout session, subscription, invoice payment and charge refund events on this endpoint.":
		"Activez les événements Checkout, abonnement, paiement de facture et remboursement sur cette adresse.",
	"Unable to load Stripe settings.": "Impossible de charger les paramètres Stripe.",
	"Unable to save Stripe settings. Check the keys and application origin.":
		"Impossible d’enregistrer les paramètres Stripe. Vérifiez les clés et l’origine de l’application.",
	"Synchronize Stripe prices": "Synchroniser les prix Stripe",
	Country: "Pays",
	Language: "Langue",
	"App version": "Version de l’application",
	"SDK version": "Version du SDK",

	"Configure store credentials in the iOS or Android application settings, then test the connection here.":
		"Configurez les identifiants du store dans les paramètres de votre application iOS ou Android, puis testez la connexion ici.",
	"Configure store": "Configurer le store",
	"Test connection": "Tester la connexion",
	"Store connection verified.": "Connexion au store vérifiée.",
	"Store connection failed. Check the application credentials and try again.":
		"La connexion au store a échoué. Vérifiez les identifiants de l’application et réessayez.",

	"Configure the products, offers and access used by your mobile app.":
		"Configurez les produits, les offres et les accès utilisés par votre application mobile.",
	"Some stores could not be synchronized. Check the store credentials.":
		"Certains stores n’ont pas pu être synchronisés. Vérifiez leurs identifiants de connexion.",
	"No mobile products configured. Add the exact product identifier from your store or synchronize the catalog.":
		"Aucun produit mobile configuré. Ajoutez l’identifiant exact du produit dans votre store ou synchronisez le catalogue.",
	"Current offering": "Offre courante",
	"Alternative offering": "Offre alternative",
	"Add a package to make products available in this offering.":
		"Ajoutez un package pour proposer des produits dans cette offre.",
	"Add package": "Ajouter un package",
	"Remove package": "Retirer le package",
	"Store product identifier": "Identifiant du produit dans le store",
	"Package duration": "Durée du package",
	"Select one equivalent product per store.": "Sélectionnez un produit équivalent par store.",
	weekly: "Hebdomadaire",
	monthly: "Mensuel",
	two_month: "Deux mois",
	three_month: "Trois mois",
	six_month: "Six mois",
	annual: "Annuel",
	lifetime: "À vie",
	custom: "Personnalisé",
	Refresh: "Actualiser",

	Purchases: "Achats",
	"Purchases, subscriptions, restorations, refunds and financial history.":
		"Achats, abonnements, restaurations, remboursements et historique financier.",
	"All products": "Tous les produits",
	"All stores": "Toutes les boutiques",
	"All statuses": "Tous les statuts",
	"Revenue by product and platform": "Revenus par produit et plateforme",
	"Legacy Revenue metrics reassigned to Purchases, calculated server-side for the selected period.":
		"Indicateurs de revenus calculés pour la période sélectionnée.",
	Platform: "Plateforme",
	"Units sold": "Unités vendues",
	"First-time purchases": "Premiers achats",
	"Total revenue": "Revenu total",
	Cancellations: "Annulations",
	"No product revenue in this period.": "Aucun revenu de produit sur cette période.",
	"Active subscriptions": "Abonnements actifs",
	"Gross revenue": "Revenu brut",
	Refunded: "Remboursé",
	"Net revenue": "Revenu net",
	Refunds: "Remboursements",
	"Revenue timeline": "Évolution des revenus",
	"Daily volume and gross revenue.": "Volume quotidien et revenu brut.",
	"Refresh purchases": "Actualiser les achats",
	Date: "Date",
	Revenue: "Revenus",
	"No financial activity in this period.": "Aucune activité financière sur cette période.",
	"Record sandbox purchase": "Enregistrer un achat de test",
	"Validate catalog, entitlement and subscription flows without touching a live store.":
		"Testez le catalogue, les droits d’accès et les abonnements sans effectuer de transaction réelle.",
	"Financial customer ID": "Identifiant du client financier",
	"Select a product": "Sélectionner un produit",
	Manual: "Manuel",
	Apple: "Apple",
	Google: "Google",
	Stripe: "Stripe",
	"External transaction ID": "Identifiant de transaction externe",
	Price: "Prix",
	Currency: "Devise",
	"Record purchase": "Enregistrer l’achat",
	"Purchase history": "Historique des achats",
	"{count} matching transactions": "{count} transactions correspondantes",
	Customer: "Client",
	Purchased: "Acheté le",
	Expires: "Expire le",
	"Expires {date}": "Expire le {date}",
	Amount: "Montant",
	"Amount in {currency}": "Montant en {currency}",
	"ECB reference rate of {date}": "Taux de référence BCE du {date}",
	"Currency API daily rate of {date} (not published by the ECB)":
		"Taux quotidien Currency API du {date} (devise non publiée par la BCE)",
	"Conversion pending": "Conversion en attente",
	"No exchange rate for this currency": "Aucun taux de change pour cette devise",
	"{count} awaiting conversion": "{count} en attente de conversion",
	"Amounts in {currency}, converted at the exchange rate of each purchase day.":
		"Montants en {currency}, convertis au taux de change du jour de chaque achat.",
	"1 purchase awaiting conversion is not included in these totals.":
		"1 achat en attente de conversion n’est pas inclus dans ces totaux.",
	"{count} purchases awaiting conversion are not included in these totals.":
		"{count} achats en attente de conversion ne sont pas inclus dans ces totaux.",
	"1 refund awaiting conversion is not included in these totals.":
		"1 remboursement en attente de conversion n’est pas inclus dans ces totaux.",
	"{count} refunds awaiting conversion are not included in these totals.":
		"{count} remboursements en attente de conversion ne sont pas inclus dans ces totaux.",
	"Total spent": "Total dépensé",
	"1 purchase awaiting conversion is not included.":
		"1 achat en attente de conversion n’est pas inclus.",
	"{count} purchases awaiting conversion are not included.":
		"{count} achats en attente de conversion ne sont pas inclus.",
	"Your display currency": "Votre devise d’affichage",
	"Only for you: other operators choose their own. Revenue totals, charts and customer spending are converted to USD at the exchange rate of each purchase day, then to this currency at the same day’s rate.":
		"Pour vous seul : chaque opérateur choisit la sienne. Les totaux de revenus, les graphiques et les dépenses des clients sont convertis en USD au taux de change du jour de chaque achat, puis dans cette devise au taux du même jour.",
	"Display currency saved.": "Devise d’affichage enregistrée.",
	"Could not save the display currency.": "Impossible d’enregistrer la devise d’affichage.",
	"Could not load the display currency.": "Impossible de charger la devise d’affichage.",
	"No purchases match these filters.": "Aucun achat ne correspond à ces filtres.",
	Refund: "Rembourser",
	"Purchase detail": "Détail de l’achat",
	"Close purchase detail": "Fermer le détail de l’achat",
	"Granted entitlements": "Droits d’accès accordés",
	"No entitlement was granted.": "Aucun droit d’accès n’a été accordé.",
	"Refund history": "Historique des remboursements",
	"No refunds recorded.": "Aucun remboursement enregistré.",
	Subscriptions: "Abonnements",
	"Current periods, renewals, cancellation and restoration state.":
		"Périodes en cours, renouvellements, annulations et restaurations.",
	"Period end": "Fin de période",
	"Updated {date}": "Mis à jour le {date}",
	"No subscriptions match this customer.": "Aucun abonnement ne correspond à ce client.",
	Restore: "Restaurer",
	"No reason": "Aucun motif",
	"Auto-renew": "Renouvellement automatique",
	"Auto-renew off": "Renouvellement désactivé",
	"View purchase {transaction}": "Voir l’achat {transaction}",
	"Sandbox purchase recorded": "Achat de test enregistré",
	Catalog: "Catalogue",
	Offerings: "Offres",
	Entitlements: "Droits d’accès",
	Customers: "Clients",
	"Application identities, subscriptions, entitlements, balances, transactions and paywall activity.":
		"Identités d’application, abonnements, droits d’accès, soldes, transactions et activité du paywall.",
	"App user ID or alias": "ID utilisateur de l’application ou alias",
	"1 customer": "1 client",
	"{count} customers": "{count} clients",
	Identity: "Identité",
	Transactions: "Transactions",
	"Last seen": "Dernière activité",
	"First seen": "Première activité",
	Blocked: "Bloqué",
	Anonymous: "Anonyme",
	"No customer matches this search.": "Aucun client ne correspond à cette recherche.",
	"All customers": "Tous les clients",
	"Loading customer…": "Chargement du client…",
	"Unable to load this customer": "Impossible de charger ce client",
	Block: "Bloquer",
	Unblock: "Débloquer",
	"Customer blocked": "Client bloqué",
	"Customer unblocked": "Client débloqué",
	Aliases: "Alias",
	"No aliases": "Aucun alias",
	"CustomerInfo proof": "Preuve CustomerInfo",
	"Entitlements and subscriptions": "Droits d’accès et abonnements",
	"expires {date}": "expire le {date}",
	"no expiry": "sans expiration",
	"unknown proof": "preuve inconnue",
	"Revoke promotion": "Révoquer la promotion",
	"No active entitlement.": "Aucun droit d’accès actif.",
	"Promotional entitlement": "Droit d’accès promotionnel",
	"Select entitlement": "Sélectionner un droit d’accès",
	"Promotion expiry": "Expiration de la promotion",
	"Grant promotion": "Accorder la promotion",
	"Promotional entitlement granted": "Droit d’accès promotionnel accordé",
	"Promotional entitlement revoked": "Droit d’accès promotionnel révoqué",
	"Virtual balances": "Soldes virtuels",
	"No virtual balance.": "Aucun solde virtuel.",
	"Financial and paywall history": "Historique financier et du paywall",
	"Paywall events": "Événements du paywall",
	"All billing events ({count})": "Tous les événements de facturation ({count})",
	"Identity operations": "Opérations sur l’identité",
	"Merge and deletion are audited and require explicit confirmation.":
		"La fusion et la suppression sont journalisées et exigent une confirmation explicite.",
	"Target customer ID": "ID du client cible",
	"Type MERGE": "Saisissez MERGE",
	"Merge into target": "Fusionner dans la cible",
	"Customer identities merged": "Identités client fusionnées",
	"Type the exact customer ID to delete": "Saisissez l’ID exact du client à supprimer",
	"Transactions, subscriptions and events are retained without a customer link; aliases, balances and promotional rights are removed.":
		"Les transactions, abonnements et événements sont conservés sans lien avec le client ; les alias, soldes et droits promotionnels sont supprimés.",
	"Delete billing customer": "Supprimer le client de facturation",
	"Billing customer deleted": "Client de facturation supprimé",
	"Transfer purchases": "Transférer les achats",
	"Move this customer’s App Store and Google Play purchases, and the access they give, to another App User ID. Virtual currency balances and promotional entitlements stay with this customer.":
		"Transférez les achats App Store et Google Play de ce client, et l’accès qu’ils donnent, vers un autre identifiant. Les soldes de monnaie virtuelle et les droits promotionnels restent à ce client.",
	"Destination App User ID": "Identifiant de destination",
	Find: "Rechercher",
	"No customer has this App User ID.": "Aucun client n’a cet identifiant.",
	"Enter the App User ID of another customer.": "Saisissez l’identifiant d’un autre client.",
	"Destination customer": "Client de destination",
	"App User ID": "Identifiant",
	"Customer ID": "ID du client",
	"Transfer the purchases of {from} to {to}?": "Transférer les achats de {from} vers {to} ?",
	"{from} loses the access they give. The transfer is recorded on both customers and sent to the webhooks that accept TRANSFER events.":
		"{from} perd l’accès qu’ils donnent. Le transfert est enregistré sur les deux clients et envoyé aux webhooks qui acceptent les événements TRANSFER.",
	"Purchases transferred": "Achats transférés",
	"This customer has no App Store or Google Play purchase to transfer.":
		"Ce client n’a aucun achat App Store ou Google Play à transférer.",
	"Aliased with {alias}": "Associé à {alias}",
	"No record.": "Aucun enregistrement.",
	"Store product": "Produit du store",
	"Transaction ID": "ID de transaction",
	Event: "Événement",
	Paywall: "Paywall",
	Occurred: "Survenu le",

	From: "Du",
	To: "Au",
	"Financial customer": "Client financier",

	"Add entitlement": "Ajouter un droit d’accès",
	"Edit entitlement": "Modifier le droit d’accès",
	"New offering": "Nouvelle offre",
	"Edit offering": "Modifier l’offre",
	"New package": "Nouveau package",
	"Edit package": "Modifier le package",
	"New product": "Nouveau produit",
	"Edit product": "Modifier le produit",
	Product: "Produit",
	Cancel: "Annuler",

	Identifier: "Identifiant",
	"Display name": "Nom affiché",
	Products: "Produits",
	Created: "Créé le",
	Store: "Store",
	Position: "Position",
	Placement: "Emplacement",
	"Placement: {placement}": "Emplacement : {placement}",
	Environment: "Environnement",
	Status: "Statut",

	"No entitlements configured.": "Aucun droit d’accès configuré.",
	"No products": "Aucun produit",
	"No offerings configured.": "Aucune offre configurée.",

	"Synchronize catalog": "Synchroniser le catalogue",

	"Identifiers are stable public keys exposed to the SDK.":
		"Les identifiants sont des clés publiques stables exposées au SDK.",
	"Product type": "Type de produit",
	Subscription: "Abonnement",
	"Non-consumable": "Non-consommable",
	Consumable: "Consommable",

	"Purchase refunded": "Achat remboursé",
	"Subscription restored": "Abonnement restauré",
	"Subscription cancelled": "Abonnement annulé",

	"Stripe secret key": "Clé secrète Stripe",
	"Webhook signing secret": "Secret de signature des webhooks",
	"Save changes": "Enregistrer",
	Sandbox: "Bac à sable",
	Production: "Production",
	"Purchase settings": "Paramètres des achats",
	"Manage purchase and restore rules and inspect configured store credentials.":
		"Gérez les règles d’achat et de restauration et consultez la configuration des boutiques.",
	"Enable purchases": "Activer les achats",
	"Restore behavior": "Comportement de restauration",
	Details: "Détails",
	"From {from} to {to}": "De {from} vers {to}",
	"Applies to every app in this project when another App User ID restores or buys with a receipt that is already in use.":
		"S’applique à toutes les applications du projet lorsqu’un autre identifiant restaure ou achète avec un reçu déjà utilisé.",
	"Transfer to new App User ID": "Transférer au nouvel identifiant",
	"Default. When another App User ID restores or buys with a receipt that is already in use, the purchases move to it, so only one customer has access at a time. Purchases that belong to an anonymous App User ID are merged with the new App User ID instead.":
		"Par défaut. Quand un autre identifiant restaure ou achète avec un reçu déjà utilisé, les achats lui sont transférés : un seul client y a accès à la fois. Les achats d’un identifiant anonyme sont plutôt fusionnés avec le nouvel identifiant.",
	"Transfer if there are no active subscriptions": "Transférer s’il n’y a pas d’abonnement actif",
	"Purchases move to the new App User ID only if the current owner has no active subscription. Otherwise they stay with the current owner and the restore or purchase returns an error. One-time purchases don’t block the transfer.":
		"Les achats sont transférés au nouvel identifiant seulement si le propriétaire actuel n’a aucun abonnement actif. Sinon, ils restent au propriétaire actuel et la restauration ou l’achat renvoie une erreur. Les achats uniques n’empêchent pas le transfert.",
	"Keep with original App User ID": "Garder l’identifiant d’origine",
	"Use with caution. Restoring or buying with a receipt that belongs to another App User ID returns an error. Choose this only if customers must create an account before purchasing, and be ready to help them recover their account.":
		"À utiliser avec prudence. La restauration ou l’achat avec un reçu qui appartient à un autre identifiant renvoie une erreur. Réservez ce choix aux applications qui exigent un compte avant l’achat, et prévoyez d’aider les clients à récupérer leur compte.",
	"Use a different restore behavior for sandbox":
		"Utiliser un autre comportement pour le bac à sable",
	"Sandbox restore behavior": "Comportement de restauration du bac à sable",
	"Applies to sandbox purchases instead of the behavior above, to test another behavior without changing production.":
		"S’applique aux achats du bac à sable à la place du comportement ci-dessus, pour tester un autre comportement sans modifier la production.",
	"Loading settings…": "Chargement des paramètres…",
	"Could not load billing settings.": "Impossible de charger les paramètres de facturation.",
	"Could not save billing settings.": "Impossible d’enregistrer les paramètres de facturation.",
	"Settings saved.": "Paramètres enregistrés.",
	"Save settings": "Enregistrer les paramètres",
	"Saving…": "Enregistrement…",
	Retry: "Réessayer",
	"Credential configuration does not confirm provider availability.":
		"La configuration des identifiants ne confirme pas la disponibilité du fournisseur.",
	"Not configured": "Non configuré",
	Unknown: "Inconnu",
	"Monetization Settings": "Paramètres de monétisation",
	"Configure billing, payment gateways, currencies, and view monetization service diagnostics.":
		"Configurez la facturation, les passerelles de paiement, les devises et consultez le diagnostic du service de monétisation.",
	General: "Général",
	Gateways: "Passerelles",
	"Tax Calculation": "Calcul des taxes",
	"Automatic (Stripe Tax)": "Automatique (Stripe Tax)",
	"Payment Providers": "Fournisseurs de paiement",
	"Connected Gateways": "Passerelles connectées",
	"Apple App Store": "Apple App Store",
	"Google Play Billing": "Facturation Google Play",
	"Stripe Payments": "Paiements Stripe",
	Configured: "Configuré",
	"Settings sections": "Sections des paramètres",
	"Credit cards, SEPA, Link": "Cartes de crédit, SEPA, Link",
	"In-app purchases (iOS, macOS)": "Achats intégrés (iOS, macOS)",
	"In-app purchases (Android)": "Achats intégrés (Android)",
	"USD ($)": "USD ($)",
};

type CodeKind =
	| "status"
	| "offering_status"
	| "store"
	| "platform"
	| "environment"
	| "verification"
	| "event";

const codeLabels: Record<CodeKind, Record<string, readonly [english: string, french: string]>> = {
	status: {
		pending: ["Pending", "En attente"],
		trialing: ["In trial", "En période d’essai"],
		active: ["Active", "Actif"],
		grace_period: ["Grace period", "Période de grâce"],
		billing_issue: ["Billing issue", "Problème de facturation"],
		paused: ["Paused", "En pause"],
		cancelled: ["Cancelled", "Annulé"],
		expired: ["Expired", "Expiré"],
		revoked: ["Revoked", "Révoqué"],
		refunded: ["Refunded", "Remboursé"],
		failed: ["Failed", "Échec"],
		succeeded: ["Succeeded", "Réussi"],
		archived: ["Archived", "Archivé"],
		inactive: ["Inactive", "Inactif"],
		draft: ["Draft", "Brouillon"],
		completed: ["Completed", "Terminé"],
		processed: ["Processed", "Traité"],
		received: ["Received", "Reçu"],
		requested: ["Requested", "Demandé"],
		processing: ["Processing", "En cours"],
		rejected: ["Rejected", "Refusé"],
	},
	offering_status: {
		active: ["Active", "Active"],
		archived: ["Archived", "Archivée"],
	},
	store: {
		apple: ["Apple", "Apple"],
		google: ["Google", "Google"],
		stripe: ["Stripe", "Stripe"],
		amazon: ["Amazon", "Amazon"],
		manual: ["Manual", "Manuel"],
		promotional: ["Promotional", "Promotionnel"],
	},
	platform: {
		ios: ["iOS", "iOS"],
		android: ["Android", "Android"],
		macos: ["macOS", "macOS"],
		web: ["Web", "Web"],
		cross_platform: ["Cross-platform", "Multiplateforme"],
		test: ["Test", "Test"],
	},
	environment: {
		sandbox: ["Sandbox", "Bac à sable"],
		production: ["Production", "Production"],
	},
	verification: {
		verified: ["Verified", "Vérifié"],
		admin: ["Granted by an administrator", "Accordé par un administrateur"],
	},
	event: {
		initial_purchase: ["Initial purchase", "Achat initial"],
		purchase: ["Purchase", "Achat"],
		purchased: ["Purchase", "Achat"],
		non_renewing_purchase: ["Non-renewing purchase", "Achat sans renouvellement"],
		trial_started: ["Trial started", "Essai commencé"],
		trial_converted: ["Trial converted", "Essai converti"],
		renewal: ["Renewal", "Renouvellement"],
		did_renew: ["Renewal", "Renouvellement"],
		product_change: ["Product changed", "Changement de produit"],
		product_changed: ["Product changed", "Changement de produit"],
		cancellation: ["Cancellation", "Annulation"],
		cancelled: ["Cancellation", "Annulation"],
		uncancellation: ["Cancellation withdrawn", "Annulation retirée"],
		reactivated: ["Reactivation", "Réactivation"],
		grace_period_started: ["Grace period started", "Début de la période de grâce"],
		billing_issue: ["Billing issue", "Problème de facturation"],
		subscription_paused: ["Subscription paused", "Abonnement suspendu"],
		expiration: ["Expiration", "Expiration"],
		expired: ["Expiration", "Expiration"],
		refund: ["Refund", "Remboursement"],
		refunded: ["Refund", "Remboursement"],
		refund_reversed: ["Refund reversed", "Remboursement annulé"],
		chargeback: ["Chargeback", "Rétrofacturation"],
		revoke: ["Revocation", "Révocation"],
		revoked: ["Revocation", "Révocation"],
		transfer: ["Transfer", "Transfert"],
		transferred: ["Transfer", "Transfert"],
		aliased: ["Alias created", "Alias créé"],
		promotional_granted: ["Promotion granted", "Promotion accordée"],
		promotional_revoked: ["Promotion revoked", "Promotion révoquée"],
		virtual_currency_adjusted: ["Virtual balance adjusted", "Solde virtuel ajusté"],
		reconciliation: ["Reconciliation", "Rapprochement"],
		impression: ["Paywall shown", "Paywall affiché"],
		package_selected: ["Package selected", "Package sélectionné"],
		closed: ["Paywall closed", "Paywall fermé"],
		purchase_started: ["Purchase started", "Achat commencé"],
		purchase_succeeded: ["Purchase succeeded", "Achat réussi"],
		purchase_cancelled: ["Purchase cancelled", "Achat annulé"],
		purchase_failed: ["Purchase failed", "Échec de l’achat"],
		restore_started: ["Restore started", "Restauration commencée"],
		restore_succeeded: ["Restore succeeded", "Restauration réussie"],
		restore_failed: ["Restore failed", "Échec de la restauration"],
	},
};

const codeMessages = Object.entries(codeLabels).flatMap(([kind, labels]) =>
	Object.entries(labels).map(([code, [english, translation]]) => ({
		id: `code.${kind}.${code}`,
		english,
		translation,
	})),
);

const catalogs = {
	en: {
		...Object.fromEntries(Object.keys(french).map((message) => [message, message])),
		...Object.fromEntries(codeMessages.map(({ id, english }) => [id, english])),
	},
	fr: {
		...french,
		...Object.fromEntries(codeMessages.map(({ id, translation }) => [id, translation])),
	},
};

const sqliteDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/u;

function capitalize(value: string) {
	return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function readableCode(value: string) {
	const words = value.replace(/[_-]+/gu, " ").trim().toLowerCase();
	return words ? capitalize(words) : value;
}

function formatMonetizationDate(
	value: string | number | null | undefined,
	locale: string,
	{ time = true }: { time?: boolean } = {},
) {
	if (value == null || value === "") return "—";
	const day = typeof value === "string" && dateOnly.test(value);
	const parsed = new Date(
		typeof value === "string" && sqliteDateTime.test(value) ? `${value.replace(" ", "T")}Z` : value,
	);
	if (Number.isNaN(parsed.getTime())) return typeof value === "string" ? value : "—";
	return day || !time
		? parsed.toLocaleDateString(locale, {
				dateStyle: "medium",
				...(day ? { timeZone: "UTC" } : {}),
			})
		: parsed.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function displayName(type: "region" | "language" | "currency", value: string, locale: string) {
	try {
		const name = new Intl.DisplayNames([locale], { type, fallback: "none" }).of(value);
		return name ? capitalize(name) : value;
	} catch {
		return value;
	}
}

export function useMonetizationI18n() {
	const context = useOptionalFrontContext();
	const locale = context?.locale ?? "en";
	return useMemo(() => {
		const messages = catalogs[locale] ?? catalogs.en;
		const i18n = createFrontI18n({ locale, messages: { [locale]: messages } });
		return {
			locale,
			t: (message: string, values?: Record<string, unknown>) =>
				Object.hasOwn(i18n.messages, message) ? i18n._(message, values) : message,
			code: (kind: CodeKind, value: string | null | undefined) => {
				if (!value) return "—";
				const id = `code.${kind}.${value.trim().toLowerCase()}`;
				return Object.hasOwn(i18n.messages, id) ? i18n._(id) : readableCode(value);
			},
			date: (value: string | number | null | undefined, options?: { time?: boolean }) =>
				formatMonetizationDate(value, locale, options),
			region: (value: string) => displayName("region", value, locale),
			language: (value: string) => displayName("language", value, locale),
			currency: (value: string) => displayName("currency", value, locale),
		};
	}, [locale]);
}
