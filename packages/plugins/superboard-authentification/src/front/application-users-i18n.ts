import { useFrontContext } from "@superboard/front-ui/context";

const french: Record<string, string> = {
	"Administrator access required": "Accès administrateur requis",
	"Application identity and purchase state contains personal data and is available only to project owners and administrators.":
		"Les identités et les achats sont accessibles aux propriétaires et aux administrateurs du projet.",
	"No application user matches this search.": "Aucun utilisateur ne correspond à cette recherche.",
	"Previous users": "Utilisateurs précédents",
	"Next users": "Utilisateurs suivants",
	"Anonymous user": "Utilisateur anonyme",
	Anonymous: "Anonyme",
	"Loading identity and purchase state…": "Chargement de l’identité et des achats…",
	"Linked authentication": "Méthodes de connexion liées",
	"No provider email": "Aucun email fourni",
	Password: "Mot de passe",
	"Configured; credential material is never exposed.":
		"Configuré ; les informations secrètes ne sont jamais affichées.",
	"Loading subscriptions, entitlements and paywall activity…":
		"Chargement des abonnements, droits et activité…",
	"Purchases and paywall": "Achats et écrans d’abonnement",
	"This is a valid free account. It remains visible even without a subscription, entitlement or paywall event.":
		"Ce compte gratuit reste visible même sans abonnement, droit ou achat.",
	"No entitlement.": "Aucun droit.",
	event: "événement",
	"unknown placement": "emplacement inconnu",
	"{start}–{end} of {total}": "{start}–{end} sur {total}",
	"{count} active": "{count} actives",
	"{email} · linked {date}": "{email} · lié le {date}",
	"Identity is available. Purchase details are temporarily unavailable: {message}":
		"L’identité est disponible. Les détails des achats sont temporairement indisponibles : {message}",
	"User sheet": "Fiche utilisateur",
	"View in Communication › Audience": "Voir dans Communication › Audience",
	"Authentication emails and sign-ins": "E-mails d’authentification et connexions",
	"View in Support": "Voir dans le Support",
	"View events": "Voir les événements",
	"Unable to load users": "Impossible de charger les utilisateurs",
	"All users": "Tous les utilisateurs",
	"1 user": "1 utilisateur",
	"{count} users": "{count} utilisateurs",
	"Search by name, email or ID": "Rechercher par nom, e-mail ou identifiant",
	Person: "Personne",
	"Sign-in": "Connexion",
	Session: "Session",
	"Signed up": "Inscription",
	Active: "Active",
	Inactive: "Inactive",
	"Never signed in": "Jamais connecté",
	"Last sign-in": "Dernière connexion",
	"No sign-in method.": "Aucune méthode de connexion.",
	"{subscriptions} active subscriptions · {events} paywall events":
		"{subscriptions} abonnements actifs · {events} événements d’écran d’abonnement",
	"Elsewhere in SuperBoard": "Ailleurs dans SuperBoard",
};

export function useApplicationUsersI18n() {
	const { locale } = useFrontContext();
	const t = (message: string, values: Record<string, string | number> = {}) => {
		const template = locale === "fr" ? (french[message] ?? message) : message;
		return template.replace(/\{(\w+)\}/gu, (match, key: string) => String(values[key] ?? match));
	};
	return { t, locale };
}
