export type RouteSurface = "sdk" | "board" | "shortlinks" | "custom-api" | "internal";
export type RouteAccess =
	| "public"
	| "sdk-key"
	| "application"
	| "operator"
	| "internal"
	| "provider-signature"
	| "framework";
export interface RouteExposure {
	surface: RouteSurface;
	path: string;
	aliases?: readonly string[];
	executionPath?: string;
}
export interface RouteGroup {
	executionScope?: string;
	service: string;
	module: string;
	pluginId: string;
	surface: RouteSurface;
	access: RouteAccess;
	ownerBinding?: "CUSTOM_WORKER_PLUGIN_ID";
	public?: { surface: RouteSurface; prefix: string; aliases?: readonly string[] };
}
export interface RouteDestination {
	service: string;
	path: string;
	routeId?: string;
	sourcePath?: string;
	condition?: "legacy-project" | "flows-project";
}
export interface RouteOptions {
	destination?: RouteDestination;
	destinations?: readonly RouteDestination[];
	delegatedOwner?: "app";
	id?: string;
	pluginId?: string;
	surface?: RouteSurface;
	access?: RouteAccess;
	exposures?: readonly RouteExposure[];
	continuation?: boolean;
	mount?: "extend";
	transport?: "http" | "websocket" | "fallback";
}
export interface RouteDefinition
	extends RouteGroup, Omit<RouteOptions, "pluginId" | "surface" | "access"> {
	id: string;
	method: string;
	path: string;
}
export interface RouteDescriptor {
	executionScope?: string;
	destination?: RouteDestination;
	destinations?: readonly RouteDestination[];
	matchPattern?: string;
	module: string;
	ownerBinding?: "CUSTOM_WORKER_PLUGIN_ID";
	id: string;
	routeId: string;
	pluginId: string;
	service: string;
	method: string;
	path: string;
	executionPath: string;
	surface: RouteSurface;
	access: RouteAccess;
	transport: "http" | "websocket" | "fallback";
	kind: "canonical" | "alias";
	aliasOf?: string;
	origin?: "cms" | "superboard";
}
export interface RouteRuntime {
	instanceId: string;
	environment: string;
	service: string;
	buildId: string;
	releaseId?: string;
}
export interface RouteManifest extends RouteRuntime {
	schemaVersion: 1;
	revision: string;
	observedAt: string;
	routes: RouteDescriptor[];
}
interface ObservedRoute {
	method: string;
	path: string;
	handler: unknown;
	basePath?: string;
}
interface RouterShape {
	routes: ObservedRoute[];
}
interface Registration {
	definition: RouteDefinition;
	role: "endpoint" | "middleware";
	mounted?: Pick<ObservedRoute, "method" | "path" | "handler">;
}
interface RegistryState {
	registrations: Map<ObservedRoute, Registration>;
	children?: { source: RouterShape; snapshot: ObservedRoute[] }[];
	group?: RouteGroup;
	bridges?: { source: RouterShape; entries: Map<ObservedRoute, ObservedRoute> }[];
	revision?: number;
	catalog?: { revision: number; count: number; routes: RouteDescriptor[] };
}
export type RegisteredRouter<T extends RouterShape> = T & {
	defineRoute(options: RouteOptions): T;
};

const registryKey = Symbol.for("superboard.route-registry.v1");
const registryGlobals = globalThis as typeof globalThis & {
	[registryKey]?: WeakMap<object, RegistryState>;
};
const registries = (registryGlobals[registryKey] ??= new WeakMap<object, RegistryState>());
const entryKey = Symbol.for("superboard.route-registry.entries.v1");
const entryGlobals = globalThis as typeof globalThis & {
	[entryKey]?: WeakMap<object, Registration>;
};
const registeredEntries = (entryGlobals[entryKey] ??= new WeakMap<object, Registration>());
function remember(state: RegistryState, route: ObservedRoute, registration: Registration) {
	const stored = {
		...registration,
		mounted: { method: route.method, path: route.path, handler: route.handler },
	};
	state.registrations.set(route, stored);
	state.revision = (state.revision ?? 0) + 1;
	registeredEntries.set(route, stored);
}
export function registeredRequestDefinition(
	routes: readonly ObservedRoute[],
): RouteDefinition | null {
	for (const route of routes) {
		const registration = registeredEntries.get(route);
		if (registration?.role === "endpoint") return registration.definition;
	}
	return null;
}
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "all", "on"]);
const surfaces = new Set<string>(["sdk", "board", "shortlinks", "custom-api", "internal"]);
const policies = new Set<string>([
	"public",
	"sdk-key",
	"application",
	"operator",
	"internal",
	"provider-signature",
	"framework",
]);

