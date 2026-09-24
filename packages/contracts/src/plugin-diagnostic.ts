export type PluginLifecycleState =
	| "available"
	| "staged"
	| "installed"
	| "active"
	| "draining"
	| "disabled"
	| "quarantined"
	| "purged";

export interface PluginLifecycleDiagnostic {
	state: PluginLifecycleState;
	changedAt: string | null;
	reason: string | null;
	artifactChecksum?: string | null;
	planId?: string | null;
	activatedReleaseId?: string | null;
}

export interface PluginDeclaredConfiguration {
	pluginId: string;
	version: string;
	label: string;
	capabilities: string[];
	failurePolicies: {
		reads: string;
		writes: string;
	};
	settingsSchema?: Record<string, unknown> | null;
}

export type PluginHealthStatus = "ready" | "unavailable" | "unknown" | "expired";

export interface PluginHealthDiagnostic {
	status: PluginHealthStatus;
	checkedAt: string | null;
	reason: string | null;
	evidence?: unknown;
}

export interface PluginDependencyDiagnostic {
	id: string;
	status: PluginHealthStatus;
	expiresAt: string | null;
	checkedAt: string | null;
}

export interface PluginWorkerDiagnostic {
	health?: PluginHealthDiagnostic;
	service: string;
	workerName: string;
	physicalName: string | null;
	deploymentGroup: string;
	modules: string[];
	isShared: boolean;
	sharedWith: string[];
}

export interface PluginRouteViewDiagnostic {
	routeId: string;
	path: string;
	method: string;
}

export interface PluginRouteApiDiagnostic {
	method: string;
	path: string;
	surface?: string;
	url?: string;
	worker?: string;
}

export interface PluginRoutesDiagnostic {
	views: PluginRouteViewDiagnostic[];
	api: PluginRouteApiDiagnostic[];
}

export interface PluginDiagnosticData {
	pluginId: string;
	label: string;
	lifecycle: PluginLifecycleDiagnostic;
	configuration: PluginDeclaredConfiguration;
	health: PluginHealthDiagnostic;
	dependencies: PluginDependencyDiagnostic[];
	workers: PluginWorkerDiagnostic[];
	routes: PluginRoutesDiagnostic;
}

function diagnosticRecord(value: unknown): Record<string, unknown> {
	if (!isDiagnosticRecord(value)) throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	return value;
}
function isDiagnosticRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function diagnosticText(value: unknown): string {
	if (typeof value !== "string") throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	return value;
}
function optionalDiagnosticText(value: unknown): string | undefined {
	return value === undefined ? undefined : diagnosticText(value);
}
function nullableDiagnosticText(value: unknown): string | null {
	return value === null ? null : diagnosticText(value);
}
function diagnosticList(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	return value;
}
function diagnosticBoolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	return value;
}
function lifecycleState(value: unknown): PluginLifecycleState {
	switch (value) {
		case "available":
		case "staged":
		case "installed":
		case "active":
		case "draining":
		case "disabled":
		case "quarantined":
		case "purged":
			return value;
		default:
			throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	}
}
function healthStatus(value: unknown): PluginHealthStatus {
	switch (value) {
		case "ready":
		case "unavailable":
		case "unknown":
		case "expired":
			return value;
		default:
			throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	}
}

export function parsePluginHealth(value: unknown): PluginHealthDiagnostic {
	const row = diagnosticRecord(value);
	const status = healthStatus(row.status);
	const checkedAt = nullableDiagnosticText(row.checkedAt);
	if (
		(checkedAt !== null && !Number.isFinite(Date.parse(checkedAt))) ||
		(status === "ready" && checkedAt === null)
	)
		throw new Error("PLUGIN_DIAGNOSTIC_INVALID");
	return {
		status,
		checkedAt,
		reason: nullableDiagnosticText(row.reason),
		...(row.evidence === undefined ? {} : { evidence: row.evidence }),
	};
}

export function parsePluginDiagnostic(value: unknown): PluginDiagnosticData {
	const row = diagnosticRecord(value);
	const lifecycle = diagnosticRecord(row.lifecycle);
	const configuration = diagnosticRecord(row.configuration);
	const policies = diagnosticRecord(configuration.failurePolicies);
	const routes = diagnosticRecord(row.routes);
	return {
		pluginId: diagnosticText(row.pluginId),
		label: diagnosticText(row.label),
		lifecycle: {
			state: lifecycleState(lifecycle.state),
			changedAt: nullableDiagnosticText(lifecycle.changedAt),
			reason: nullableDiagnosticText(lifecycle.reason),
			...(lifecycle.artifactChecksum === undefined
				? {}
				: { artifactChecksum: nullableDiagnosticText(lifecycle.artifactChecksum) }),
			...(lifecycle.planId === undefined
				? {}
				: { planId: nullableDiagnosticText(lifecycle.planId) }),
			...(lifecycle.activatedReleaseId === undefined
				? {}
				: { activatedReleaseId: nullableDiagnosticText(lifecycle.activatedReleaseId) }),
		},
		configuration: {
			pluginId: diagnosticText(configuration.pluginId),
			version: diagnosticText(configuration.version),
			label: diagnosticText(configuration.label),
			capabilities: diagnosticList(configuration.capabilities).map(diagnosticText),
			failurePolicies: {
				reads: diagnosticText(policies.reads),
				writes: diagnosticText(policies.writes),
			},
			...(configuration.settingsSchema === undefined
				? {}
				: {
						settingsSchema:
							configuration.settingsSchema === null
								? null
								: diagnosticRecord(configuration.settingsSchema),
					}),
		},
		health: parsePluginHealth(row.health),
		dependencies: diagnosticList(row.dependencies).map((value) => {
			const item = diagnosticRecord(value);
			return {
				id: diagnosticText(item.id),
				status: healthStatus(item.status),
				expiresAt: nullableDiagnosticText(item.expiresAt),
				checkedAt: nullableDiagnosticText(item.checkedAt),
			};
		}),
		workers: diagnosticList(row.workers).map((value) => {
			const item = diagnosticRecord(value);
			return {
				...(item.health === undefined ? {} : { health: parsePluginHealth(item.health) }),
				service: diagnosticText(item.service),
				workerName: diagnosticText(item.workerName),
				physicalName: nullableDiagnosticText(item.physicalName),
				deploymentGroup: diagnosticText(item.deploymentGroup),
				modules: diagnosticList(item.modules).map(diagnosticText),
				isShared: diagnosticBoolean(item.isShared),
				sharedWith: diagnosticList(item.sharedWith).map(diagnosticText),
			};
		}),
		routes: {
			views: diagnosticList(routes.views).map((value) => {
				const item = diagnosticRecord(value);
				return {
					routeId: diagnosticText(item.routeId),
					path: diagnosticText(item.path),
					method: diagnosticText(item.method),
				};
			}),
			api: diagnosticList(routes.api).map((value) => {
				const item = diagnosticRecord(value);
				return {
					method: diagnosticText(item.method),
					path: diagnosticText(item.path),
					surface: optionalDiagnosticText(item.surface),
					url: optionalDiagnosticText(item.url),
					worker: optionalDiagnosticText(item.worker),
				};
			}),
		},
	};
}
