const en = {
	title: "AI assistant access",
	description: "Control which AI assistants can use the tools of this environment through MCP.",
	tokens: "Authorized applications",
	tokensDescription:
		"Assistants allowed to act on this environment. Revoke access to disconnect one.",
	authorized: "Authorized",
	authorizedOn: "Authorized on {date}",
	noTokens: "No application is authorized yet.",
	revoke: "Revoke access",
	revokeTitle: "Revoke access for {name}?",
	revokeDescription:
		"This application can no longer use the tools of this environment. It must be authorized again to reconnect.",
	cancel: "Cancel",
	refresh: "Refresh",
	advanced: "Advanced",
	advancedDescription:
		"A session groups your calls for 15 minutes. Each call uses a temporary credential which is revoked when it finishes.",
	runner: "Test a tool",
	runnerDescription: "Runs an MCP tool with your own access to check what it returns.",
	tool: "Tool",
	schema: "Expected arguments",
	session: "Invocation session",
	fresh: "Start a new session",
	arguments: "Arguments (JSON)",
	invoke: "Run tool",
	invalid: "Arguments must be a JSON object.",
	result: "Tool result",
	sessions: "Invocation sessions",
	sessionsDescription: "Sessions opened by your tool runs.",
	expiresOn: "Expires on {date}",
	receipts: "Invocation receipts",
	receiptsDescription: "History of tool runs and their outcome.",
	errorCode: "Error code: {code}",
	"status:completed": "Completed",
	"status:running": "Running",
	"status:failed": "Failed",
	"status:active": "Active",
	"status:expired": "Expired",
	empty: "No records yet.",
	next: "Next receipts",
	first: "First receipts",
};

type McpMessage = keyof typeof en;

const fr: Record<McpMessage, string> = {
	title: "Accès des assistants IA",
	description:
		"Contrôlez quels assistants IA peuvent utiliser les outils de cet environnement via MCP.",
	tokens: "Applications autorisées",
	tokensDescription:
		"Assistants autorisés à agir sur cet environnement. Révoquez l’accès pour en déconnecter un.",
	authorized: "Autorisée",
	authorizedOn: "Autorisée le {date}",
	noTokens: "Aucune application n’est encore autorisée.",
	revoke: "Révoquer l’accès",
	revokeTitle: "Révoquer l’accès de {name} ?",
	revokeDescription:
		"Cette application ne pourra plus utiliser les outils de cet environnement. Elle devra être autorisée à nouveau pour se reconnecter.",
	cancel: "Annuler",
	refresh: "Actualiser",
	advanced: "Avancé",
	advancedDescription:
		"Une session regroupe vos appels pendant 15 minutes. Chaque appel utilise un accès temporaire révoqué dès sa fin.",
	runner: "Tester un outil",
	runnerDescription: "Exécute un outil MCP avec votre propre accès pour vérifier ce qu’il renvoie.",
	tool: "Outil",
	schema: "Arguments attendus",
	session: "Session d’invocation",
	fresh: "Commencer une nouvelle session",
	arguments: "Arguments (JSON)",
	invoke: "Exécuter l’outil",
	invalid: "Les arguments doivent être un objet JSON.",
	result: "Résultat de l’outil",
	sessions: "Sessions d’invocation",
	sessionsDescription: "Sessions ouvertes par vos exécutions d’outils.",
	expiresOn: "Expire le {date}",
	receipts: "Reçus d’invocation",
	receiptsDescription: "Historique des exécutions d’outils et de leur résultat.",
	errorCode: "Code d’erreur : {code}",
	"status:completed": "Terminé",
	"status:running": "En cours",
	"status:failed": "Échec",
	"status:active": "Active",
	"status:expired": "Expirée",
	empty: "Aucun enregistrement.",
	next: "Reçus suivants",
	first: "Premiers reçus",
};

const placeholder = /\{(\w+)\}/gu;

export function mcpText(locale: string) {
	const catalog = locale === "fr" ? fr : en;
	return (key: McpMessage, values: Record<string, string | number> = {}) =>
		catalog[key].replace(placeholder, (match, name: string) => String(values[name] ?? match));
}
