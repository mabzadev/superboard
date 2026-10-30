import { projectDestinationRoute, routeDestinations } from "./route-registry.js";
import { signPluginTaskRequest } from "./internal-request-signature.js";
import { readJsonObjectLimited } from "./request-body.js";
import {
	parseRouteManifest,
	ROUTE_MANIFEST_PATH,
	serializeRouteManifest,
} from "./route-manifest.js";
import type { RouteDescriptor, RouteManifest } from "./route-registry.js";

export interface RouteSourceDefinition {
	service: string;
	workerName: string;
	enabled: boolean;
	binding?: { fetch(request: Request): Promise<Response> };
	secret?: string;
}
export interface RouteSourceObservation {
	service: string;
	workerName: string;
	status: "current" | "stale" | "unavailable" | "disabled";
	observedAt: string | null;
	buildId: string | null;
	releaseId: string | null;
	reason: string | null;
}
export interface InventoryRoute extends RouteDescriptor {
	destinationBuildId?: string;
	buildId: string;
	releaseId?: string;
	observedAt: string;
	availability: "current" | "stale";
}
export interface RouteInventory {
	schemaVersion: 1;
	instanceId: string;
	environment: string;
	status: "complete" | "partial";
	versions: "consistent" | "mixed" | "unknown";
	issues?: string[];
	revision: string;
	checkedAt: string;
	sources: RouteSourceObservation[];
	routes: InventoryRoute[];
}
export type RouteInventorySummary = Omit<RouteInventory, "routes">;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
	if (typeof value !== "string" || value.length > 4096) throw new Error("ROUTE_INVENTORY_INVALID");
	return value;
}
function nullableText(value: unknown): string | null {
	return value === null ? null : text(value);
}
export function parseRouteInventorySummary(value: unknown): RouteInventorySummary {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.sources) ||
		value.sources.length > 128 ||
		(value.status !== "complete" && value.status !== "partial") ||
		(value.versions !== "consistent" && value.versions !== "mixed" && value.versions !== "unknown")
	)
		throw new Error("ROUTE_INVENTORY_INVALID");
	const sources = value.sources.map((source: unknown): RouteSourceObservation => {
		if (
			!record(source) ||
			(source.status !== "current" &&
				source.status !== "stale" &&
				source.status !== "unavailable" &&
				source.status !== "disabled")
		)
			throw new Error("ROUTE_INVENTORY_INVALID");
		return {
			service: text(source.service),
			workerName: text(source.workerName),
			status: source.status,
			observedAt: nullableText(source.observedAt),
			buildId: nullableText(source.buildId),
			releaseId: nullableText(source.releaseId),
			reason: nullableText(source.reason),
		};
	});
	return {
		schemaVersion: 1,
		instanceId: text(value.instanceId),
		environment: text(value.environment),
		revision: text(value.revision),
		checkedAt: text(value.checkedAt),
		status: value.status,
		versions: value.versions,
		issues: Array.isArray(value.issues) ? value.issues.map(text) : [],
		sources,
	};
}
interface CachedSource {
	manifest: RouteManifest;
	etag: string;
}

