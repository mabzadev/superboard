import { hasPermission, toRoleLevel } from "@emdash-cms/auth";
import {
	parseDeploymentConfiguration,
	type DeploymentConfiguration,
	type DeploymentRoute,
} from "@superboard/contracts/deployment-configuration";
import { canonicalFrontHref } from "@superboard/contracts/front-paths";
import type {
	PluginDeclaredConfiguration,
	PluginDependencyDiagnostic,
	PluginDiagnosticData,
	PluginHealthDiagnostic,
	PluginHealthStatus,
	PluginLifecycleDiagnostic,
	PluginLifecycleState,
	PluginRouteApiDiagnostic,
	PluginRouteViewDiagnostic,
	PluginWorkerDiagnostic,
} from "@superboard/contracts/plugin-diagnostic";
import {
	canonicalPluginId,
	LEGACY_PLUGIN_IDS,
	pluginPackage,
} from "@superboard/contracts/plugin-packages";
import { pluginWorkerHealthDefinition } from "@superboard/contracts/plugin-worker-health";
import type { RouteInventorySummary } from "@superboard/contracts/route-inventory";

import { WORKER_DEPLOYMENT_GROUPS } from "../../../../scripts/cloudflare/deployment-groups.mjs";
import packageCatalog from "../../../../scripts/config/superboard-plugin-catalog.json";
import { instanceConfiguration } from "./instance-configuration.js";
import { nativeFrontPluginCatalog } from "./native-front-plugins.js";
import { probeSuperBoardPluginWorkerReport } from "./plugin-readiness.js";
import type { SuperBoardSiteEnv } from "./site-env.js";
import {
	resolveSuperBoardPluginTarget,
	superBoardRuntimePluginCatalog,
} from "./superboard-plugin-catalog.js";

interface OperatorUser {
	id: string;
	role: number;
	disabled?: boolean;
}

export class DiagnosticAuthorizationError extends Error {
	constructor(
		public code: "AUTHENTICATION_REQUIRED" | "OPERATOR_REQUIRED",
		public status: 401 | 403,
	) {
		super(code);
	}
}

export class PluginNotFoundError extends Error {
	constructor() {
		super("PLUGIN_NOT_FOUND");
	}
}

export class PluginDisabledError extends Error {
	constructor(public pluginId: string) {
		super(`Plugin is disabled: ${pluginId}`);
	}
}

function assertDiagnosticOperator(
	user: OperatorUser | null | undefined,
): asserts user is OperatorUser {
	if (!user?.id || user.disabled) {
		throw new DiagnosticAuthorizationError("AUTHENTICATION_REQUIRED", 401);
	}
	try {
		const role = toRoleLevel(user.role);
		if (!hasPermission({ role }, "plugins:manage")) {
			throw new DiagnosticAuthorizationError("OPERATOR_REQUIRED", 403);
		}
	} catch (error) {
		if (error instanceof DiagnosticAuthorizationError) throw error;
		throw new DiagnosticAuthorizationError("OPERATOR_REQUIRED", 403);
	}
}

