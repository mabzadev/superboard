import type { User, RoleLevel } from "@emdash-cms/auth";
import { createKyselyAdapter } from "@emdash-cms/auth/adapters/kysely";
import { defineMiddleware } from "astro:middleware";
import { ulid } from "ulidx";
import { authenticate as virtualAuthenticate } from "virtual:emdash/auth";
// @ts-ignore - virtual module
import virtualConfig from "virtual:emdash/config";

import { checkPublicCsrf } from "../../api/csrf.js";
import { apiError } from "../../api/error.js";
import { getPublicOrigin } from "../../api/public-url.js";

const MW_CACHE_HEADERS = {
	"Cache-Control": "private, no-store",
} as const;
import { resolveApiToken, resolveOAuthToken } from "../../api/handlers/api-tokens.js";
import { hasScope } from "../../auth/api-tokens.js";
import { getAuthMode, type ExternalAuthMode } from "../../auth/mode.js";
import type { ExternalAuthConfig } from "../../auth/types.js";
import { resolveSessionUser } from "../session-user.js";
import type { EmDashHandlers } from "../types.js";
import { buildEmDashCsp, getConfiguredStorageEndpoint } from "./csp.js";

declare global {
	namespace App {
		interface Locals {
			user?: User;
			tokenScopes?: string[];
			emdash?: EmDashHandlers;
		}
		interface SessionData {
			user: { id: string };
			hasSeenWelcome: boolean;
			strongReauthentication: { userId: string; verifiedAt: string };
		}
	}
}

const ROLE_ADMIN = 50;
const MCP_ENDPOINT_PATH = "/_emdash/api/mcp";
const COMMENT_SUBMISSION_PATH = /^\/_emdash\/api\/comments\/[^/]+\/[^/]+\/?$/;

