const serviceProbes = {
	app: { binding: "APP_MODULE", path: "/internal/v1/health" },
	identity: { binding: "IDENTITY_SERVICE", path: "/health" },
	products: { binding: "PRODUCTS_MODULE", path: "/internal/v1/health" },
	billing: { binding: "BILLING", path: "/internal/v1/health" },
	support: { binding: "SUPPORT_MODULE", path: "/internal/v1/health" },
	flows: { binding: "FLOWS_MODULE", path: "/internal/v1/health" },
	analytics: { binding: "ANALYTICS_MODULE", path: "/internal/v1/health" },
	marketing: { binding: "MARKETING_MODULE", path: "/internal/v1/health" },
	email: { binding: "EMAIL_SERVICE", path: "/internal/v1/health" },
	"dynamic-links": { binding: "DYNAMIC_LINKS_MODULE", path: "/internal/v1/health" },
	files: { binding: "FILES_SERVICE", path: "/health" },
	paywalls: { binding: "PAYWALLS_MODULE", path: "/internal/v1/health" },
	onboardings: { binding: "ONBOARDINGS_MODULE", path: "/internal/v1/health" },
	observability: { binding: "OBSERVABILITY", path: "/internal/v1/health" },
	mcp: { binding: "MCP_SERVICE", path: "/health" },
} as const;

type Service = keyof typeof serviceProbes;
const plugins: Readonly<Record<string, { native: boolean; services: readonly Service[] }>> = {
	"supbrd-plug-user": { native: true, services: ["app", "identity"] },
	"supbrd-plug-settings": { native: true, services: ["app"] },
	"supbrd-plug-content": { native: true, services: [] },
	"supbrd-plug-products": { native: true, services: ["products"] },
	"supbrd-plug-audit": { native: true, services: [] },
	"supbrd-plugmod-gateway": { native: true, services: [] },
	"supbrd-plugmod-billing": { native: false, services: ["billing"] },
	"supbrd-plugmod-support": { native: false, services: ["support"] },
	"supbrd-plugmod-flows": { native: false, services: ["flows"] },
	"supbrd-plugmod-analytics": { native: false, services: ["analytics"] },
	"supbrd-plugmod-marketing": { native: false, services: ["marketing"] },
	"supbrd-plugmod-email": { native: false, services: ["email"] },
	"supbrd-plugmod-dynamic-links": { native: false, services: ["dynamic-links"] },
	"supbrd-plugmod-files": { native: false, services: ["files"] },
	"supbrd-plugmod-paywalls": { native: false, services: ["paywalls"] },
	"supbrd-plugmod-onboardings": { native: false, services: ["onboardings"] },
	"supbrd-plugmod-observability": { native: false, services: ["observability"] },
	"supbrd-plugmod-mcp": { native: false, services: ["mcp"] },
};

export function pluginWorkerHealthDefinition(pluginId: string) {
	const plugin = plugins[pluginId];
	return plugin
		? {
				native: plugin.native,
				workers: plugin.services.map((service) => ({ service, ...serviceProbes[service] })),
			}
		: null;
}
export type PluginWorkerProbe = NonNullable<
	ReturnType<typeof pluginWorkerHealthDefinition>
>["workers"][number];

export interface WorkerServiceHealth {
	service: string;
	binding: string;
	status: "ready" | "unavailable";
	checked_at: string;
	reason: string | null;
}
export interface PluginWorkerHealthReport {
	plugin_id: string;
	status: "ready" | "unavailable";
	checked_at: string | null;
	services: WorkerServiceHealth[];
	evidence?: unknown;
	reason?: string;
	error?: { code: string };
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
	if (typeof value !== "string") throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
	return value;
}
function status(value: unknown): "ready" | "unavailable" {
	if (value !== "ready" && value !== "unavailable") throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
	return value;
}
function timestamp(value: unknown): string {
	const result = text(value);
	if (!Number.isFinite(Date.parse(result))) throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
	return result;
}
export function parsePluginWorkerHealthReport(value: unknown): PluginWorkerHealthReport {
	if (!record(value)) throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
	const state = status(value.status);
	const checkedAt =
		value.checked_at === undefined || value.checked_at === null
			? null
			: timestamp(value.checked_at);
	if (state === "ready" && checkedAt === null) throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
	const services: WorkerServiceHealth[] = [];
	if (value.services !== undefined) {
		if (!Array.isArray(value.services)) throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
		const values: unknown[] = value.services;
		for (const item of values) {
			if (!record(item)) throw new Error("PLUGIN_WORKER_HEALTH_INVALID");
			services.push({
				service: text(item.service),
				binding: text(item.binding),
				status: status(item.status),
				checked_at: timestamp(item.checked_at),
				reason: item.reason === null ? null : text(item.reason),
			});
		}
	}
	return {
		plugin_id: text(value.plugin_id),
		status: state,
		checked_at: checkedAt,
		services,
		...(value.evidence === undefined ? {} : { evidence: value.evidence }),
		...(value.reason === undefined ? {} : { reason: text(value.reason) }),
		...(record(value.error) ? { error: { code: text(value.error.code) } } : {}),
	};
}
