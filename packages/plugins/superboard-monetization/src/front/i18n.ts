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

	"App Store / Google Play": "App Store / Google Play",
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
	"Conversion pending": "Conversion en attente",
	"No exchange rate for this currency": "Aucun taux de change pour cette devise",
	"{count} awaiting conversion": "{count} en attente de conversion",
	"Amounts in {currency}, converted at the ECB reference rate of each purchase day.":
		"Montants en {currency}, convertis au taux de référence de la BCE du jour de chaque achat.",
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
	"Display currency": "Devise d’affichage",
	"Revenue totals, charts and customer spending are converted to USD at the ECB reference rate of each purchase day, then to the display currency at the same day’s rate.":
		"Les totaux de revenus, les graphiques et les dépenses des clients sont convertis en USD au taux de référence de la BCE du jour de chaque achat, puis dans la devise d’affichage au taux du même jour.",
	"US dollar (USD)": "Dollar américain (USD)",
	"Euro (EUR)": "Euro (EUR)",
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
	"Manage the store catalog, packages and SDK-resolved offerings.":
		"Gérez le catalogue du store, les packages et les offres résolues par le SDK.",
	"Manage packages and SDK-resolved offerings.":
		"Gérez les packages et les offres résolues par le SDK.",
	"Manage the store product catalog.": "Gérez le catalogue des produits du store.",
	Entitlements: "Droits d’accès",
	'An entitlement represents a level of access, features, or content that a customer is "entitled" to. Many projects only have one entitlement, for example, "Pro access".':
		"Un droit d’accès représente un niveau d’accès, des fonctionnalités ou du contenu dont bénéficie un client. De nombreux projets n’ont qu’un seul droit d’accès, par exemple « Accès Pro ».",
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
	"No record.": "Aucun enregistrement.",
	"Store product": "Produit du store",
	"Transaction ID": "ID de transaction",
	Event: "Événement",
	Paywall: "Paywall",
	Occurred: "Survenu le",

	All: "Tous",
	Active: "Actifs",
	Inactive: "Inactifs",
	Archived: "Archivés",
	Draft: "Brouillon",
	From: "Du",
	To: "Au",
	"Financial customer": "Client financier",

	"Add entitlement": "Ajouter un droit d’accès",
	"Create entitlement": "Créer un droit d’accès",
	"Edit entitlement": "Modifier le droit d’accès",
	"Save entitlement": "Enregistrer le droit d’accès",
	"New offering": "Nouvelle offre",
	"Create offering": "Créer une offre",
	"Edit offering": "Modifier l’offre",
	"Save offering": "Enregistrer l’offre",
	"New package": "Nouveau package",
	"Create package": "Créer un package",
	"Edit package": "Modifier le package",
	"Save package": "Enregistrer le package",
	"New product": "Nouveau produit",
	"Create product": "Créer un produit",
	"Edit product": "Modifier le produit",
	"Save product": "Enregistrer le produit",
	"New iOS package": "Nouveau package iOS",
	"New Android package": "Nouveau package Android",
	"New test package": "Nouveau package de test",
	"Create Special Test Package": "Créer un package spécial de test",
	"Create special test package": "Créer un package spécial de test",
	"New iOS product": "Nouveau produit iOS",
	"New Android product": "Nouveau produit Android",
	"New test product": "Nouveau produit de test",
	"Create Special Test Product": "Créer un produit spécial de test",
	"Create special test product": "Créer un produit spécial de test",
	Product: "Produit",
	Package: "Package",
	Offering: "Offre",
	Cancel: "Annuler",

	Identifier: "Identifiant",
	"Display Name": "Nom affiché",
	"Display name": "Nom affiché",
	Description: "Description",
	Products: "Produits",
	Created: "Créé le",
	Actions: "Actions",
	Store: "Store",
	"Store Product": "Produit du Store",
	Position: "Position",
	State: "État",
	Packages: "Packages",
	Priority: "Priorité",
	Placement: "Emplacement",
	"Placement: {placement}": "Emplacement : {placement}",
	Started: "Démarré le",
	Environment: "Environnement",
	Status: "Statut",
	Type: "Type",
	Imported: "Importés",
	Deactivated: "Désactivés",

	"iOS (Apple App Store)": "iOS (Apple App Store)",
	"Android (Google Play)": "Android (Google Play)",
	"Offerings (SDK Placements)": "Offres (emplacements SDK)",
	"Special Test Package": "Package spécial de test",
	"Test & Sandbox Packages": "Packages de test et sandbox",
	"Dedicated sandbox packages allow the SDK to simulate purchases and verify entitlement unlocking without live App Store or Google Play transactions.":
		"Les packages sandbox dédiés permettent au SDK de simuler des achats et de vérifier le déblocage des droits d’accès sans transactions réelles sur l’App Store ou Google Play.",
	"Special Test Product": "Produit spécial de test",
	"Test & Sandbox Products": "Produits de test et sandbox",
	"Dedicated sandbox products allow simulation of purchases and entitlements in development and test environments.":
		"Les produits sandbox dédiés permettent de simuler les achats et les droits d’accès dans les environnements de développement et de test.",

	"No entitlements configured.": "Aucun droit d’accès configuré.",
	"No products": "Aucun produit",
	"No offerings configured.": "Aucune offre configurée.",
	"No iOS packages configured.": "Aucun package iOS configuré.",
	"No Android packages configured.": "Aucun package Android configuré.",
	"No test packages configured.": "Aucun package de test configuré.",
	"No special test packages configured yet.":
		"Aucun package spécial de test configuré pour l’instant.",
	"No iOS products configured.": "Aucun produit iOS configuré.",
	"No Android products configured.": "Aucun produit Android configuré.",
	"No test products configured yet.": "Aucun produit de test configuré pour l’instant.",
	"No catalog synchronization runs yet.": "Aucune synchronisation du catalogue pour l’instant.",
	"No active products available.": "Aucun produit actif disponible.",
	Unlinked: "Non lié",
	"Test / Sandbox": "Test / Sandbox",

	"Import Apple App Store, Google Play or Sandbox catalog payloads.":
		"Importez les catalogues Apple App Store, Google Play ou Sandbox.",
	"Synchronize catalog": "Synchroniser le catalogue",
	"Catalog JSON": "JSON du catalogue",

	"A purchasable catalog item": "Un article de catalogue achetable",
	"Connect a product to an offering": "Associer un produit à une offre",
	"Special package for testing without store credentials":
		"Package spécial pour tester sans identifiants de store",
	"Resolve packages for an SDK placement": "Résoudre les packages pour un emplacement SDK",
	"Identifiers are stable public keys exposed to the SDK.":
		"Les identifiants sont des clés publiques stables exposées au SDK.",
	"Product type": "Type de produit",
	Subscription: "Abonnement",
	"Non-consumable": "Non-consommable",
	Consumable: "Consommable",
	"Description (optional)": "Description (facultatif)",
	"Optional description": "Description facultative",
	"Package product": "Produit du package",
	"No product (standalone / test package)": "Aucun produit (package autonome / test)",
	"Included Packages": "Packages inclus",

	"Identifier (e.g. premium)": "Identifiant (ex. premium)",
	"Display name (e.g. Premium access)": "Nom affiché (ex. Accès Premium)",
	"e.g. premium_monthly": "ex. premium_monthly",
	"e.g. Premium Monthly": "ex. Premium Mensuel",
	"e.g. demo_premium_apple_1m": "ex. demo_premium_apple_1m",
	"e.g. Premium iOS — 1 mois": "ex. Premium iOS — 1 mois",
	"e.g. demo_default": "ex. demo_default",
	"e.g. Default Offering": "ex. Offre par défaut",
	"e.g. default, ios, android, test": "ex. default, ios, android, test",

	"Entitlement created": "Droit d’accès créé",
	"Entitlement updated": "Droit d’accès mis à jour",
	"Entitlement archived": "Droit d’accès archivé",
	"Offering created": "Offre créée",
	"Offering updated": "Offre mise à jour",
	"Offering archived": "Offre archivée",
	"Package created": "Package créé",
	"Package updated": "Package mis à jour",
	"Package archived": "Package archivé",
	"Product created": "Produit créé",
	"Product updated": "Produit mis à jour",
	"Product archived": "Produit archivé",
	"Store catalog synchronized": "Catalogue du store synchronisé",
	"Catalog must be valid JSON.": "Le catalogue doit être un JSON valide.",
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

function displayName(type: "region" | "language", value: string, locale: string) {
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
		};
	}, [locale]);
}