function isRouter(value: unknown): value is RouterShape {
	return (
		typeof value === "object" && value !== null && "routes" in value && Array.isArray(value.routes)
	);
}
function validateGroup(group: RouteGroup) {
	if (
		![group.service, group.module, group.pluginId].every(
			(value) => typeof value === "string" && value.trim().length > 0,
		) ||
		!surfaces.has(group.surface) ||
		!policies.has(group.access)
	)
		throw new Error("ROUTE_DECLARATION_INVALID");
}
function validatePath(path: string) {
	if (
		typeof path !== "string" ||
		(!path.startsWith("/") && path !== "*") ||
		path.startsWith("//") ||
		/[\r\n#]/u.test(path)
	)
		throw new Error("ROUTE_PATH_INVALID");
}

export function registerRouter<T extends RouterShape>(
	router: T,
	group: RouteGroup,
): RegisteredRouter<T> {
	validateGroup(group);
	let state = registries.get(router.routes);
	if (!state) {
		state = { registrations: new Map(), group };
		registries.set(router.routes, state);
	}
	state.group ??= group;
	const registry = state;
	const scoped = (options: RouteOptions = {}): T =>
		new Proxy(router, {
			get(target, key) {
				if (key === "defineRoute") return (declaration: RouteOptions) => scoped(declaration);
				const value: unknown = Reflect.get(target, key, target);
				if (typeof value !== "function" || key === "errorHandler") return value;
				if (key === "basePath")
					return (...args: unknown[]) => {
						const result: unknown = Reflect.apply(value, target, args);
						if (!isRouter(result)) throw new Error("ROUTE_ROUTER_INVALID");
						return registerRouter(result, group);
					};
				if (typeof key !== "string" || (!methods.has(key) && key !== "use" && key !== "route"))
					return (...args: unknown[]) => {
						const result: unknown = Reflect.apply(value, target, args);
						return result === target ? proxy : result;
					};
				return (...args: unknown[]) => {
					if (
						options.mount === "extend" &&
						typeof args[0] === "string" &&
						methods.has(key) &&
						key !== "on"
					) {
						const pattern = args[0].replace(/:[A-Za-z][A-Za-z0-9_]*/gu, ":parameter");
						if (
							target.routes.some(
								(existing) =>
									existing.method === key.toUpperCase() &&
									existing.path.replace(/:[A-Za-z][A-Za-z0-9_]*/gu, ":parameter") === pattern,
							)
						)
							return proxy;
					}
					const start = target.routes.length;
					const child = key === "route" && isRouter(args[1]) ? args[1] : null;
					let childRoutes = child ? [...child.routes] : [];
					if (child && options.mount === "extend") {
						const base = String(Reflect.get(target, "_basePath") ?? "/");
						const mount = String(args[0]);
						const combine = (left: string, right: string) =>
							`${left.startsWith("/") ? "" : "/"}${left}${right === "/" ? "" : `${left.endsWith("/") ? "" : "/"}${right.startsWith("/") ? right.slice(1) : right}`}`;
						const prefix = combine(base, mount);
						childRoutes = childRoutes.filter(
							(entry) =>
								!target.routes.some(
									(existing) =>
										existing.method === entry.method &&
										existing.path.replace(/:[A-Za-z][A-Za-z0-9_]*/gu, ":parameter") ===
											combine(prefix, entry.path).replace(/:[A-Za-z][A-Za-z0-9_]*/gu, ":parameter"),
								),
						);
						args[1] = new Proxy(child, {
							get(childTarget, childKey) {
								const value: unknown =
									childKey === "routes"
										? childRoutes
										: Reflect.get(childTarget, childKey, childTarget);
								return value;
							},
						});
					}
					const childState = child ? registries.get(child.routes) : undefined;
					if (child)
						(registry.children ??= []).push({ source: child, snapshot: [...child.routes] });
					const result: unknown = Reflect.apply(value, target, args);
					const added = target.routes.slice(start);
					if (key === "route") {
						for (const [index, entry] of added.entries()) {
							const source = childRoutes[index];
							const registration = source ? childState?.registrations.get(source) : undefined;
							if (registration)
								remember(registry, entry, {
									...registration,
									definition: {
										...registration.definition,
										service: group.service,
										...(registration.definition.service !== group.service
											? { surface: group.surface, access: group.access }
											: {}),
									},
								});
						}
					} else {
						const definitions = new Map<string, RouteDefinition>();
						for (const [index, entry] of added.entries()) {
							validatePath(entry.path);
							const pair = `${entry.method}:${entry.path}`;
							let definition = definitions.get(pair);
							if (!definition) {
								definition = {
									...group,
									...options,
									id: options.id ?? `${group.service}:${group.module}:${pair}`,
									method: entry.method,
									path: entry.path,
								};
								if (!definition.exposures && group.public) {
									const combine = (prefix: string) =>
										`${prefix.replace(/\/$/u, "")}${entry.path === "/" ? "" : entry.path}`;
									definition.exposures = [
										{
											surface: group.public.surface,
											path: combine(group.public.prefix),
											aliases: group.public.aliases?.map(combine),
										},
									];
								}
								validateGroup(definition);
								if (definition.destination && definition.destinations)
									throw new Error("ROUTE_DESTINATION_AMBIGUOUS");
								if (
									definition.destinations &&
									(!definition.destinations.length ||
										definition.destinations.length > 16 ||
										new Set(definition.destinations.map((destination) => destination.condition))
											.size !== definition.destinations.length)
								)
									throw new Error("ROUTE_DESTINATION_AMBIGUOUS");
								for (const destination of routeDestinations(definition)) {
									if (!destination.service.trim() || !destination.path.startsWith("/"))
										throw new Error("ROUTE_DESTINATION_INVALID");
									validatePath(destination.path);
									if (destination.sourcePath) validatePath(destination.sourcePath);
								}

								for (const exposure of definition.exposures ?? []) {
									if (!surfaces.has(exposure.surface)) throw new Error("ROUTE_SURFACE_INVALID");
									validatePath(exposure.path);
									for (const alias of exposure.aliases ?? []) validatePath(alias);
								}
								definitions.set(pair, definition);
							}
							const laterHandler = added
								.slice(index + 1)
								.some((later) => later.method === entry.method && later.path === entry.path);
							remember(registry, entry, {
								definition,
								role:
									key === "use" || laterHandler || options.continuation ? "middleware" : "endpoint",
							});
						}
					}
					return result === target ? proxy : result;
				};
			},
		});
	const proxy = scoped();
	return Object.assign(proxy, { defineRoute: (options: RouteOptions) => scoped(options) });
}

export function registerImportedRouter<T extends RouterShape>(
	router: T,
	group: RouteGroup,
): RegisteredRouter<T> {
	const registered = registerRouter(router, group);
	const state = registries.get(router.routes);
	if (!state) throw new Error("ROUTE_REGISTRY_MISSING");
	for (const [index, entry] of router.routes.entries()) {
		if (state.registrations.has(entry)) continue;
		const later = router.routes
			.slice(index + 1)
			.some((other) => entry.path === other.path && entry.method === other.method);
		remember(state, entry, {
			definition: {
				...group,
				id: `${group.service}:${group.module}:${entry.method}:${entry.path}`,
				method: entry.method,
				path: entry.path,
			},
			role: later ? "middleware" : "endpoint",
		});
	}
	return registered;
}

export function assertRouteCoverage(router: RouterShape): void {
	inspectRouteCoverage(router, new Set());
}

function inspectRouteCoverage(router: RouterShape, ancestors: Set<object>): void {
	if (ancestors.has(router.routes)) throw new Error("ROUTE_BRIDGE_CYCLE");
	const lineage = new Set(ancestors).add(router.routes);
	const state = registries.get(router.routes);
	if (!state) throw new Error("ROUTE_REGISTRY_MISSING");
	const observed = new Set(router.routes);
	const errors: string[] = [];
	for (const child of state.children ?? []) {
		if (!registries.has(child.source.routes)) {
			errors.push("ROUTE_UNREGISTERED:CHILD");
			continue;
		}
		inspectRouteCoverage(child.source, lineage);
		if (
			child.snapshot.length !== child.source.routes.length ||
			child.snapshot.some((entry, index) => child.source.routes[index] !== entry)
		)
			errors.push("ROUTE_CHILD_MOUNT_STALE");
	}
	for (const entry of state.registrations.keys())
		if (!observed.has(entry)) errors.push(`ROUTE_NOT_MOUNTED:${entry.method}:${entry.path}`);
	const seen = new Map<string, Registration>();
	for (const entry of router.routes) {
		const registration = state.registrations.get(entry);
		if (!registration) {
			errors.push(`ROUTE_UNREGISTERED:${entry.method}:${entry.path}`);
			continue;
		}
		const snapshot = registration.mounted;
		if (
			!snapshot ||
			snapshot.method !== entry.method ||
			snapshot.path !== entry.path ||
			snapshot.handler !== entry.handler
		)
			errors.push(`ROUTE_ENTRY_MUTATED:${entry.method}:${entry.path}`);
		if (registration.role === "middleware") continue;
		const key = `${entry.method}:${entry.path.replace(/:[A-Za-z][A-Za-z0-9_]*/gu, ":parameter")}`;
		const previous = seen.get(key);
		if (previous && !previous.definition.continuation && !registration.definition.continuation)
			errors.push(`ROUTE_DUPLICATE:${key}`);
		seen.set(key, registration);
	}
	for (const bridge of state.bridges ?? []) {
		inspectRouteCoverage(bridge.source, lineage);
		const sourceState = registries.get(bridge.source.routes);
		const endpoints = bridge.source.routes.filter(
			(entry) => sourceState?.registrations.get(entry)?.role === "endpoint",
		);
		for (const entry of endpoints)
			if (!bridge.entries.has(entry))
				errors.push(`ROUTE_BRIDGE_NOT_MOUNTED:${entry.method}:${entry.path}`);
		for (const [entry, mounted] of bridge.entries) {
			if (
				!endpoints.includes(entry) ||
				!observed.has(mounted) ||
				entry.path !== mounted.path ||
				entry.method !== mounted.method
			)
				errors.push(`ROUTE_BRIDGE_STALE:${entry.method}:${entry.path}`);
		}
	}
	if (errors.length) throw new Error(errors.join("\n"));
}

export function mountRegisteredRouter<T extends RouterShape>(
	target: T,
	source: RouterShape,
	handler: unknown,
): T {
	if (target.routes === source.routes) throw new Error("ROUTE_BRIDGE_CYCLE");
	assertRouteCoverage(source);
	const sourceState = registries.get(source.routes);
	const targetState = registries.get(target.routes);
	const on: unknown = Reflect.get(target, "on");
	const group = targetState?.group;
	if (
		!sourceState ||
		!targetState ||
		!group ||
		typeof on !== "function" ||
		typeof handler !== "function"
	)
		throw new Error("ROUTE_BRIDGE_INVALID");
	const entries = new Map<ObservedRoute, ObservedRoute>();
	for (const entry of source.routes) {
		const registration = sourceState.registrations.get(entry);
		if (!registration || registration.role !== "endpoint") continue;
		const index = target.routes.length;
		Reflect.apply(on, target, [entry.method, entry.path, handler]);
		const mounted = target.routes[index];
		if (!mounted || target.routes.length !== index + 1) throw new Error("ROUTE_BRIDGE_INVALID");
		const definition = registration.definition;
		remember(targetState, mounted, {
			...registration,
			definition: {
				...definition,
				service: group.service,
				...(definition.service !== group.service
					? { surface: group.surface, access: group.access }
					: {}),
			},
		});
		entries.set(entry, mounted);
	}
	(targetState.bridges ??= []).push({ source, entries });
	return target;
}

export function registeredRoutes(router: RouterShape): RouteDescriptor[] {
	assertRouteCoverage(router);
	const state = registries.get(router.routes);
	if (!state) throw new Error("ROUTE_REGISTRY_MISSING");
	const result: RouteDescriptor[] = [];
	const seen = new Map<string, RouteDescriptor>();
	const add = (descriptor: RouteDescriptor, continuation = false) => {
		const key = `${descriptor.surface}:${descriptor.method}:${descriptor.path}`;
		const previous = seen.get(key);
		if (previous) {
			if (previous.routeId !== descriptor.routeId && !continuation)
				throw new Error(`ROUTE_EXPOSURE_DUPLICATE:${key}`);
			return;
		}
		seen.set(key, descriptor);
		result.push(descriptor);
	};
	for (const entry of router.routes) {
		const registration = state.registrations.get(entry);
		if (!registration || registration.role !== "endpoint") continue;
		const d = registration.definition;
		const base: RouteDescriptor = {
			module: d.module,
			...(d.executionScope ? { executionScope: d.executionScope } : {}),
			...(d.destination ? { destination: d.destination } : {}),
			...(d.destinations ? { destinations: d.destinations } : {}),
			...(d.ownerBinding ? { ownerBinding: d.ownerBinding } : {}),
			id: `${d.id}@${d.surface}:${entry.path}`,
			routeId: d.id,
			pluginId: d.pluginId,
			service: d.service,
			method: entry.method,
			path: entry.path,
			executionPath: entry.path,
			surface: d.surface,
			access: d.access,
			transport: d.transport ?? "http",
			kind: "canonical",
		};
		const primary = d.exposures?.find(
			(exposure) => exposure.surface === d.surface && exposure.path !== entry.path,
		);
		if (primary) {
			base.kind = "alias";
			base.aliasOf = `${d.id}@${primary.surface}:${primary.path}`;
		}
		add(base, d.continuation);
		for (const exposure of d.exposures ?? []) {
			const canonical: RouteDescriptor = {
				...base,
				kind: "canonical",
				aliasOf: undefined,
				id: `${d.id}@${exposure.surface}:${exposure.path}`,
				path: exposure.path,
				surface: exposure.surface,
				executionPath: exposure.executionPath ?? entry.path,
			};
			add(canonical, d.continuation);
			for (const alias of exposure.aliases ?? [])
				add(
					{
						...canonical,
						id: `${d.id}@${exposure.surface}:${alias}`,
						path: alias,
						kind: "alias",
						aliasOf: canonical.id,
					},
					d.continuation,
				);
		}
	}
	const routes = result.sort((a, b) => a.id.localeCompare(b.id));
	const declaredHeads = new Set(
		routes
			.filter((route) => route.method === "HEAD")
			.map((route) => `${route.executionScope ?? ""}:${route.surface}:${route.path}`),
	);
	const implicitHeads = routes
		.filter(
			(route) =>
				route.method === "GET" &&
				!declaredHeads.has(`${route.executionScope ?? ""}:${route.surface}:${route.path}`),
		)
		.map((route) => ({
			...route,
			id: `implicit:HEAD:${route.id}`,
			routeId: `implicit:HEAD:${route.routeId}`,
			method: "HEAD",
			...(route.aliasOf ? { aliasOf: `implicit:HEAD:${route.aliasOf}` } : {}),
		}));
	routes.push(...implicitHeads);
	state.catalog = { revision: state.revision ?? 0, count: router.routes.length, routes };
	return routes;
}

export async function routeManifest(
	router: RouterShape,
	runtime: RouteRuntime,
): Promise<RouteManifest> {
	return manifestFromRoutes(registeredRoutes(router), runtime);
}

export async function manifestFromRoutes(
	routes: RouteDescriptor[],
	runtime: RouteRuntime,
): Promise<RouteManifest> {
	if (!Object.values(runtime).every((value) => typeof value === "string" && value.trim()))
		throw new Error("ROUTE_RUNTIME_INVALID");
	const sortedRoutes = [...routes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const payload = {
		schemaVersion: 1 as const,
		instanceId: runtime.instanceId,
		environment: runtime.environment,
		service: runtime.service,
		buildId: runtime.buildId,
		...(runtime.releaseId ? { releaseId: runtime.releaseId } : {}),
		routes: sortedRoutes,
	};
	const canonical = JSON.stringify(payload, (_key, value: unknown) => {
		if (value !== null && typeof value === "object" && !Array.isArray(value))
			return Object.fromEntries(
				Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
			);
		return value;
	});
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
	const revision = `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")}`;
	return { ...payload, revision, observedAt: new Date().toISOString() };
}

type PathToken = { text: string } | { name: string; expression: string; optional: boolean };
interface CompiledPath {
	tokens: PathToken[];
	matcher: RegExp;
	parameters: { name: string; group: string }[];
}
const pathCacheKey = Symbol.for("superboard.route-patterns.v1");
const pathGlobals = globalThis as typeof globalThis & {
	[pathCacheKey]?: Map<string, CompiledPath>;
};
const pathCache = (pathGlobals[pathCacheKey] ??= new Map<string, CompiledPath>());
const parameterNamePattern = /^[A-Za-z][A-Za-z0-9_]*/u;
const regexLiteralPattern = /[.*+?^${}()|[\]\\]/gu;

function compilePath(pattern: string): CompiledPath {
	const cached = pathCache.get(pattern);
	if (cached) return cached;
	const tokens: PathToken[] = [];
	let literal = "";
	for (let index = 0; index < pattern.length;) {
		const character = pattern[index];
		const name =
			character === ":"
				? parameterNamePattern.exec(pattern.slice(index + 1))?.[0]
				: character === "*"
					? "*"
					: undefined;
		if (!name) {
			literal += character;
			index++;
			continue;
		}
		let expression = name === "*" ? ".*" : "[^/]+";
		index += name === "*" ? 1 : name.length + 1;
		if (pattern[index] === "{" && name !== "*") {
			const start = ++index;
			let depth = 1;
			let characterClass = false;
			while (index < pattern.length && depth > 0) {
				const value = pattern[index];
				if (value === "\\") {
					index += 2;
					continue;
				}
				if (value === "[") characterClass = true;
				else if (value === "]") characterClass = false;
				else if (!characterClass && value === "{") depth++;
				else if (!characterClass && value === "}") depth--;
				if (depth > 0) index++;
			}
			if (depth !== 0) throw new Error("ROUTE_PATTERN_INVALID");
			expression = pattern.slice(start, index++);
		}
		const optional = pattern[index] === "?";
		if (optional) index++;
		if (literal) tokens.push({ text: literal });
		literal = "";
		tokens.push({ name, expression, optional });
	}
	if (literal) tokens.push({ text: literal });
	let expression = "";
	const parameters: CompiledPath["parameters"] = [];
	for (const token of tokens) {
		if ("text" in token) {
			expression += token.text.replace(regexLiteralPattern, "\\$&");
			continue;
		}
		const group = `superboard_route_parameter_${parameters.length}`;
		parameters.push({ name: token.name, group });
		const parameter = `(?<${group}>${token.expression})`;
		if (token.optional && expression.endsWith("/"))
			expression = `${expression.slice(0, -1)}(?:/${parameter})?`;
		else expression += token.optional ? `${parameter}?` : parameter;
	}
	const compiled = { tokens, parameters, matcher: new RegExp(`^${expression}/?$`, "u") };
	if (pathCache.size >= 4096) pathCache.clear();
	pathCache.set(pattern, compiled);
	return compiled;
}

export function routeParameterNames(pattern: string): string[] {
	return compilePath(pattern).parameters.map((parameter) => parameter.name);
}

export function matchRouteParameters(pattern: string, path: string): Record<string, string> | null {
	return matchPath(pattern, path);
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
	const compiled = compilePath(pattern);
	const match = compiled.matcher.exec(path);
	if (!match) return null;
	return Object.fromEntries(
		compiled.parameters.flatMap(({ name, group }) => {
			const value = match.groups?.[group];
			return value === undefined ? [] : [[name, value]];
		}),
	);
}

function executionPath(pattern: string, parameters: Record<string, string>): string | null {
	let path = "";
	for (const token of compilePath(pattern).tokens) {
		if ("text" in token) {
			path += token.text;
			continue;
		}
		const value = parameters[token.name];
		if (value === undefined) {
			if (!token.optional) return null;
			if (path.endsWith("/")) path = path.slice(0, -1);
		} else path += value;
	}
	return path || "/";
}

export function resolveRouteDestination(
	definition: { path: string; destination: RouteDestination },
	pathname: string,
	contextParameters: Readonly<Record<string, string>> = {},
): RouteDestination | null {
	const parameters = matchPath(definition.destination.sourcePath ?? definition.path, pathname);
	if (!parameters) return null;
	const destination = executionPath(definition.destination.path, {
		...contextParameters,
		...parameters,
	});
	return destination === null ? null : { ...definition.destination, path: destination };
}

export function routeDestinations(route: {
	destination?: RouteDestination;
	destinations?: readonly RouteDestination[];
}): readonly RouteDestination[] {
	return route.destinations ?? (route.destination ? [route.destination] : []);
}

export function projectDestinationRoute(
	proxy: RouteDescriptor,
	target: RouteDescriptor,
): RouteDescriptor | null {
	const destination = routeDestinations(proxy).find(
		(candidate) => candidate.service === target.service && matchPath(candidate.path, target.path),
	);
	if (
		!destination ||
		routeDestinations(target).length ||
		target.kind !== "canonical" ||
		target.surface !== "internal" ||
		target.transport === "fallback" ||
		target.method === "ALL" ||
		(proxy.method !== "ALL" && proxy.method !== target.method)
	)
		return null;
	const parameters = matchPath(destination.path, target.path);
	if (!parameters) return null;
	const destinationParameters = new Set(routeParameterNames(destination.path));
	let path = "";
	for (const token of compilePath(destination.sourcePath ?? proxy.path).tokens) {
		if ("text" in token) path += token.text;
		else if (parameters[token.name] !== undefined) path += parameters[token.name];
		else if (destinationParameters.has(token.name) && token.optional) {
			if (path.endsWith("/")) path = path.slice(0, -1);
		} else
			path +=
				token.name === "*"
					? "*"
					: `:${token.name}${token.expression === "[^/]+" ? "" : `{${token.expression}}`}${token.optional ? "?" : ""}`;
	}
	if (proxy.destinations)
		path = compilePath(path)
			.tokens.map((token) =>
				"text" in token ? token.text : `:${token.name}${token.optional ? "?" : ""}`,
			)
			.join("");
	const routeId = proxy.destinations
		? `${proxy.routeId}->${target.method}:${path}`
		: `${proxy.routeId}->${target.routeId}`;
	const resolved = {
		service: target.service,
		path: target.path,
		routeId: target.routeId,
		...(destination.condition ? { condition: destination.condition } : {}),
	};
	return {
		...proxy,
		id: `${routeId}@${proxy.surface}:${path}`,
		routeId,
		method: target.method,
		path,
		executionPath: path,
		pluginId: target.pluginId,
		transport: target.transport,
		kind: "canonical",
		aliasOf: undefined,
		...(proxy.destinations
			? { destination: undefined, destinations: [resolved] }
			: { destination: resolved }),
	};
}

export function resolveRegisteredRoute(
	router: RouterShape,
	method: string,
	surface: RouteSurface,
	path: string,
): { route: RouteDescriptor; executionPath: string } | null {
	const state = registries.get(router.routes);
	const catalog = state?.catalog;
	const routes =
		catalog && catalog.revision === state?.revision && catalog.count === router.routes.length
			? catalog.routes
			: registeredRoutes(router);
	return resolveManifestRoute(routes, method, surface, path);
}

export function resolveManifestRoute(
	routes: readonly RouteDescriptor[],
	method: string,
	surface: RouteSurface,
	path: string,
): { route: RouteDescriptor; executionPath: string } | null {
	const candidates = routes.filter(
		(route) =>
			route.surface === surface &&
			(route.method === method ||
				route.method === "ALL" ||
				method === "OPTIONS" ||
				(method === "HEAD" && route.method === "GET")),
	);
	candidates.sort(
		(a, b) =>
			Number(a.transport === "fallback") - Number(b.transport === "fallback") ||
			Number(a.path.includes("*")) - Number(b.path.includes("*")) ||
			b.path.length - a.path.length,
	);
	for (const route of candidates) {
		const parameters = matchPath(route.path, path);
		if (!parameters) continue;
		const destination = executionPath(route.executionPath, parameters);
		if (destination !== null) return { route, executionPath: destination };
	}
	return null;
}

export async function dispatchRegisteredRoute(
	router: RouterShape,
	request: Request,
	surface: RouteSurface,
	invoke: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
	const url = new URL(request.url);
	const matched = resolveRegisteredRoute(router, request.method, surface, url.pathname);
	if (!matched) return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	url.pathname = matched.executionPath;
	return invoke(new Request(url, request));
}

export interface RouteRequest<E> {
	request: Request;
	url: URL;
	env: E;
	params: Record<string, string>;
}
export type FetchRouteHandler<E> = (
	context: RouteRequest<E>,
	next: () => Promise<Response>,
) => Response | Promise<Response>;
export interface FetchRouter<E> extends RouterShape {
	on(
		method: string | string[],
		path: string | string[],
		...handlers: FetchRouteHandler<E>[]
	): FetchRouter<E>;
	get(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	post(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	put(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	patch(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	delete(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	options(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	all(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	use(path: string, ...handlers: FetchRouteHandler<E>[]): FetchRouter<E>;
	fetch(request: Request, env: E): Promise<Response>;
}

export function createFetchRouter<E>(group: RouteGroup): RegisteredRouter<FetchRouter<E>> {
	const entries: Array<ObservedRoute & { handler: FetchRouteHandler<E> }> = [];
	const raw: FetchRouter<E> = {
		routes: entries,
		on(method, path, ...handlers) {
			for (const verb of [method].flat())
				for (const pattern of [path].flat())
					for (const handler of handlers)
						entries.push({ method: verb.toUpperCase(), path: pattern, handler });
			return raw;
		},
		get(path, ...handlers) {
			return raw.on("GET", path, ...handlers);
		},
		post(path, ...handlers) {
			return raw.on("POST", path, ...handlers);
		},
		put(path, ...handlers) {
			return raw.on("PUT", path, ...handlers);
		},
		patch(path, ...handlers) {
			return raw.on("PATCH", path, ...handlers);
		},
		delete(path, ...handlers) {
			return raw.on("DELETE", path, ...handlers);
		},
		options(path, ...handlers) {
			return raw.on("OPTIONS", path, ...handlers);
		},
		all(path, ...handlers) {
			return raw.on("ALL", path, ...handlers);
		},
		use(path, ...handlers) {
			return raw.on("ALL", path, ...handlers);
		},
		async fetch(request, env) {
			const url = new URL(request.url);
			const resolved = resolveRegisteredRoute(raw, request.method, group.surface, url.pathname);
			const pathname = resolved?.executionPath ?? url.pathname;
			const chain = entries.flatMap((entry) => {
				if (
					entry.method !== "ALL" &&
					entry.method !== request.method &&
					!(request.method === "HEAD" && entry.method === "GET")
				)
					return [];
				const params = matchPath(entry.path, pathname);
				return params ? [{ entry, params }] : [];
			});
			const run = async (index: number): Promise<Response> => {
				const item = chain[index];
				return item
					? item.entry.handler({ request, url, env, params: item.params }, () => run(index + 1))
					: Response.json({ error: "not_found" }, { status: 404 });
			};
			const response = await run(0);
			return request.method === "HEAD" ? new Response(null, response) : response;
		},
	};
	return registerRouter(raw, group);
}
