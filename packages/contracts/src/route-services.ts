export const routeServices = {
	api: {
		binding: null,
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["MODULE_INTERNAL_TOKEN", "MODULE_INTERNAL_TOKEN_PREVIOUS"],
	},
	site: {
		binding: "SITE_SERVICE",
		apiSecret: "SITE_OPERATOR_BRIDGE_TOKEN",
		workerSecrets: ["SITE_OPERATOR_BRIDGE_TOKEN"],
	},
	identity: {
		binding: "IDENTITY_SERVICE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	app: {
		binding: "APP_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	products: {
		binding: "PRODUCTS_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	billing: {
		binding: "BILLING",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	paywalls: {
		binding: "PAYWALLS_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	onboardings: {
		binding: "ONBOARDINGS_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	"dynamic-links": {
		binding: "DYNAMIC_LINKS_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	flows: {
		binding: "FLOWS_MODULE",
		apiSecret: "FLOWS_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	analytics: {
		binding: "ANALYTICS_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	marketing: {
		binding: "MARKETING_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	support: {
		binding: "SUPPORT_MODULE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: ["INTERNAL_API_TOKEN", "INTERNAL_API_TOKEN_PREVIOUS"],
	},
	email: {
		binding: "EMAIL_SERVICE",
		apiSecret: "EMAIL_INTERNAL_TOKEN",
		workerSecrets: ["EMAIL_INTERNAL_TOKEN", "EMAIL_INTERNAL_TOKEN_PREVIOUS"],
	},
	files: {
		binding: "FILES_SERVICE",
		apiSecret: "FILES_INTERNAL_TOKEN",
		workerSecrets: ["FILES_INTERNAL_TOKEN", "FILES_INTERNAL_TOKEN_PREVIOUS"],
	},
	observability: {
		binding: "OBSERVABILITY",
		apiSecret: "OBSERVABILITY_INTERNAL_TOKEN",
		workerSecrets: ["OBSERVABILITY_INTERNAL_TOKEN", "OBSERVABILITY_INTERNAL_TOKEN_PREVIOUS"],
	},
	mcp: {
		binding: "MCP_SERVICE",
		apiSecret: "MODULE_INTERNAL_TOKEN",
		workerSecrets: [],
		authorizeViaApi: true,
	},
	custom: {
		binding: "CUSTOM_WORKER",
		apiSecret: "CUSTOM_WORKER_TOKEN",
		workerSecrets: ["CUSTOM_WORKER_TOKEN", "CUSTOM_WORKER_TOKEN_PREVIOUS"],
	},
} as const;

export function routeService<K extends keyof typeof routeServices>(service: K): (typeof routeServices)[K];
export function routeService(service: string): (typeof routeServices)[keyof typeof routeServices] | undefined;
export function routeService(service: string) {
	return Object.entries(routeServices).find(([name]) => name === service)?.[1];
}
