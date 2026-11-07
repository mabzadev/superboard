import { useOptionalFrontContext } from "@superboard/front-ui/context";
import { useMemo } from "react";

const fr = {
	"Service health": "État des services",
	"Live status of the SuperBoard API, Workers, data stores, users and background jobs.":
		"État en direct de l’API SuperBoard, des Workers, du stockage, des utilisateurs et des tâches de fond.",
	"Status unavailable": "État indisponible",
	"Unable to load the service status.": "Impossible de charger l’état des services.",
	"Worker catalog misconfigured": "Catalogue des Workers mal configuré",
	"The target Worker inventory is unavailable.":
		"L’inventaire des Workers de la cible est indisponible.",
	Overview: "Vue d’ensemble",
	"Overall platform status and recent activity.":
		"État général de la plateforme et activité récente.",
	Platform: "Plateforme",
	Users: "Utilisateurs",
	Projects: "Projets",
	Instances: "Instances",
	"Application users": "Utilisateurs de l’application",
	"Premium application users": "Utilisateurs premium de l’application",
	"Invocations ({window})": "Invocations ({window})",
	"Public availability": "Disponibilité publique",
	"DNS and HTTPS checks of the public addresses, separate from the internal Worker health.":
		"Vérifications DNS et HTTPS des adresses publiques, indépendantes de l’état interne des Workers.",
	"No public address is monitored.": "Aucune adresse publique n’est surveillée.",
	"No response": "Aucune réponse",
	Visit: "Consulter",
	"Data stores": "Stockage des données",
	"Owner and live availability of each data store. Raw SQL is never exposed here.":
		"Propriétaire et disponibilité en direct de chaque stockage. Le SQL brut n’est jamais exposé ici.",
	Schema: "Schéma",
	"Expected migration: {name}": "Migration attendue : {name}",
	"Applied migration: {name} · {count} in total": "Migration appliquée : {name} · {count} au total",
	None: "Aucune",
	"Running configuration": "Configuration exécutée",
	"Profile, source and checksum of the configuration this environment runs.":
		"Profil, source et empreinte de la configuration exécutée par cet environnement.",
	Checksum: "Empreinte",
	"Addresses where each service of this environment answers, with the Worker that serves it.":
		"Adresses auxquelles répond chaque service de cet environnement, avec le Worker qui le sert.",
	Access: "Accès",
	"Who may call the routes of this environment.":
		"Qui peut appeler les routes de cet environnement.",
	"Former addresses kept so existing integrations keep working.":
		"Anciennes adresses conservées pour que les intégrations existantes continuent de fonctionner.",
	"Workers that run this environment and the modules each one hosts.":
		"Workers qui exécutent cet environnement et modules hébergés par chacun.",
	"Routes served to the SDK, mobile and web apps, with their destination.":
		"Routes servies au SDK et aux applications mobiles et web, avec leur destination.",
	Inventory: "Inventaire",
	"Current record counts in the API database.":
		"Nombre actuel d’enregistrements dans la base de l’API.",
	"Background jobs": "Tâches de fond",
	"Persisted job state; the Cloudflare Queue backlog stays available in Cloudflare analytics.":
		"État enregistré des tâches ; l’arriéré des files Cloudflare reste consultable dans Cloudflare Analytics.",
	Unavailable: "Indisponible",
	"Email delivery": "Envoi des e-mails",
	"Transactional, marketing and test emails handled by the Email Worker, without their content.":
		"E-mails transactionnels, marketing et de test traités par le Worker e-mail, sans leur contenu.",
	"Queue backlog": "Messages en attente",
	"Backlog size": "Taille de l’arriéré",
	"Oldest queued message": "Plus ancien message en attente",
	"Cloudflare Queue metrics are unavailable for this target.":
		"Les métriques de file Cloudflare sont indisponibles pour cette cible.",
	"Email operations are unavailable.": "Les opérations e-mail sont indisponibles.",
	"Email operations are disabled or unavailable.":
		"Les opérations e-mail sont désactivées ou indisponibles.",
	"No email has been recorded.": "Aucun e-mail enregistré.",
	Message: "Message",
	Kind: "Type",
	Status: "État",
	Recipients: "Destinataires",
	Attempts: "Tentatives",
	"Last error": "Dernière erreur",
	Updated: "Mise à jour",
	"{count} failed": "{count} en échec",
	Transactional: "Transactionnel",
	Marketing: "Marketing",
	Test: "Test",
	"Delegated SMTP transport": "Transport SMTP délégué",
	"Project SMTP deliveries sent by the Email Worker; unknown outcomes are never retried automatically.":
		"Envois SMTP des projets réalisés par le Worker e-mail ; les résultats inconnus ne sont jamais relancés automatiquement.",
	"No delegated SMTP delivery has been recorded.": "Aucun envoi SMTP délégué enregistré.",
	"{source} · project {project} · profile {profile} · {attempts} attempts":
		"{source} · projet {project} · profil {profile} · {attempts} tentatives",
	"Email quarantine": "Quarantaine des e-mails",
	"Emails that failed for good. Only those kept without secret redaction can be sent again.":
		"E-mails en échec définitif. Seuls ceux conservés sans masquage de secret peuvent être renvoyés.",
	"Email quarantine is disabled or unavailable.":
		"La quarantaine des e-mails est désactivée ou indisponible.",
	"Email quarantine is empty.": "La quarantaine des e-mails est vide.",
	"Unknown job": "Tâche inconnue",
	"{job} · {attempts} attempts · {queue}": "{job} · {attempts} tentatives · {queue}",
	Replay: "Renvoyer",
	Discard: "Écarter",
	"Replay email dead letter {id}": "Renvoyer l’e-mail en quarantaine {id}",
	"Discard email dead letter {id}": "Écarter l’e-mail en quarantaine {id}",
	"Discard this email?": "Écarter cet e-mail ?",
	"The email leaves the quarantine and will never be sent. This cannot be undone.":
		"L’e-mail sort de la quarantaine et ne sera jamais envoyé. Cette action est irréversible.",
	"Unable to resolve this quarantined email.": "Impossible de traiter cet e-mail en quarantaine.",
	"Account deletions": "Suppressions de comptes",
	"Progress of account deletions across services; people are pseudonymized.":
		"Avancement des suppressions de comptes dans les services ; les personnes sont pseudonymisées.",
	"No account deletion has been recorded.": "Aucune suppression de compte enregistrée.",
	Operation: "Opération",
	Project: "Projet",
	"Subject reference": "Référence de la personne",
	"Completed steps": "Étapes terminées",
	"Application services": "Services de l’application",
	"Services specific to this application, run by its own Worker.":
		"Services propres à cette application, exécutés par son propre Worker.",
	"Custom Worker unavailable": "Worker de l’application indisponible",
	"Premium users": "Utilisateurs premium",
	"Application jobs": "Tâches de l’application",
	"Cancelled jobs": "Tâches annulées",
	"Refunds pending": "Remboursements en attente",
	"Refunds applied": "Remboursements effectués",
	"Credits refunded": "Crédits remboursés",
	Job: "Tâche",
	Capability: "Capacité",
	Progress: "Progression",
	Result: "Résultat",
	Action: "Action",
	Retry: "Réessayer",
	"Retrying…": "Nouvelle tentative…",
	"No application job has been recorded.": "Aucune tâche de l’application enregistrée.",
	"Unable to retry this job.": "Impossible de relancer cette tâche.",
	"Invalid acceptance receipt": "Reçu d’acceptation invalide",
	"{decision} · platform {platform} · reference {reference}":
		"{decision} · plateforme {platform} · référence {reference}",
	unproven: "non prouvée",
	"On request": "Sur requête",
	Queue: "File d’attente",
	Scheduled: "Planifiée",
	Advanced: "Avancé",
	"Technical details for operators: deployment, addresses, API, Workers, runtime metrics and running configuration.":
		"Détails techniques pour l’exploitation : déploiement, adresses, API, Workers, métriques d’exécution et configuration exécutée.",
	Deployment: "Déploiement",
	"Target, environment and release currently served.":
		"Cible, environnement et version actuellement servis.",
	Target: "Cible",
	Environment: "Environnement",
	Release: "Version",
	"Public routing": "Routage public",
	"Generated at": "Généré le",
	"Integration addresses": "Adresses d’intégration",
	"Public addresses generated from the active target manifest.":
		"Adresses publiques générées par le manifeste de la cible active.",
	API: "API",
	SDK: "SDK",
	"Short links": "Liens courts",
	Site: "Site",
	Dashboard: "Tableau de bord",
	Files: "Fichiers",
	MCP: "MCP",
	"API capabilities": "Capacités de l’API",
	"What the SuperBoard API exposes and who can call it.":
		"Ce que l’API SuperBoard expose et qui peut l’appeler.",
	"Access: {access}": "Accès : {access}",
	Workers: "Workers",
	"Deployment name, role, health, dependencies and persisted jobs of each Worker.":
		"Nom de déploiement, rôle, état, dépendances et tâches enregistrées de chaque Worker.",
	"No deployment name": "Aucun nom de déploiement",
	legacy: "historique",
	"Health check: {mode} {path} · {time}": "Contrôle : {mode} {path} · {time}",
	unknown: "inconnu",
	Capabilities: "Capacités",
	Routes: "Routes",
	Services: "Services",
	Stores: "Stockages",
	Queues: "Files",
	"External: {binding} → {worker}": "Externe : {binding} → {worker}",
	"Jobs: {jobs}": "Tâches : {jobs}",
	"Runtime detail": "Détail d’exécution",
	"{invocations} invocations · {exceptions} exceptions":
		"{invocations} invocations · {exceptions} exceptions",
	"Cloudflare runtime": "Exécution Cloudflare",
	"Tail Worker and Analytics Engine metrics over the last {window}.":
		"Métriques du Tail Worker et d’Analytics Engine sur la période ({window}).",
	"Observability binding is disabled.": "La liaison d’observabilité est désactivée.",
	"Runtime metrics unavailable": "Métriques d’exécution indisponibles",
	"No invocation has been recorded in this window.":
		"Aucune invocation enregistrée sur cette période.",
	Worker: "Worker",
	Event: "Événement",
	Outcome: "Résultat",
	Invocations: "Invocations",
	Exceptions: "Exceptions",
	"Average CPU": "CPU moyen",
	"Average duration": "Durée moyenne",
	"Maximum duration": "Durée maximale",
	"Updated {date}": "Mis à jour le {date}",
	"{name}: {value}": "{name} : {value}",
	Refresh: "Actualiser",
	"Observed incidents": "Incidents observés",
	"Errors detected on the services, to acknowledge then resolve.":
		"Erreurs détectées sur les services, à acquitter puis à résoudre.",
	"No incidents recorded.": "Aucun incident enregistré.",
	"Loading observations…": "Chargement des observations…",
	"Refresh observations": "Actualiser les observations",
	Acknowledge: "Acquitter",
	Resolve: "Résoudre",
	Resolution: "Résolution",
	"Next page": "Page suivante",
	"First page": "Première page",
	"Occurrences: {count} · Last observation: {date}":
		"Occurrences : {count} · Dernière observation : {date}",
	"Latest service health": "Dernier état des services",
	"Health reflects the latest invocation; observations older than five minutes are marked unknown.":
		"L’état reflète la dernière invocation ; les observations de plus de cinq minutes sont marquées inconnues.",
	"No service health has been observed yet.": "Aucun état de service observé pour l’instant.",
	"Worker observations": "Observations des Workers",
	"Invocations, exceptions and durations per service over the last hour.":
		"Invocations, exceptions et durées par service sur la dernière heure.",
	"No Worker observations received. No availability or activity is inferred from an empty window.":
		"Aucune observation de Worker reçue. Une période vide ne permet pas de déduire la disponibilité ou l’activité.",
	Service: "Service",
	Healthy: "Opérationnel",
	Degraded: "Dégradé",
	Off: "Désactivé",
	Misconfigured: "Mal configuré",
	Configured: "Configuré",
	Declared: "Déclaré",
	"Up to date": "À jour",
	Behind: "En retard",
	Drifted: "Divergent",
	Incompatible: "Incompatible",
	Accepted: "Accepté",
	Queued: "En file d’attente",
	Dispatched: "Transmis",
	Running: "En cours",
	Completed: "Terminé",
	Failed: "Échec",
	Cancelled: "Annulé",
	Rejected: "Refusé",
	Processing: "En cours de traitement",
	Captured: "Capturé",
	Sending: "Envoi en cours",
	Sent: "Envoyé",
	"Outcome unknown": "Résultat inconnu",
	Quarantined: "En quarantaine",
	Discarded: "Écarté",
	Replayed: "Renvoyé",
	Open: "Ouvert",
	Acknowledged: "Acquitté",
	Resolved: "Résolu",
	Unhealthy: "En erreur",
	Unknown: "Inconnu",
	Active: "Actif",
	Staged: "En préparation",
	Pending: "En attente",
	"Release pending": "Publication en attente",
	Released: "Publié",
	Succeeded: "Réussi",
	Exception: "Exception",
	"CPU limit exceeded": "Limite CPU dépassée",
	"Memory limit exceeded": "Limite mémoire dépassée",
	Disconnected: "Déconnecté",
	"Script not found": "Script introuvable",
} as const satisfies Record<string, string>;

