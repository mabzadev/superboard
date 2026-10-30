import {
	createFetchRouter,
	registeredRoutes,
	resolveRegisteredRoute,
	type RouteAccess,
	type RouteDescriptor,
} from "@superboard/contracts/route-registry";
import type { MiddlewareHandler } from "astro";

type Context = Parameters<MiddlewareHandler>[0];
type Next = Parameters<MiddlewareHandler>[1];
type SiteHandler = (context: Context, next: Next) => Response | Promise<Response>;
type State = { context: Context; next: Next };
const key = Symbol.for("superboard.site-middleware-routes.v1");
const globals = globalThis as typeof globalThis & {
	[key]?: Map<string, Parameters<typeof registeredRoutes>[0]>;
};
const registries = (globals[key] ??= new Map<string, Parameters<typeof registeredRoutes>[0]>());

export function registerSiteRouteSource(
	module: string,
	router: Parameters<typeof registeredRoutes>[0],
) {
	registries.set(module, router);
}

export function createSiteRouteMiddleware(options: {
	module: string;
	pluginId: string;
	access: RouteAccess;
}) {
	const router = createFetchRouter<State>({ ...options, service: "site", surface: "board" });
	registries.set(options.module, router);
	return {
		on(method: string | string[], path: string | string[], handler: SiteHandler) {
			router.on(method, path, ({ env }) => handler(env.context, env.next));
		},
		onRequest: ((context, next) => {
			if (!resolveRegisteredRoute(router, context.request.method, "board", context.url.pathname))
				return next();
			return router.fetch(context.request, { context, next });
		}) satisfies MiddlewareHandler,
	};
}

export function siteMiddlewareRoutes(): RouteDescriptor[] {
	return [...registries.values()].flatMap((router) => registeredRoutes(router));
}
