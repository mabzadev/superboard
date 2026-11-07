import { useOptionalFrontContext } from "@superboard/front-ui/context";

const messages = {
	en: {
		title: "Access Key",
		description:
			"Authenticate public SuperBoard SDK requests without exposing an administrative session.",
		keyTitle: "Project Access Key",
		keyDescription: "Scoped to the selected project and environment.",
		status: "Status",
		active: "Active",
		revoked: "Revoked",
		notConfigured: "Not configured",
		unavailable: "Unavailable",
		key: "Key",
		noKey: "No key created",
		copy: "Copy full Access Key",
		copied: "Access Key copied",
		rotated: "Access Key rotated. Copy it now; the full secret will not be shown again.",
		oneTimeTitle: "One-time secret",
		oneTimeDescription:
			"Store this value in your app configuration now. Refreshing this page permanently hides it.",
		prefix: "Prefix",
		created: "Created",
		lastUsed: "Last used",
		never: "Never",
		rotate: "Rotate Access Key",
		create: "Create Access Key",
		refresh: "Refresh status",
		sdkTitle: "SDK initialization",
		sdkDescription:
			"Use the full key only in client SDK initialization, never in the Dashboard API.",
		rotateTitle: "Rotate Access Key?",
		createTitle: "Create Access Key?",
		rotateDescription:
			"The existing key is revoked immediately. Deployed applications must be updated with the new value.",
		createDescription: "The full secret is displayed only once after creation.",
		cancel: "Cancel",
		rotateConfirm: "Rotate key",
		createConfirm: "Create key",
	},
	fr: {
		title: "Clé d’accès",
		description:
			"Authentifie les requêtes publiques du SDK SuperBoard sans exposer de session d’administration.",
		keyTitle: "Clé d’accès du projet",
		keyDescription: "Limitée au projet et à l’environnement sélectionnés.",
		status: "État",
		active: "Active",
		revoked: "Révoquée",
		notConfigured: "Non configurée",
		unavailable: "Indisponible",
		key: "Clé",
		noKey: "Aucune clé créée",
		copy: "Copier la clé d’accès complète",
		copied: "Clé d’accès copiée",
		rotated:
			"Clé d’accès renouvelée. Copiez-la maintenant : le secret complet ne sera plus affiché.",
		oneTimeTitle: "Secret affiché une seule fois",
		oneTimeDescription:
			"Enregistrez cette valeur dans la configuration de votre application maintenant. Actualiser la page la masque définitivement.",
		prefix: "Préfixe",
		created: "Créée le",
		lastUsed: "Dernière utilisation",
		never: "Jamais",
		rotate: "Renouveler la clé d’accès",
		create: "Créer une clé d’accès",
		refresh: "Actualiser l’état",
		sdkTitle: "Initialisation du SDK",
		sdkDescription:
			"Utilisez la clé complète uniquement pour initialiser le SDK client, jamais dans l’API du tableau de bord.",
		rotateTitle: "Renouveler la clé d’accès ?",
		createTitle: "Créer une clé d’accès ?",
		rotateDescription:
			"La clé actuelle est révoquée immédiatement. Les applications déployées doivent être mises à jour avec la nouvelle valeur.",
		createDescription: "Le secret complet n’est affiché qu’une seule fois après la création.",
		cancel: "Annuler",
		rotateConfirm: "Renouveler la clé",
		createConfirm: "Créer la clé",
	},
} as const satisfies Record<"en" | "fr", Record<string, string>>;

export type AccessKeyMessage = keyof (typeof messages)["en"];

export function useAccessKeyI18n() {
	const locale = useOptionalFrontContext()?.locale === "fr" ? "fr" : "en";
	const catalog: Record<AccessKeyMessage, string> = messages[locale];
	return { locale, t: (id: AccessKeyMessage) => catalog[id] };
}