export type ObservabilityMessage = keyof typeof fr;
export type BadgeVariant = "success" | "warning" | "destructive" | "secondary" | "default";

const statuses: Record<string, [ObservabilityMessage, BadgeVariant]> = {
	ok: ["Healthy", "success"],
	healthy: ["Healthy", "success"],
	degraded: ["Degraded", "warning"],
	unavailable: ["Unavailable", "destructive"],
	disabled: ["Off", "secondary"],
	misconfigured: ["Misconfigured", "destructive"],
	configured: ["Configured", "success"],
	declared: ["Declared", "success"],
	current: ["Up to date", "success"],
	behind: ["Behind", "warning"],
	drifted: ["Drifted", "destructive"],
	incompatible: ["Incompatible", "destructive"],
	accepted: ["Accepted", "warning"],
	queued: ["Queued", "warning"],
	dispatched: ["Dispatched", "warning"],
	running: ["Running", "warning"],
	completed: ["Completed", "success"],
	failed: ["Failed", "destructive"],
	cancelled: ["Cancelled", "secondary"],
	canceled: ["Cancelled", "secondary"],
	rejected: ["Rejected", "destructive"],
	processing: ["Processing", "warning"],
	captured: ["Captured", "warning"],
	sending: ["Sending", "warning"],
	sent: ["Sent", "success"],
	outcome_unknown: ["Outcome unknown", "warning"],
	quarantined: ["Quarantined", "warning"],
	discarded: ["Discarded", "secondary"],
	replayed: ["Replayed", "success"],
	open: ["Open", "destructive"],
	acknowledged: ["Acknowledged", "warning"],
	resolved: ["Resolved", "success"],
	unhealthy: ["Unhealthy", "destructive"],
	unknown: ["Unknown", "secondary"],
	active: ["Active", "success"],
	staged: ["Staged", "warning"],
	pending: ["Pending", "warning"],
	"pending-release": ["Release pending", "warning"],
	released: ["Released", "success"],
};

