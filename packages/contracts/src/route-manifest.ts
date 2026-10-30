import { verifyPluginTaskRequest } from "./internal-request-signature.js";
import {
	manifestFromRoutes,
	registeredRoutes,
	type RouteDescriptor,
	type RouteDestination,
	type RouteManifest,
} from "./route-registry.js";
import { routeService } from "./route-services.js";

export const ROUTE_MANIFEST_PATH = "/internal/route-manifest/v1";
type RouteSource = Parameters<typeof registeredRoutes>[0];
export type RouteSources =
	| readonly RouteSource[]
	| ((env: object) => Promise<readonly RouteSource[]>);
export interface RouteManifestOptions {
	service: string;
	pluginId: string;
	secretNames?: readonly string[];
	authorizeViaApi?: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096)
		throw new Error("ROUTE_MANIFEST_INVALID");
	return value;
}
const surfaces = new Set(["sdk", "board", "shortlinks", "custom-api", "internal"]);
const policies = new Set([
	"public",
	"sdk-key",
	"application",
	"operator",
	"internal",
	"provider-signature",
	"framework",
]);
function destination(value: unknown): value is RouteDestination | undefined {
	return (
		value === undefined ||
		(record(value) &&
			typeof value.service === "string" &&
			value.service.trim().length > 0 &&
			value.service.length <= 4096 &&
			typeof value.path === "string" &&
			value.path.startsWith("/") &&
			!value.path.startsWith("//") &&
			value.path.length <= 4096 &&
			!value.path.includes("\n") &&
			!value.path.includes("\r") &&
			!value.path.includes("#") &&
			(value.sourcePath === undefined ||
				(typeof value.sourcePath === "string" &&
					value.sourcePath.startsWith("/") &&
					!value.sourcePath.startsWith("//") &&
					value.sourcePath.length <= 4096 &&
					!/[\r\n#]/.test(value.sourcePath))) &&
			(value.condition === undefined ||
				value.condition === "legacy-project" ||
				value.condition === "flows-project") &&
			(value.routeId === undefined ||
				(typeof value.routeId === "string" &&
					value.routeId.length > 0 &&
					value.routeId.length <= 4096)))
	);
}
export function parseRouteDestinations(value: unknown): RouteDestination[] {
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.length > 16 ||
		!value.every((item): item is RouteDestination => item !== undefined && destination(item))
	)
		throw new Error("ROUTE_DESTINATION_INVALID");
	return value;
}
function descriptor(value: unknown): value is RouteDescriptor {
	return (
		record(value) &&
		(value.executionScope === undefined ||
			(typeof value.executionScope === "string" &&
				value.executionScope.length > 0 &&
				value.executionScope.length <= 256)) &&
		destination(value.destination) &&
		(value.destinations === undefined ||
			(value.destination === undefined &&
				Array.isArray(value.destinations) &&
				value.destinations.length > 0 &&
				value.destinations.length <= 16 &&
				value.destinations.every((item) => item !== undefined && destination(item)))) &&
		["id", "routeId", "module", "pluginId", "service", "method", "path", "executionPath"].every(
			(key) => typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 4096,
		) &&
		typeof value.surface === "string" &&
		surfaces.has(value.surface) &&
		typeof value.access === "string" &&
		policies.has(value.access) &&
		["http", "websocket", "fallback"].includes(String(value.transport)) &&
		(value.kind === "canonical" || (value.kind === "alias" && typeof value.aliasOf === "string")) &&
		(value.origin === undefined || value.origin === "cms" || value.origin === "superboard")
	);
}

export function parseRouteDescriptors(value: unknown): RouteDescriptor[] {
	if (!Array.isArray(value) || value.length > 20000 || !value.every(descriptor))
		throw new Error("ROUTE_MANIFEST_INVALID");
	const byId = new Map(value.map((route) => [route.id, route]));
	if (byId.size !== value.length) throw new Error("ROUTE_MANIFEST_INVALID");
	for (const route of value) {
		if (route.kind !== "alias") continue;
		const canonical = route.aliasOf ? byId.get(route.aliasOf) : undefined;
		if (
			!canonical ||
			canonical.kind !== "canonical" ||
			canonical.routeId !== route.routeId ||
			canonical.service !== route.service ||
			canonical.pluginId !== route.pluginId ||
			canonical.method !== route.method
		)
			throw new Error("ROUTE_MANIFEST_INVALID");
	}
	return value;
}

export function parseRouteManifest(value: unknown): RouteManifest {
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.routes) ||
		value.routes.length > 20000 ||
		!value.routes.every(descriptor)
	)
		throw new Error("ROUTE_MANIFEST_INVALID");
	const routes = parseRouteDescriptors(value.routes);
	if (routes.some((route) => route.service !== value.service))
		throw new Error("ROUTE_MANIFEST_INVALID");
	const revision = text(value.revision);
	const observedAt = text(value.observedAt);
	if (!/^sha256:[a-f0-9]{64}$/u.test(revision) || !Number.isFinite(Date.parse(observedAt)))
		throw new Error("ROUTE_MANIFEST_INVALID");
	return {
		schemaVersion: 1,
		instanceId: text(value.instanceId),
		environment: text(value.environment),
		service: text(value.service),
		buildId: text(value.buildId),
		revision,
		observedAt,
		...(value.releaseId === undefined ? {} : { releaseId: text(value.releaseId) }),
		routes,
	};
}