function isUnsafeMethod(method: string): boolean {
	return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function csrfRejectedResponse(): Response {
	return apiError("CSRF_REJECTED", "Missing required header", 403);
}

function mcpUnauthorizedResponse(
	url: URL,
	config?: Parameters<typeof getPublicOrigin>[1],
): Response {
	const origin = getPublicOrigin(url, config);
	const response = apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
	response.headers.set(
		"WWW-Authenticate",
		`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
	);
	return response;
}

const PUBLIC_API_PREFIXES = [
	"/_emdash/api/setup",
	"/_emdash/api/auth/login",
	"/_emdash/api/auth/register",
	"/_emdash/api/auth/dev-bypass",
	"/_emdash/api/auth/signup/",
	"/_emdash/api/auth/magic-link/",
	"/_emdash/api/auth/invite/",
	"/_emdash/api/auth/oauth/",
	"/_emdash/api/oauth/device/token",
	"/_emdash/api/oauth/device/code",
	"/_emdash/api/oauth/token",
	"/_emdash/api/oauth/register",
	"/_emdash/api/comments/",
	"/_emdash/api/media/file/",
	"/_emdash/.well-known/",
];

const PUBLIC_API_EXACT = new Set([
	"/_emdash/api/auth/passkey/options",
	"/_emdash/api/auth/passkey/verify",
	"/_emdash/api/auth/mode",
	"/_emdash/api/oauth/token",
	"/_emdash/api/snapshot",
	"/_emdash/api/search",
	"/_emdash/api/search/suggest",
]);

const { exact: _providerExactRoutes, prefixes: _providerPrefixRoutes } = (() => {
	const exact = new Set<string>();
	const prefixes: string[] = [];
	if (!virtualConfig?.authProviders) return { exact, prefixes };
	for (const route of virtualConfig.authProviders.flatMap((p) => p.publicRoutes ?? [])) {
		if (route.endsWith("/")) {
			prefixes.push(route);
		} else {
			exact.add(route);
		}
	}
	return { exact, prefixes };
})();

const CSRF_EXEMPT_PUBLIC_ROUTES = new Set([
	"/_emdash/api/oauth/token",
	"/_emdash/api/oauth/register",
	"/_emdash/api/oauth/device/code",
	"/_emdash/api/oauth/device/token",
]);

function isPublicEmDashRoute(pathname: string): boolean {
	if (PUBLIC_API_EXACT.has(pathname)) return true;
	if (PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))) return true;
	if (_providerExactRoutes.has(pathname)) return true;
	if (_providerPrefixRoutes.some((p) => pathname.startsWith(p))) return true;
	if (import.meta.env.DEV && pathname === "/_emdash/api/typegen") return true;
	return false;
}

function isCsrfExemptPublicRoute(pathname: string): boolean {
	return CSRF_EXEMPT_PUBLIC_ROUTES.has(pathname);
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { url } = context;

	const isAdminRoute = url.pathname.startsWith("/_emdash/admin");
	const isSetupRoute = url.pathname.startsWith("/_emdash/admin/setup");
	const isApiRoute = url.pathname.startsWith("/_emdash/api");
	const isPublicApiRoute = isPublicEmDashRoute(url.pathname);

	const isPublicRoute = !isAdminRoute && !isApiRoute;

	if (isPublicApiRoute) {
		const method = context.request.method.toUpperCase();
		if (isUnsafeMethod(method) && !isCsrfExemptPublicRoute(url.pathname)) {
			const publicOrigin = getPublicOrigin(url, context.locals.emdash?.config);
			const csrfError = checkPublicCsrf(context.request, url, publicOrigin);
			if (csrfError) return csrfError;
		}
		if (method === "POST" && COMMENT_SUBMISSION_PATH.test(url.pathname)) {
			return handlePublicRouteAuth(context, next);
		}
		return next();
	}

	const isPluginRoute = url.pathname.startsWith("/_emdash/api/plugins/");
	if (isPluginRoute) {
		const method = context.request.method.toUpperCase();
		if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
			const publicOrigin = getPublicOrigin(url, context.locals.emdash?.config);
			const csrfError = checkPublicCsrf(context.request, url, publicOrigin);
			if (csrfError) return csrfError;
		}
		return handlePluginRouteAuth(context, next);
	}

	if (isSetupRoute) {
		const method = context.request.method.toUpperCase();
		if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
			const csrfHeader = context.request.headers.get("X-EmDash-Request");
			if (csrfHeader !== "1") {
				return apiError("CSRF_REJECTED", "Missing required header", 403);
			}
		}
		return next();
	}

	if (isPublicRoute) {
		return handlePublicRouteAuth(context, next);
	}

	const bearerResult = await handleBearerAuth(context);

	if (bearerResult === "invalid") {
		const response = apiError("INVALID_TOKEN", "Invalid or expired token", 401);
		if (url.pathname === "/_emdash/api/mcp") {
			const origin = getPublicOrigin(url, context.locals.emdash?.config);
			response.headers.set(
				"WWW-Authenticate",
				`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
			);
		}
		return response;
	}

	const isTokenAuth = bearerResult === "authenticated";

	const method = context.request.method.toUpperCase();
	const isMcpEndpoint = url.pathname === MCP_ENDPOINT_PATH;
	if (isMcpEndpoint && !isTokenAuth) {
		return mcpUnauthorizedResponse(url, context.locals.emdash?.config);
	}

	const isOAuthConsent = url.pathname.startsWith("/_emdash/oauth/authorize");
	if (
		isApiRoute &&
		!isTokenAuth &&
		!isOAuthConsent &&
		isUnsafeMethod(method) &&
		!isPublicApiRoute
	) {
		const csrfHeader = context.request.headers.get("X-EmDash-Request");
		if (csrfHeader !== "1") {
			return csrfRejectedResponse();
		}
	}

	if (isTokenAuth) {
		const scopeError = enforceTokenScope(url.pathname, method, context.locals.tokenScopes);
		if (scopeError) return scopeError;

		const response = await next();
		if (!import.meta.env.DEV) {
			response.headers.set(
				"Content-Security-Policy",
				buildEmDashCsp(
					context.locals.emdash?.config.experimental?.registry,
					getConfiguredStorageEndpoint(
						context.locals.emdash?.config.storage,
						context.locals.emdash?.storage,
					),
				),
			);
		}
		return response;
	}

	const response = await handleEmDashAuth(context, next);

	if (!import.meta.env.DEV) {
		response.headers.set(
			"Content-Security-Policy",
			buildEmDashCsp(
				context.locals.emdash?.config.experimental?.registry,
				getConfiguredStorageEndpoint(
					context.locals.emdash?.config.storage,
					context.locals.emdash?.storage,
				),
			),
		);
	}

	return response;
});