export async function resolvePluginDiagnostic(
	env: SuperBoardSiteEnv,
	requestedPluginId: string,
	user: OperatorUser | null | undefined,
	options: { recheckHealth?: boolean; includeDisabled?: boolean } = {},
): Promise<PluginDiagnosticData> {
	assertDiagnosticOperator(user);

	const canonical = pluginPackage(requestedPluginId);
	if (
		!canonical &&
		!superBoardRuntimePluginCatalog().plugins.some(
			({ manifest }) => manifest.plugin_id === requestedPluginId,
		)
	)
		throw new PluginNotFoundError();
	const targetPackageId = canonical?.directory ?? canonicalPluginId(requestedPluginId);
	const legacyIds = Object.entries(LEGACY_PLUGIN_IDS)
		.filter(([, target]) => target === targetPackageId)
		.map(([legacy]) => legacy);
	const pluginId =
		requestedPluginId === canonical?.directory
			? canonical.directory
			: legacyIds.includes(requestedPluginId)
				? requestedPluginId
				: canonical
					? canonical.id
					: requestedPluginId;
	const useCanonicalIds = requestedPluginId === canonical?.directory;
	const label = canonical ? canonical.label : requestedPluginId;
	const aliasIds = canonical
		? [
				...new Set([
					canonical.id,
					canonical.directory,
					targetPackageId,
					...canonical.components,
					...legacyIds,
				]),
			]
		: [requestedPluginId];
	const target = resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT ?? "local");
	const instanceId = env.SUPERBOARD_INSTANCE_ID;

	// 1. Plugin Lifecycle
	let lifecycle: PluginLifecycleDiagnostic = {
		state: "available",
		changedAt: null,
		reason: null,
		artifactChecksum: null,
		planId: null,
		activatedReleaseId: null,
	};

	try {
		let row = await env.DB.prepare(
			`SELECT state, state_changed_at, reason, artifact_checksum, plan_id, activated_release_id
			 FROM superboard_plugin_lifecycle
			 WHERE instance_id = ? AND target = ? AND plugin_id = ?
			 LIMIT 1`,
		)
			.bind(instanceId, target, requestedPluginId)
			.first<{
				state: PluginLifecycleState;
				state_changed_at: string | null;
				reason: string | null;
				artifact_checksum: string | null;
				plan_id: string | null;
				activated_release_id: string | null;
			}>();

		if (!row) {
			row = await env.DB.prepare(
				`SELECT state, state_changed_at, reason, artifact_checksum, plan_id, activated_release_id
				 FROM superboard_plugin_lifecycle
				 WHERE instance_id = ? AND target = ? AND plugin_id IN (${aliasIds.map(() => "?").join(",")})
				 ORDER BY CASE state WHEN 'disabled' THEN 1 WHEN 'active' THEN 2 ELSE 3 END
				 LIMIT 1`,
			)
				.bind(instanceId, target, ...aliasIds)
				.first<{
					state: PluginLifecycleState;
					state_changed_at: string | null;
					reason: string | null;
					artifact_checksum: string | null;
					plan_id: string | null;
					activated_release_id: string | null;
				}>();
		}

		if (row) {
			lifecycle = {
				state: row.state,
				changedAt: row.state_changed_at,
				reason: row.reason,
				artifactChecksum: row.artifact_checksum,
				planId: row.plan_id,
				activatedReleaseId: row.activated_release_id,
			};
		} else {
			// Fallback check in _plugin_state if table exists
			const stateRow = await env.DB.prepare(
				`SELECT status, activated_at, installed_at FROM _plugin_state WHERE plugin_id = ? LIMIT 1`,
			)
				.bind(pluginId)
				.first<{ status: string; activated_at: string | null; installed_at: string | null }>()
				.catch(() => null);
			if (stateRow) {
				lifecycle = {
					state: stateRow.status === "active" ? "active" : "installed",
					changedAt: stateRow.activated_at ?? stateRow.installed_at,
					reason: null,
				};
			}
		}
	} catch {
		// Retain default lifecycle state if DB error occurs
	}

	if (lifecycle.state === "disabled" && !options.includeDisabled) {
		throw new PluginDisabledError(pluginId);
	}

	// 2. Declared Configuration
	const catalog = superBoardRuntimePluginCatalog();
	const catalogEntry =
		packageCatalog.plugins.find(
			(entry) =>
				entry.directory === targetPackageId ||
				entry.manifest.plugin_id === targetPackageId ||
				aliasIds.includes(entry.manifest.plugin_id),
		) ??
		catalog.plugins.find(
			({ manifest }) =>
				manifest.plugin_id === targetPackageId || aliasIds.includes(manifest.plugin_id),
		);
	const manifest =
		useCanonicalIds && catalogEntry && "canonical_manifest" in catalogEntry
			? catalogEntry.canonical_manifest
			: catalogEntry?.manifest;
	const componentIds = catalog.plugins
		.map(({ manifest: component }) => component.plugin_id)
		.filter((id) => aliasIds.includes(id));
	const serviceHealth = new Map<string, PluginHealthDiagnostic>();
	const observedComponents = new Set<string>();

	const configuration: PluginDeclaredConfiguration = {
		pluginId: manifest?.plugin_id ?? pluginId,
		version: manifest?.plugin_version ?? "1.0.0",
		label,
		capabilities: manifest?.capabilities ?? [],
		failurePolicies: {
			reads: manifest?.failure_policies?.reads ?? "unavailable",
			writes: manifest?.failure_policies?.writes ?? "fail_closed",
		},
		settingsSchema:
			manifest?.settings?.schema && typeof manifest.settings.schema === "object"
				? manifest.settings.schema
				: null,
	};

	// 3. Verified Health & Dependencies
	let health: PluginHealthDiagnostic = {
		status: "unknown",
		checkedAt: null,
		reason: null,
	};

	const dependencies: PluginDependencyDiagnostic[] = [];
	const componentProofs: PluginHealthDiagnostic[] = [];

	try {
		// Read dependency health records
		const depRows = await env.DB.prepare(
			`SELECT dependency_id, status, checked_at, expires_at
			 FROM superboard_dependency_health
			 WHERE instance_id = ?`,
		)
			.bind(instanceId)
			.all<{
				dependency_id: string;
				status: "ready" | "unavailable";
				checked_at: string;
				expires_at: string;
			}>();

		const now = Date.now();
		const pluginDepPrefixes = aliasIds.map((id) => `dependency.${id.replaceAll("-", "_")}`);

		for (const row of depRows.results) {
			const isThisPlugin = pluginDepPrefixes.some(
				(prefix) => row.dependency_id === prefix || row.dependency_id.startsWith(`${prefix}.`),
			);
			const isExpired =
				!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= now;
			const depStatus: PluginHealthStatus = isExpired
				? "expired"
				: row.status === "ready"
					? "ready"
					: "unavailable";

			for (const componentId of componentIds) {
				const prefix = `dependency.${componentId.replaceAll("-", "_")}`;
				if (row.dependency_id !== prefix && !row.dependency_id.startsWith(`${prefix}.`)) continue;
				observedComponents.add(componentId);
				const observation: PluginHealthDiagnostic = {
					status: depStatus === "unavailable" ? "unknown" : depStatus,
					checkedAt: row.checked_at,
					reason: isExpired ? "HEALTH_PROOF_EXPIRED" : null,
				};
				for (const probe of pluginWorkerHealthDefinition(componentId)?.workers ?? []) {
					const previous = serviceHealth.get(probe.service);
					serviceHealth.set(
						probe.service,
						leastAvailableHealth(previous ? [previous, observation] : [observation]),
					);
				}
			}
			if (isThisPlugin) {
				componentProofs.push({
					status: depStatus,
					checkedAt: row.checked_at,
					reason: isExpired ? "Health proof expired" : null,
				});
			}

			if (manifest?.resources?.includes(row.dependency_id) || isThisPlugin) {
				dependencies.push({
					id: useCanonicalIds
						? canonicalDependencyId(row.dependency_id, aliasIds)
						: row.dependency_id,
					status: depStatus,
					expiresAt: row.expires_at,
					checkedAt: row.checked_at,
				});
			}
		}
	} catch {
		// DB table missing or query error
	}
	for (const componentId of componentIds) {
		if (!observedComponents.has(componentId))
			componentProofs.push({ status: "unknown", checkedAt: null, reason: "HEALTH_PROOF_MISSING" });
	}
	health = leastAvailableHealth(componentProofs);

	// If health status is unknown, or if explicit recheck requested, probe health
	if (options.recheckHealth || health.status === "unknown") {
		const reports = await Promise.all(
			componentIds.map(async (componentId) => {
				const probes = pluginWorkerHealthDefinition(componentId)?.workers ?? [];
				try {
					const report = await probeSuperBoardPluginWorkerReport(env, componentId, {
						operator_id: user.id,
						instance_id: env.SUPERBOARD_INSTANCE_ID,
						role: user.role,
					});
					for (const probe of probes) {
						const observation = report.services.find(
							(item) => item.service === probe.service && item.binding === probe.binding,
						);
						serviceHealth.set(
							probe.service,
							observation
								? {
										status: observation.status,
										checkedAt: observation.checked_at,
										reason: observation.reason,
									}
								: { status: "unknown", checkedAt: null, reason: "WORKER_HEALTH_NOT_VERIFIED" },
						);
					}
					return {
						status: report.status,
						checkedAt: report.checked_at,
						reason: report.reason ?? null,
					};
				} catch {
					for (const probe of probes)
						serviceHealth.set(probe.service, {
							status: "unknown",
							checkedAt: null,
							reason: "WORKER_HEALTH_NOT_VERIFIED",
						});
					return {
						status: "unavailable" as const,
						checkedAt: new Date().toISOString(),
						reason: "PLUGIN_WORKER_HEALTH_UNAVAILABLE",
					};
				}
			}),
		);
		health = leastAvailableHealth(reports);
	}

	// 4. Associated Services and Cloudflare Workers
	let deploymentConfig: DeploymentConfiguration | null = null;
	if (env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON) {
		try {
			deploymentConfig = parseDeploymentConfiguration(env.SUPERBOARD_DEPLOYMENT_CONFIGURATION_JSON);
		} catch {
			deploymentConfig = null;
		}
	}

	let liveRoutes: DeploymentRoute[] = [];
	let routeInventory: RouteInventorySummary | undefined;
	try {
		const live = await instanceConfiguration(env, user, new Request("https://site.internal/"));
		deploymentConfig = live.configuration;
		liveRoutes = live.routes;
		routeInventory = live.routeInventory;
	} catch {
		liveRoutes = [];
	}

	const pluginServices = [
		...new Set(
			componentIds.flatMap((id) =>
				(pluginWorkerHealthDefinition(id)?.workers ?? []).map((probe) => probe.service),
			),
		),
	];
	const workers: PluginWorkerDiagnostic[] = [];

	for (const service of pluginServices) {
		const workerEntry = deploymentConfig?.workers.find((worker) =>
			worker.modules.includes(service),
		);
		const groupDef = deploymentConfig
			? undefined
			: WORKER_DEPLOYMENT_GROUPS.find((group) => group.services.includes(service));
		const deploymentGroup = workerEntry?.id ?? groupDef?.id ?? "unknown";
		const groupServices = workerEntry?.modules ?? groupDef?.services ?? [service];
		const sharedWith = groupServices.filter((module) => module !== service);
		const isShared = sharedWith.length > 0;
		const physicalName = workerEntry?.name ?? null;

		workers.push({
			health: serviceHealth.get(service) ?? {
				status: "unknown",
				checkedAt: null,
				reason: "HEALTH_PROOF_MISSING",
			},
			service,
			workerName: service,
			physicalName,
			deploymentGroup,
			modules: groupServices,
			isShared,
			sharedWith,
		});
	}

	// 5. Routes (Views and API)
	const views: PluginRouteViewDiagnostic[] = [];
	for (const plugin of nativeFrontPluginCatalog()) {
		if (!aliasIds.includes(plugin.plugin_id)) continue;
		for (const view of plugin.surfaces) {
			if (
				plugin.plugin_id === "superboard-user" &&
				new URL(canonicalFrontHref(view.path_pattern), "https://superboard.invalid").pathname !==
					view.path_pattern
			)
				continue;
			views.push({
				routeId: view.route_id ?? view.path_pattern,
				path: view.path_pattern,
				method: "GET",
			});
		}
	}

	const apiRoutes: PluginRouteApiDiagnostic[] = [];
	for (const route of liveRoutes) {
		if (route.surface !== "sdk") continue;
		if (
			targetPackageId === "superboard-analytics" &&
			route.path !== "/v1/analytics" &&
			!route.path.startsWith("/v1/analytics/")
		)
			continue;
		if (targetPackageId === "superboard-data" && !route.path.startsWith("/v1/data/")) continue;
		if (
			targetPackageId === "superboard-authentification" &&
			route.path !== "/v1/auth" &&
			!route.path.startsWith("/v1/auth/")
		)
			continue;

		if (
			targetPackageId === "superboard-support" &&
			route.path !== "/v1/support" &&
			!route.path.startsWith("/v1/support/")
		)
			continue;

		const routePluginId = route.pluginId;
		const routeOwnerId = routePluginId ? canonicalPluginId(routePluginId) : undefined;
		const belongsToPlugin =
			(routeOwnerId !== undefined &&
				(routeOwnerId === targetPackageId ||
					(routePluginId !== undefined && aliasIds.includes(routePluginId)))) ||
			(targetPackageId === "superboard-core" && route.pluginId === "supbrd-core");
		if (belongsToPlugin)
			apiRoutes.push({
				id: route.id,
				destinations: route.destinations,
				transport: route.transport,
				executionScope: route.executionScope,
				kind: route.kind,
				availability: route.availability,
				observedAt: route.observedAt,
				buildId: route.buildId,
				method: route.method,
				path: route.path,
				surface: route.surface,
				url: route.url,
				worker: route.worker,
			});
	}

	if (
		(targetPackageId === "superboard-data" ||
			targetPackageId === "superboard-analytics" ||
			targetPackageId === "superboard-authentification" ||
			targetPackageId === "superboard-support") &&
		routeInventory
	) {
		const services = new Set([
			...pluginServices,
			...apiRoutes.flatMap((route) => [
				...(route.worker ? [route.worker] : []),
				...(route.destinations ?? []).map((destination) => destination.service),
			]),
		]);
		routeInventory = {
			...routeInventory,
			sources: routeInventory.sources.filter((source) => services.has(source.service)),
		};
	}

	return {
		pluginId: targetPackageId,
		label,
		lifecycle,
		configuration: {
			...configuration,
			pluginId: targetPackageId,
		},
		health,
		dependencies,
		workers,
		routes: {
			inventory: routeInventory,
			views,
			api: [
				...new Map(
					apiRoutes.map((route) => [`${route.method}:${route.path}:${route.surface}`, route]),
				).values(),
			],
		},
	};
}