export function createRouteInventoryCollector() {
	const previous = new Map<string, CachedSource>();
	return async (input: {
		instanceId: string;
		environment: string;
		own: RouteManifest;
		sources: readonly RouteSourceDefinition[];
	}): Promise<RouteInventory> => {
		const routes: InventoryRoute[] = [];
		const sources: RouteSourceObservation[] = [];
		const append = (manifest: RouteManifest, availability: "current" | "stale") => {
			routes.push(
				...manifest.routes.map((route) => ({
					...route,
					buildId: manifest.buildId,
					...(manifest.releaseId ? { releaseId: manifest.releaseId } : {}),
					observedAt: manifest.observedAt,
					availability,
				})),
			);
		};
		if (input.own.instanceId !== input.instanceId || input.own.environment !== input.environment)
			throw new Error("ROUTE_RUNTIME_MISMATCH");
		append(input.own, "current");
		sources.push({
			service: input.own.service,
			workerName: input.own.service,
			status: "current",
			observedAt: input.own.observedAt,
			buildId: input.own.buildId,
			releaseId: input.own.releaseId ?? null,
			reason: null,
		});
		await Promise.all(
			input.sources.map(async (source) => {
				const key = `${input.instanceId}\0${input.environment}\0${source.service}\0${source.workerName}`;
				if (!source.enabled) {
					previous.delete(key);
					sources.push({
						service: source.service,
						workerName: source.workerName,
						status: "disabled",
						observedAt: null,
						buildId: null,
						releaseId: null,
						reason: null,
					});
					return;
				}
				const cached = previous.get(key);
				try {
					if (!source.binding || !source.secret) throw new Error("ROUTE_BINDING_UNAVAILABLE");
					const request = new Request(`https://${source.service}.internal${ROUTE_MANIFEST_PATH}`);
					const headers = await signPluginTaskRequest(request, source.secret);
					if (cached) headers.set("If-None-Match", cached.etag);
					const response = await source.binding.fetch(
						new Request(request, { headers, signal: AbortSignal.timeout(5000) }),
					);
					let manifest: RouteManifest;
					if (response.status === 304 && cached) {
						manifest = {
							...cached.manifest,
							observedAt:
								response.headers.get("x-superboard-observed-at") ?? new Date().toISOString(),
						};
					} else {
						if (!response.ok) {
							await response.body?.cancel();
							throw new Error(`ROUTE_MANIFEST_HTTP_${response.status}`);
						}
						manifest = parseRouteManifest(await readJsonObjectLimited(response, 4 * 1024 * 1024));
						if (
							manifest.service !== source.service ||
							manifest.instanceId !== input.instanceId ||
							manifest.environment !== input.environment
						)
							throw new Error("ROUTE_RUNTIME_MISMATCH");
						const verified = await serializeRouteManifest(manifest.routes, {
							service: manifest.service,
							instanceId: manifest.instanceId,
							environment: manifest.environment,
							buildId: manifest.buildId,
							...(manifest.releaseId ? { releaseId: manifest.releaseId } : {}),
						});
						if (verified.revision !== manifest.revision)
							throw new Error("ROUTE_MANIFEST_CHECKSUM_MISMATCH");
						previous.set(key, {
							manifest,
							etag: response.headers.get("etag") ?? `W/"${manifest.revision}"`,
						});
					}
					append(manifest, "current");
					sources.push({
						service: source.service,
						workerName: source.workerName,
						status: "current",
						observedAt: manifest.observedAt,
						buildId: manifest.buildId,
						releaseId: manifest.releaseId ?? null,
						reason: null,
					});
				} catch (error) {
					if (cached) append(cached.manifest, "stale");
					sources.push({
						service: source.service,
						workerName: source.workerName,
						status: cached ? "stale" : "unavailable",
						observedAt: cached?.manifest.observedAt ?? null,
						buildId: cached?.manifest.buildId ?? null,
						releaseId: cached?.manifest.releaseId ?? null,
						reason: error instanceof Error ? error.message : "ROUTE_MANIFEST_UNAVAILABLE",
					});
				}
			}),
		);
		for (const service of new Set(
			routes.flatMap((route) => routeDestinations(route).map((destination) => destination.service)),
		)) {
			if (!sources.some((source) => source.service === service))
				sources.push({
					service,
					workerName: service,
					status: "unavailable",
					observedAt: null,
					buildId: null,
					releaseId: null,
					reason: "ROUTE_DESTINATION_UNVERIFIED",
				});
		}
		const projected = new Map<string, InventoryRoute>();
		const issues: string[] = [];
		for (const proxy of routes) {
			if (!routeDestinations(proxy).length) continue;
			for (const target of routes) {
				const descriptor = projectDestinationRoute(proxy, target);
				if (!descriptor) continue;
				const next: InventoryRoute = {
					...proxy,
					...descriptor,
					destinationBuildId: target.buildId,
					availability:
						proxy.availability === "current" && target.availability === "current"
							? "current"
							: "stale",
					observedAt: proxy.observedAt < target.observedAt ? proxy.observedAt : target.observedAt,
				};
				if (proxy.destinations) {
					next.destinationBuildId = undefined;
					const unavailable = proxy.destinations.some((destination) =>
						sources.some(
							(source) =>
								source.service === destination.service &&
								source.status !== "current" &&
								source.status !== "disabled",
						),
					);
					if (unavailable) next.availability = "stale";
					const previous = projected.get(next.id);
					if (previous) {
						if (previous.pluginId !== next.pluginId) {
							previous.availability = "stale";
							issues.push(`ROUTE_DESTINATION_OWNER_MISMATCH:${proxy.routeId}`);
							continue;
						}
						next.destinations = [
							...(previous.destinations ?? []),
							...(next.destinations ?? []),
						].sort(
							(left, right) =>
								left.service.localeCompare(right.service) || left.path.localeCompare(right.path),
						);
						next.observedAt =
							previous.observedAt < next.observedAt ? previous.observedAt : next.observedAt;
						if (previous.availability === "stale") next.availability = "stale";
					}
				}
				projected.set(next.id, next);
			}
		}
		routes.push(...projected.values());
		sources.sort((a, b) => a.service.localeCompare(b.service));
		routes.sort((a, b) => a.service.localeCompare(b.service) || a.id.localeCompare(b.id));
		const active = sources.filter((source) => source.status !== "disabled");
		const releases = new Set(
			active.flatMap((source) =>
				source.releaseId && source.releaseId !== "local" ? [source.releaseId] : [],
			),
		);
		const versions =
			releases.size > 1
				? "mixed"
				: active.some(
							(source) =>
								!source.releaseId ||
								source.releaseId === "local" ||
								!source.buildId ||
								source.buildId === "unavailable",
					  )
					? "unknown"
					: "consistent";
		const status =
			!issues.length && active.every((source) => source.status === "current")
				? "complete"
				: "partial";
		const stable = {
			instanceId: input.instanceId,
			environment: input.environment,
			status,
			issues: [...new Set(issues)].sort(),
			versions,
			sources: sources.map(({ observedAt: _observedAt, ...source }) => source),
			routes: routes.map(({ observedAt: _observedAt, ...route }) => route),
		};
		const hash = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(JSON.stringify(stable)),
		);
		const revision = `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		return {
			schemaVersion: 1,
			instanceId: input.instanceId,
			environment: input.environment,
			status,
			issues: [...new Set(issues)].sort(),
			versions,
			revision,
			checkedAt: new Date().toISOString(),
			sources,
			routes,
		};
	};
}