async function handleEmDashAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
	next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
): Promise<Response> {
	const { url, locals } = context;
	const { emdash } = locals;

	const isPublicAdminRoute =
		url.pathname.startsWith("/_emdash/admin/login") ||
		url.pathname === "/_emdash/admin/signup" ||
		url.pathname === "/_emdash/admin/signup/" ||
		url.pathname.startsWith("/_emdash/admin/invite/accept");
	const isApiRoute = url.pathname.startsWith("/_emdash/api");

	if (!emdash?.db) {
		return next();
	}

	const authMode = getAuthMode(emdash.config);

	if (authMode.type === "external") {
		if (import.meta.env.DEV) {
			if (isPublicAdminRoute) {
				return next();
			}

			return handlePasskeyAuth(context, next, isApiRoute);
		}

		return handleExternalAuth(context, next, authMode, isApiRoute);
	}

	if (isPublicAdminRoute) {
		return next();
	}

	return handlePasskeyAuth(context, next, isApiRoute);
}

async function handlePluginRouteAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
	next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
): Promise<Response> {
	const { locals, url } = context;
	const { emdash } = locals;

	try {
		const bearerResult = await handleBearerAuth(context);
		if (bearerResult === "authenticated") {
			return next();
		}
		if (bearerResult === "invalid") {
			return apiError("INVALID_TOKEN", "Invalid or expired token", 401);
		}
	} catch (error) {
		console.error("Plugin route bearer auth error:", error);
	}

	const authMode = getAuthMode(emdash?.config);
	if (
		authMode.type === "external" &&
		!import.meta.env.DEV &&
		!isPublicPluginApiRoute(url.pathname, emdash)
	) {
		return handleExternalAuth(context, next, authMode, true);
	}

	try {
		const { session } = context;
		const sessionUser = await resolveSessionUser(session);
		if (sessionUser?.id && emdash?.db) {
			const adapter = createKyselyAdapter(emdash.db);
			const user = await adapter.getUserById(sessionUser.id);
			if (user && !user.disabled) {
				locals.user = user;
			}
		}
	} catch (error) {
		console.error("Plugin route session auth error:", error);
	}

	return next();
}

function isPublicPluginApiRoute(pathname: string, emdash: EmDashHandlers | undefined): boolean {
	const prefix = "/_emdash/api/plugins/";
	const route = pathname.slice(prefix.length);
	const slashIndex = route.indexOf("/");
	if (slashIndex <= 0 || !emdash?.getPluginRouteMeta) return false;

	return (
		emdash.getPluginRouteMeta(route.slice(0, slashIndex), route.slice(slashIndex))?.public === true
	);
}

async function handlePublicRouteAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
	next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
): Promise<Response> {
	const { locals, session } = context;
	const { emdash } = locals;

	try {
		const sessionUser = await resolveSessionUser(session);
		if (sessionUser?.id && emdash?.db) {
			const adapter = createKyselyAdapter(emdash.db);
			const user = await adapter.getUserById(sessionUser.id);
			if (user && !user.disabled) {
				locals.user = user;
			}
		}
	} catch {}

	return next();
}