function canonicalDependencyId(id: string, pluginIds: readonly string[]) {
	for (const pluginId of pluginIds) {
		const prefix = `dependency.${pluginId.replaceAll("-", "_")}`;
		if (id === prefix || id.startsWith(`${prefix}.`))
			return canonicalPluginId(`${pluginId}.dependency.${id.slice(prefix.length + 1) || "health"}`);
	}
	return id;
}

function leastAvailableHealth(
	observations: readonly PluginHealthDiagnostic[],
): PluginHealthDiagnostic {
	const priority = { unavailable: 0, expired: 1, unknown: 2, ready: 3 };
	return (
		observations.toSorted((left, right) => priority[left.status] - priority[right.status])[0] ?? {
			status: "unknown",
			checkedAt: null,
			reason: "HEALTH_PROOF_MISSING",
		}
	);
}

export async function pluginDiagnosticEtag(
	diagnostic: PluginDiagnosticData,
	envelope: string | null,
): Promise<string> {
	const inventory = diagnostic.routes.inventory;
	const stable = {
		...diagnostic,
		routes: {
			...diagnostic.routes,
			api: diagnostic.routes.api.map(({ observedAt: _observedAt, ...route }) => route),
			inventory: inventory
				? {
						revision: inventory.revision,
						sources: inventory.sources.map(({ observedAt: _observedAt, ...source }) => source),
					}
				: undefined,
		},
	};
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(JSON.stringify({ stable, envelope })),
	);
	return `W/"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}