export async function serializeRouteManifest(
	routes: RouteDescriptor[],
	runtime: Pick<RouteManifest, "instanceId" | "environment" | "service" | "buildId" | "releaseId">,
): Promise<RouteManifest> {
	return manifestFromRoutes(routes, runtime);
}

export function withRouteManifest<T extends object>(
	worker: T,
	sources: RouteSources,
	options: RouteManifestOptions,
): T {
	return new Proxy(worker, {
		get(target, key) {
			const original: unknown = Reflect.get(target, key, target);
			if (key !== "fetch" || typeof original !== "function") return original;
			return async (...args: unknown[]) => {
				const [request, env] = args;
				if (request instanceof Request && new URL(request.url).pathname === ROUTE_MANIFEST_PATH) {
					if (!new URL(request.url).hostname.endsWith(".internal"))
						return new Response(null, { status: 404 });
					if (request.method !== "GET")
						return new Response(null, { status: 405, headers: { Allow: "GET" } });
					if (!record(env)) return new Response(null, { status: 503 });
					const service = routeService(options.service);
					const secrets = (options.secretNames ?? service?.workerSecrets ?? []).flatMap((name) =>
						typeof env[name] === "string" && env[name] ? [env[name]] : [],
					);
					const verified = await Promise.all(
						secrets.map((secret) => verifyPluginTaskRequest(request, secret)),
					);
					let authorized = verified.some(Boolean);
					if (
						!authorized &&
						(options.authorizeViaApi ||
							options.service.startsWith("managed-") ||
							(service && "authorizeViaApi" in service && service.authorizeViaApi)) &&
						record(env.API_SERVICE) &&
						typeof env.API_SERVICE.fetch === "function"
					) {
						const validationHeaders = new Headers(request.headers);
						validationHeaders.set("x-superboard-route-auth-only", "1");
						const validationRequest = new Request(`https://api.internal${ROUTE_MANIFEST_PATH}`, {
							headers: validationHeaders,
							signal: AbortSignal.timeout(5000),
						});
						const validation: unknown = await Reflect.apply(
							env.API_SERVICE.fetch,
							env.API_SERVICE,
							[validationRequest],
						);
						authorized = validation instanceof Response && validation.status === 204;
						if (validation instanceof Response) await validation.body?.cancel();
					}
					if (!authorized) return new Response(null, { status: 403 });
					if (request.headers.get("x-superboard-route-auth-only") === "1")
						return new Response(null, { status: 204 });
					try {
						const manifest = await buildRouteManifest(sources, env, options);
						const headers = {
							ETag: `W/"${manifest.revision}"`,
							"Cache-Control": "private, no-cache",
							"X-SuperBoard-Observed-At": manifest.observedAt,
						};
						return request.headers.get("if-none-match") === headers.ETag
							? new Response(null, { status: 304, headers })
							: Response.json(manifest, { headers });
					} catch (error) {
						return Response.json(
							{
								error: {
									code: "ROUTE_COVERAGE_UNAVAILABLE",
									message: error instanceof Error ? error.message : "Invalid route registry",
								},
							},
							{ status: 503 },
						);
					}
				}
				const response: unknown = await Reflect.apply(original, target, args);
				return response;
			};
		},
	});
}

export async function buildRouteManifest(
	sources: RouteSources,
	env: object,
	options: Pick<RouteManifestOptions, "service" | "pluginId">,
): Promise<RouteManifest> {
	if (!record(env)) throw new Error("ROUTE_ENV_INVALID");
	const resolvedSources = typeof sources === "function" ? await sources(env) : sources;
	const version = env.SUPERBOARD_WORKER_VERSION;
	const buildId =
		record(version) && typeof version.id === "string" && version.id.trim()
			? version.id
			: "unavailable";
	const own: RouteDescriptor = {
		module: "route-manifest",
		id: `${options.service}:manifest`,
		routeId: `${options.service}:manifest`,
		pluginId: options.pluginId,
		service: options.service,
		method: "GET",
		path: ROUTE_MANIFEST_PATH,
		executionPath: ROUTE_MANIFEST_PATH,
		surface: "internal",
		access: "internal",
		transport: "http",
		kind: "canonical",
	};
	return serializeRouteManifest(
		[
			...resolvedSources
				.flatMap((source) => registeredRoutes(source))
				.map((route) => {
					const owner = route.ownerBinding ? env[route.ownerBinding] : undefined;
					return typeof owner === "string" && owner.trim() ? { ...route, pluginId: owner } : route;
				}),
			own,
		],
		{
			instanceId: text(env.SUPERBOARD_INSTANCE_ID),
			environment: text(env.SUPERBOARD_ENVIRONMENT ?? env.ENVIRONMENT),
			service: options.service,
			buildId,
			...(typeof env.SUPERBOARD_RELEASE === "string" && env.SUPERBOARD_RELEASE
				? { releaseId: env.SUPERBOARD_RELEASE }
				: {}),
		},
	);
}