const outcomes: Record<string, [ObservabilityMessage, BadgeVariant]> = {
	ok: ["Succeeded", "success"],
	exception: ["Exception", "destructive"],
	exceededCpu: ["CPU limit exceeded", "destructive"],
	exceededMemory: ["Memory limit exceeded", "destructive"],
	canceled: ["Cancelled", "secondary"],
	responseStreamDisconnected: ["Disconnected", "warning"],
	scriptNotFound: ["Script not found", "destructive"],
	unknown: ["Unknown", "secondary"],
};

const names: Record<string, ObservabilityMessage> = {
	users: "Users",
	projects: "Projects",
	instances: "Instances",
	applicationUsers: "Application users",
	premiumApplicationUsers: "Premium application users",
	api: "API",
	sdk: "SDK",
	shortLinks: "Short links",
	site: "Site",
	dashboard: "Dashboard",
	files: "Files",
	mcp: "MCP",
	transactional: "Transactional",
	marketing: "Marketing",
	test: "Test",
	request: "On request",
	queue: "Queue",
	scheduled: "Scheduled",
};

const camelBoundary = /([a-z0-9])([A-Z])/gu;
const separators = /[-_]+/gu;
const placeholder = /\{(\w+)\}/gu;

export function observabilityI18n(locale: "en" | "fr") {
	const t = (key: ObservabilityMessage, values: Record<string, string | number> = {}) =>
		(locale === "fr" ? fr[key] : key).replace(placeholder, (match, name: string) =>
			name in values ? String(values[name]) : match,
		);
	const numberFormat = new Intl.NumberFormat(locale);
	const number = (value: number | null | undefined) =>
		value == null ? t("Unavailable") : numberFormat.format(value);
	const unit = (
		value: number,
		name: string,
		digits = 0,
		display: "short" | "long" | "narrow" = "short",
	) =>
		new Intl.NumberFormat(locale, {
			style: "unit",
			unit: name,
			unitDisplay: display,
			maximumFractionDigits: digits,
		}).format(value);
	return {
		locale,
		t,
		number,
		date: (value: string | null | undefined) =>
			value ? new Date(value).toLocaleString(locale) : "—",
		duration(milliseconds: number | null | undefined) {
			if (milliseconds == null) return "—";
			if (milliseconds < 10) return unit(milliseconds, "millisecond", 2);
			if (milliseconds < 1000) return unit(milliseconds, "millisecond");
			if (milliseconds < 60_000) return unit(milliseconds / 1000, "second", 1);
			return unit(milliseconds / 60_000, "minute", 1);
		},
		window(minutes: number) {
			if (minutes >= 1440 && minutes % 1440 === 0) return unit(minutes / 1440, "day", 0, "long");
			if (minutes >= 60 && minutes % 60 === 0) return unit(minutes / 60, "hour", 0, "long");
			return unit(minutes, "minute", 0, "long");
		},
		bytes(value: number) {
			if (value < 1024) return unit(value, "byte", 0, "narrow");
			if (value < 1024 ** 2) return unit(value / 1024, "kilobyte", 1);
			if (value < 1024 ** 3) return unit(value / 1024 ** 2, "megabyte", 1);
			return unit(value / 1024 ** 3, "gigabyte", 1);
		},
		message(text: string) {
			return text in fr ? t(text as ObservabilityMessage) : text;
		},
		status(value: string) {
			const known = statuses[value];
			return known
				? { label: t(known[0]), variant: known[1] }
				: { label: value, variant: "default" as const };
		},
		outcome(value: string) {
			const known = outcomes[value] ?? statuses[value];
			return known
				? { label: t(known[0]), variant: known[1] }
				: { label: value, variant: "default" as const };
		},
		name(key: string) {
			const known = names[key];
			if (known) return t(known);
			const words = key.replace(camelBoundary, "$1 $2").replace(separators, " ").toLowerCase();
			return words.charAt(0).toUpperCase() + words.slice(1);
		},
	};
}

export type ObservabilityI18n = ReturnType<typeof observabilityI18n>;

export function useObservabilityI18n() {
	const locale = useOptionalFrontContext()?.locale === "fr" ? "fr" : "en";
	return useMemo(() => observabilityI18n(locale), [locale]);
}
