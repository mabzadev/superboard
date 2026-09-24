import { useFrontContext } from "@superboard/front-ui/context";

const french: Record<string, string> = {
	"Application users": "Utilisateurs d’application",
	"Authentication, linked Google or Apple identities, sessions, subscriptions, entitlements and paywall activity.":
		"Authentification, identités Google ou Apple liées, sessions, abonnements et activité des écrans d’abonnement.",
	"Administrator access required": "Accès administrateur requis",
	"Application identity and purchase state contains personal data and is available only to project owners and administrators.":
		"Les identités et les achats sont accessibles aux propriétaires et aux administrateurs du projet.",
	"Account search": "Rechercher un compte",
	"Data comes from the Identity Worker and D1 database configured for this deployment target. Passwords, tokens and provider subject identifiers are never returned.":
		"Rechercher les comptes et consulter leurs méthodes de connexion et leurs sessions.",
	"Email, user ID, name or auth provider": "Email, identifiant, nom ou fournisseur de connexion",
	Search: "Rechercher",
	Refresh: "Actualiser",
	Users: "Utilisateurs",
	Account: "Compte",
	Authentication: "Authentification",
	Sessions: "Sessions",
	Created: "Création",
	"No application user matches this search.": "Aucun utilisateur ne correspond à cette recherche.",
	"0 users": "0 utilisateur",
	"Previous users": "Utilisateurs précédents",
	"Next users": "Utilisateurs suivants",
	"Anonymous user": "Utilisateur anonyme",
	Anonymous: "Anonyme",
	"Email verified": "Email vérifié",
	"Email unverified": "Email non vérifié",
	"Loading identity and purchase state…": "Chargement de l’identité et des achats…",
	"Select a user to inspect authentication, entitlements, subscriptions and paywall activity.":
		"Sélectionnez un utilisateur pour consulter son authentification, ses droits et ses abonnements.",
	Email: "Email",
	"Not provided": "Non renseigné",
	"Email state": "État de l’email",
	Verified: "Vérifié",
	Unverified: "Non vérifié",
	"Not applicable": "Sans objet",
	"Active sessions": "Sessions actives",
	"Last authentication": "Dernière connexion",
	"Linked authentication": "Méthodes de connexion liées",
	"No provider email": "Aucun email fourni",
	Password: "Mot de passe",
	"Configured; credential material is never exposed.":
		"Configuré ; les informations secrètes ne sont jamais affichées.",
	"Loading subscriptions, entitlements and paywall activity…":
		"Chargement des abonnements, droits et activité…",
	"Purchase state has not been loaded.": "Les achats n’ont pas été chargés.",
	"Purchases and paywall": "Achats et écrans d’abonnement",
	"No financial customer exists for this user.": "Cet utilisateur n’a pas de fiche de facturation.",
	"This is a valid free account. It remains visible even without a subscription, entitlement or paywall event.":
		"Ce compte gratuit reste visible même sans abonnement, droit ou achat.",
	"Purchase state unavailable": "Achats indisponibles",
	"Server-verified state from the optional Billing capability.":
		"État des achats vérifié par le service de facturation.",
	"Active subscriptions": "Abonnements actifs",
	"Paywall events": "Événements des écrans d’abonnement",
	Entitlements: "Droits",
	"No entitlement.": "Aucun droit.",
	"Recent paywall activity": "Activité récente des écrans d’abonnement",
	event: "événement",
	"unknown placement": "emplacement inconnu",
	"No paywall activity.": "Aucune activité.",
	Never: "Jamais",
	"All authentication views": "Toutes les vues d’authentification",
	"{count} active application accounts, including users without a purchase.":
		"{count} comptes applicatifs, y compris les utilisateurs sans achat.",
	"{start}–{end} of {total}": "{start}–{end} sur {total}",
	"{count} active": "{count} actives",
	"Inspect {user}": "Consulter {user}",
	"{email} · linked {date}": "{email} · lié le {date}",
	"Sessions: {total} total · {active} active · {revoked} revoked · {expired} expired":
		"Sessions : {total} au total · {active} actives · {revoked} révoquées · {expired} expirées",
	"Identity is available. Purchase details are temporarily unavailable: {message}":
		"L’identité est disponible. Les détails des achats sont temporairement indisponibles : {message}",
};

export function useApplicationUsersI18n() {
	const { locale } = useFrontContext();
	const t = (message: string, values: Record<string, string | number> = {}) => {
		const template = locale === "fr" ? (french[message] ?? message) : message;
		return template.replace(/\{(\w+)\}/gu, (match, key: string) => String(values[key] ?? match));
	};
	return { t, locale };
}