async function handleExternalAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
	next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
	authMode: ExternalAuthMode,
	_isApiRoute: boolean,
): Promise<Response> {
	const { locals, request } = context;
	const { emdash } = locals;

	try {
		if (typeof virtualAuthenticate !== "function") {
			throw new Error(
				`Auth provider ${authMode.entrypoint} does not export an authenticate function`,
			);
		}

		const authResult = await virtualAuthenticate(request, authMode.config);

		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing AuthModeConfig to ExternalAuthConfig after provider check
		const externalConfig = authMode.config as ExternalAuthConfig;

		const adapter = createKyselyAdapter(emdash.db);
		let user = await adapter.getUserByEmail(authResult.email);

		if (!user) {
			if (externalConfig.autoProvision === false) {
				return new Response("User not authorized", {
					status: 403,
					headers: { "Content-Type": "text/plain", ...MW_CACHE_HEADERS },
				});
			}

			const userCount = await emdash.db
				.selectFrom("users")
				.select(emdash.db.fn.count("id").as("count"))
				.executeTakeFirst();

			const isFirstUser = Number(userCount?.count ?? 0) === 0;
			const role = isFirstUser ? ROLE_ADMIN : authResult.role;

			const now = new Date().toISOString();
			const newUser = {
				id: ulid(),
				email: authResult.email,
				name: authResult.name,
				role,
				email_verified: 1,
				created_at: now,
				updated_at: now,
			};

			await emdash.db.insertInto("users").values(newUser).execute();

			user = await adapter.getUserByEmail(authResult.email);

			console.log(
				`[external-auth] Provisioned user: ${authResult.email} (role: ${role}, first: ${isFirstUser})`,
			);
		} else {
			const updates: Record<string, unknown> = {};
			let newName: string | undefined;
			let newRole: RoleLevel | undefined;

			if (authResult.name && user.name !== authResult.name) {
				newName = authResult.name;
				updates.name = newName;
			}

			if (externalConfig.syncRoles && user.role !== authResult.role) {
				newRole = authResult.role;
				updates.role = newRole;
			}

			if (Object.keys(updates).length > 0) {
				updates.updated_at = new Date().toISOString();
				await emdash.db.updateTable("users").set(updates).where("id", "=", user.id).execute();

				user = {
					...user,
					...(newName ? { name: newName } : {}),
					...(newRole ? { role: newRole } : {}),
				};

				console.log(
					`[external-auth] Updated user ${authResult.email}:`,
					Object.keys(updates).filter((k) => k !== "updated_at"),
				);
			}
		}

		if (!user) {
			return new Response("Failed to provision user", {
				status: 500,
				headers: { "Content-Type": "text/plain", ...MW_CACHE_HEADERS },
			});
		}

		if (user.disabled) {
			return new Response("Account disabled", {
				status: 403,
				headers: { "Content-Type": "text/plain", ...MW_CACHE_HEADERS },
			});
		}

		locals.user = user;

		const { session } = context;
		session?.set("user", { id: user.id });

		return next();
	} catch (error) {
		console.error("[external-auth] Auth error:", error);

		return new Response("Authentication failed", {
			status: 401,
			headers: { "Content-Type": "text/plain", ...MW_CACHE_HEADERS },
		});
	}
}

async function handleBearerAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
): Promise<"authenticated" | "invalid" | "none"> {
	const authHeader = context.request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) return "none";

	const token = authHeader.slice(7);
	if (!token) return "none";

	const { locals } = context;
	const { emdash } = locals;
	if (!emdash?.db) return "none";

	let resolved: { userId: string; scopes: string[] } | null = null;

	if (token.startsWith("ec_pat_")) {
		resolved = await resolveApiToken(emdash.db, token);
	} else if (token.startsWith("ec_oat_")) {
		resolved = await resolveOAuthToken(emdash.db, token);
	} else {
		return "invalid";
	}

	if (!resolved) return "invalid";

	const adapter = createKyselyAdapter(emdash.db);
	const user = await adapter.getUserById(resolved.userId);

	if (!user || user.disabled) return "invalid";

	locals.user = user;
	locals.tokenScopes = resolved.scopes;

	return "authenticated";
}

