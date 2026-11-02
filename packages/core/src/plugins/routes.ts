import { MediaUsageActivationWriteBlockedError } from "../api/media-usage-write-fence.js";
import { PluginContextFactory, type PluginContextFactoryOptions } from "./context.js";
import { extractRequestMeta } from "./request-meta.js";
import type { ResolvedPlugin, RouteContext, PluginRoute, UserInfo } from "./types.js";

const CONSUMED_BODY_METHODS = new Set(["json", "text", "arrayBuffer", "blob", "formData", "bytes"]);

function guardConsumedRequestBody(request: Request): Request {
	return new Proxy(request, {
		get(target, prop) {
			if (typeof prop === "string" && CONSUMED_BODY_METHODS.has(prop)) {
				return () => {
					throw new Error(
						`[emdash] ctx.request.${prop}() is not available inside a plugin route handler: ` +
							`EmDash has already parsed the request body and exposes it as ctx.input. ` +
							`Read ctx.input instead of ctx.request.${prop}().`,
					);
				};
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export interface RouteMeta {
	public: boolean;
	permission?: string;
	cacheControl?: string;
}

export function buildRouteMeta(route: {
	public?: boolean;
	permission?: string;
	cacheControl?: string;
}): RouteMeta {
	const meta: RouteMeta = { public: route.public === true };
	if (route.permission !== undefined) meta.permission = route.permission;
	if (meta.public && typeof route.cacheControl === "string" && route.cacheControl.length > 0) {
		meta.cacheControl = route.cacheControl;
	}
	return meta;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export async function parseRouteInput(request: Request): Promise<unknown> {
	if (BODY_METHODS.has(request.method.toUpperCase())) {
		try {
			return await request.json();
		} catch {
			return undefined;
		}
	}

	const params = new URL(request.url).searchParams;
	const input: Record<string, string | string[]> = {};
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key);
		input[key] = values.length > 1 ? values : values[0];
	}
	return input;
}

export interface RouteResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	status: number;
}

export interface RouteCallerInput {
	id: string;
	email: string;
	name: string | null;
	role: number;
	createdAt: Date | string;
}

export function toRouteCallerInfo(user: RouteCallerInput): UserInfo {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		createdAt: typeof user.createdAt === "string" ? user.createdAt : user.createdAt.toISOString(),
	};
}

export interface InvokeRouteOptions {
	request: Request;
	body?: unknown;
	user?: UserInfo;
}

export class PluginRouteHandler {
	private contextFactory: PluginContextFactory;
	private plugin: ResolvedPlugin;
	private trustedProxyHeaders: string[];

	constructor(plugin: ResolvedPlugin, factoryOptions: PluginContextFactoryOptions) {
		this.plugin = plugin;
		this.contextFactory = new PluginContextFactory(factoryOptions);
		this.trustedProxyHeaders = factoryOptions.trustedProxyHeaders ?? [];
	}

	async invoke(routeName: string, options: InvokeRouteOptions): Promise<RouteResult> {
		const route = this.plugin.routes[routeName];

		if (!route) {
			return {
				success: false,
				error: {
					code: "ROUTE_NOT_FOUND",
					message: `Route "${routeName}" not found in plugin "${this.plugin.id}"`,
				},
				status: 404,
			};
		}

		let validatedInput: unknown;
		if (route.input) {
			const parseResult = route.input.safeParse(options.body);
			if (!parseResult.success) {
				return {
					success: false,
					error: {
						code: "VALIDATION_ERROR",
						message: "Invalid request body",
						details: parseResult.error.format(),
					},
					status: 400,
				};
			}
			validatedInput = parseResult.data;
		} else {
			validatedInput = options.body;
		}

		const baseContext = this.contextFactory.createContext(this.plugin);
		const routeContext: RouteContext = {
			...baseContext,
			input: validatedInput,
			request: guardConsumedRequestBody(options.request),
			requestMeta: extractRequestMeta(options.request, this.trustedProxyHeaders),
			user: options.user,
		};

		try {
			const result = await route.handler(routeContext);
			return {
				success: true,
				data: result,
				status: 200,
			};
		} catch (error) {
			if (error instanceof MediaUsageActivationWriteBlockedError) {
				return {
					success: false,
					error: { code: error.code, message: error.message },
					status: error.status,
				};
			}
			if (error instanceof PluginRouteError) {
				return {
					success: false,
					error: {
						code: error.code,
						message: error.message,
						details: error.details,
					},
					status: error.status,
				};
			}

			console.error(`[plugin:${this.plugin.id}] Route handler failed:`, error);
			return {
				success: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "An internal error occurred",
				},
				status: 500,
			};
		}
	}

	getRouteNames(): string[] {
		return Object.keys(this.plugin.routes);
	}

	hasRoute(name: string): boolean {
		return name in this.plugin.routes;
	}

	getRouteMeta(name: string): RouteMeta | null {
		const route: PluginRoute | undefined = this.plugin.routes[name];
		if (!route) return null;
		return buildRouteMeta(route);
	}
}

export class PluginRouteError extends Error {
	constructor(
		public code: string,
		message: string,
		public status: number = 400,
		public details?: unknown,
	) {
		super(message);
		this.name = "PluginRouteError";
	}

	static badRequest(message: string, details?: unknown): PluginRouteError {
		return new PluginRouteError("BAD_REQUEST", message, 400, details);
	}

	static unauthorized(message: string = "Unauthorized"): PluginRouteError {
		return new PluginRouteError("UNAUTHORIZED", message, 401);
	}

	static forbidden(message: string = "Forbidden"): PluginRouteError {
		return new PluginRouteError("FORBIDDEN", message, 403);
	}

	static notFound(message: string = "Not found"): PluginRouteError {
		return new PluginRouteError("NOT_FOUND", message, 404);
	}

	static conflict(message: string, details?: unknown): PluginRouteError {
		return new PluginRouteError("CONFLICT", message, 409, details);
	}

	static internal(message: string = "Internal error"): PluginRouteError {
		return new PluginRouteError("INTERNAL_ERROR", message, 500);
	}
}

export class PluginRouteRegistry {
	private handlers: Map<string, PluginRouteHandler> = new Map();

	constructor(private factoryOptions: PluginContextFactoryOptions) {}

	register(plugin: ResolvedPlugin): void {
		const handler = new PluginRouteHandler(plugin, this.factoryOptions);
		this.handlers.set(plugin.id, handler);
	}

	unregister(pluginId: string): void {
		this.handlers.delete(pluginId);
	}

	async invoke(
		pluginId: string,
		routeName: string,
		options: InvokeRouteOptions,
	): Promise<RouteResult> {
		const handler = this.handlers.get(pluginId);

		if (!handler) {
			return {
				success: false,
				error: {
					code: "PLUGIN_NOT_FOUND",
					message: `Plugin "${pluginId}" not found`,
				},
				status: 404,
			};
		}

		return handler.invoke(routeName, options);
	}

	getPluginIds(): string[] {
		return [...this.handlers.keys()];
	}

	getRoutes(pluginId: string): string[] {
		return this.handlers.get(pluginId)?.getRouteNames() ?? [];
	}

	getRouteMeta(pluginId: string, routeName: string): RouteMeta | null {
		const handler = this.handlers.get(pluginId);
		if (!handler) return null;
		return handler.getRouteMeta(routeName);
	}
}

export function createRouteRegistry(
	factoryOptions: PluginContextFactoryOptions,
): PluginRouteRegistry {
	return new PluginRouteRegistry(factoryOptions);
}
