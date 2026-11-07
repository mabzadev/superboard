const en = {
	title: "API routing",
	description:
		"Publish stable API paths that forward to plugin APIs, with rate limits and operator access control.",
	routes: "Routes",
	routesDescription: "Draft routes of the gateway. Select a route to edit it.",
	noRoutes: "No route yet.",
	new: "New route",
	forwardsTo: "Forwards to",
	perMinute: "{count} requests per minute",
	"route:published": "Published",
	"route:changed": "Changes not published",
	"route:draft": "Not published",
	newRoute: "New route",
	editRoute: "Edit route",
	editorDescription: "Saved routes stay drafts until the manifest is published.",
	id: "Route identifier",
	method: "Method",
	alias: "Gateway path",
	target: "Target API path",
	limit: "Requests per minute",
	save: "Save draft route",
	publication: "Publication",
	publicationDescription: "Publishing the manifest applies every draft route at once.",
	manifest: "Gateway manifest",
	"manifest:published": "Published",
	"manifest:none": "Not published",
	manifestId: "Manifest {id}",
	publish: "Publish gateway manifest",
	access: "Access",
	accessDescription:
		"Operators allowed to call the gateway routes. Saving replaces the current list.",
	policy: "Allowed operator IDs (comma separated; empty allows authenticated operators)",
	rotate: "Update access policy",
	policyUnavailable:
		"The current access policy could not be loaded. Reload the page before changing it so the allowed operators are not erased.",
	advanced: "Advanced",
	advancedDescription:
		"Gateway aliases are available under /api/v1/gateway/proxy. Direct plugin APIs remain available independently.",
	testTitle: "Test a published route",
	testDescription: "Calls a route of the published manifest with the values below.",
	parameters: "Route parameters (JSON)",
	payload: "Request body (JSON)",
	test: "Test {route}",
	result: "Result",
	resultDescription: "Raw response of the last action.",
	limits: "Recent rate counters",
	limitsDescription: "Requests counted per route and per minute over the last hour.",
	route: "Route",
	minute: "Minute",
	requests: "Requests",
	noLimits: "No request counted over the last hour.",
};

type GatewayMessage = keyof typeof en;

const fr: Record<GatewayMessage, string> = {
	title: "Routage de l’API",
	description:
		"Publiez des chemins d’API stables qui redirigent vers les API des plugins, avec limites de débit et contrôle d’accès des opérateurs.",
	routes: "Routes",
	routesDescription: "Routes brouillon de la passerelle. Sélectionnez une route pour la modifier.",
	noRoutes: "Aucune route pour l’instant.",
	new: "Nouvelle route",
	forwardsTo: "Redirige vers",
	perMinute: "{count} requêtes par minute",
	"route:published": "Publiée",
	"route:changed": "Modifications non publiées",
	"route:draft": "Non publiée",
	newRoute: "Nouvelle route",
	editRoute: "Modifier la route",
	editorDescription:
		"Les routes enregistrées restent des brouillons jusqu’à la publication du manifeste.",
	id: "Identifiant de route",
	method: "Méthode",
	alias: "Chemin de la passerelle",
	target: "Chemin API cible",
	limit: "Requêtes par minute",
	save: "Enregistrer la route brouillon",
	publication: "Publication",
	publicationDescription:
		"Publier le manifeste applique toutes les routes brouillon en une seule fois.",
	manifest: "Manifeste de la passerelle",
	"manifest:published": "Publié",
	"manifest:none": "Non publié",
	manifestId: "Manifeste {id}",
	publish: "Publier le manifeste",
	access: "Accès",
	accessDescription:
		"Opérateurs autorisés à appeler les routes de la passerelle. L’enregistrement remplace la liste actuelle.",
	policy:
		"Identifiants des opérateurs autorisés (séparés par des virgules ; vide autorise les opérateurs authentifiés)",
	rotate: "Mettre à jour la politique d’accès",
	policyUnavailable:
		"La politique d’accès actuelle n’a pas pu être chargée. Rechargez la page avant de la modifier pour ne pas effacer les opérateurs autorisés.",
	advanced: "Avancé",
	advancedDescription:
		"Les alias sont accessibles sous /api/v1/gateway/proxy. Les API directes des plugins restent disponibles indépendamment.",
	testTitle: "Tester une route publiée",
	testDescription: "Appelle une route du manifeste publié avec les valeurs ci-dessous.",
	parameters: "Paramètres de route (JSON)",
	payload: "Corps de la requête (JSON)",
	test: "Tester {route}",
	result: "Résultat",
	resultDescription: "Réponse brute de la dernière action.",
	limits: "Compteurs récents",
	limitsDescription: "Requêtes comptées par route et par minute sur la dernière heure.",
	route: "Route",
	minute: "Minute",
	requests: "Requêtes",
	noLimits: "Aucune requête comptée sur la dernière heure.",
};

const placeholder = /\{(\w+)\}/gu;

export function gatewayText(locale: string) {
	const catalog = locale === "fr" ? fr : en;
	return (key: GatewayMessage, values: Record<string, string | number> = {}) =>
		catalog[key].replace(placeholder, (match, name: string) => String(values[name] ?? match));
}