async function handlePasskeyAuth(
	context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
	next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
	isApiRoute: boolean,
): Promise<Response> {
	const { url, locals, session } = context;
	const { emdash } = locals;

	try {
		const sessionUser = await resolveSessionUser(session);

		if (!sessionUser?.id) {
			if (isApiRoute) {
				return apiError("NOT_AUTHENTICATED", "Not authenticated", 401);
			}
			const loginUrl = new URL("/_emdash/admin/login", getPublicOrigin(url, emdash?.config));
			loginUrl.searchParams.set("redirect", url.pathname);
			return context.redirect(loginUrl.toString());
		}

		const adapter = createKyselyAdapter(emdash.db);
		const user = await adapter.getUserById(sessionUser.id);

		if (!user) {
			session?.destroy();
			if (isApiRoute) {
				return apiError("NOT_FOUND", "User not found", 401);
			}
			const loginUrl = new URL("/_emdash/admin/login", getPublicOrigin(url, emdash?.config));
			return context.redirect(loginUrl.toString());
		}

		if (user.disabled) {
			session?.destroy();
			if (isApiRoute) {
				return apiError("ACCOUNT_DISABLED", "Account disabled", 403);
			}
			const loginUrl = new URL("/_emdash/admin/login", getPublicOrigin(url, emdash?.config));
			loginUrl.searchParams.set("error", "account_disabled");
			return context.redirect(loginUrl.toString());
		}

		locals.user = user;
	} catch (error) {
		console.error("Auth middleware error:", error);
		return context.redirect("/_emdash/admin/login");
	}

	return next();
}

const SCOPE_RULES: Array<[prefix: string, method: string, scope: string]> = [
	["/_emdash/api/content", "GET", "content:read"],
	["/_emdash/api/content", "WRITE", "content:write"],

	["/_emdash/api/media/file", "*", "media:read"],
	["/_emdash/api/media", "GET", "media:read"],
	["/_emdash/api/media", "WRITE", "media:write"],

	["/_emdash/api/schema", "GET", "schema:read"],
	["/_emdash/api/schema", "WRITE", "schema:write"],

	["/_emdash/api/taxonomies", "GET", "content:read"],
	["/_emdash/api/taxonomies", "WRITE", "taxonomies:manage"],
	["/_emdash/api/menus", "GET", "content:read"],
	["/_emdash/api/menus", "WRITE", "menus:manage"],
	["/_emdash/api/sections", "GET", "content:read"],
	["/_emdash/api/sections", "WRITE", "content:write"],
	["/_emdash/api/widget-areas", "GET", "content:read"],
	["/_emdash/api/widget-areas", "WRITE", "content:write"],
	["/_emdash/api/revisions", "GET", "content:read"],
	["/_emdash/api/revisions", "WRITE", "content:write"],

	["/_emdash/api/search", "GET", "content:read"],
	["/_emdash/api/search", "WRITE", "admin"],

	["/_emdash/api/import", "*", "admin"],
	["/_emdash/api/admin", "*", "admin"],
	["/_emdash/api/plugins", "*", "admin"],

	["/_emdash/api/settings", "GET", "settings:read"],
	["/_emdash/api/settings", "WRITE", "settings:manage"],
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function enforceTokenScope(
	pathname: string,
	method: string,
	tokenScopes: string[] | undefined,
): Response | null {
	if (!tokenScopes) return null;

	if (pathname === MCP_ENDPOINT_PATH) return null;

	const isWrite = WRITE_METHODS.has(method);

	for (const [prefix, ruleMethod, scope] of SCOPE_RULES) {
		if (pathname !== prefix && !pathname.startsWith(prefix + "/")) continue;

		if (ruleMethod === "*" || (ruleMethod === "WRITE" && isWrite) || ruleMethod === method) {
			if (hasScope(tokenScopes, scope)) return null;

			return apiError("INSUFFICIENT_SCOPE", `Token lacks required scope: ${scope}`, 403);
		}
	}

	if (hasScope(tokenScopes, "admin")) return null;

	return apiError("INSUFFICIENT_SCOPE", "Token lacks required scope: admin", 403);
}
