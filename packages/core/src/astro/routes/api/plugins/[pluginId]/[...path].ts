import { Permissions, type Permission } from "@emdash-cms/auth";
import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess } from "#api/error.js";
import { requireScope } from "#auth/scopes.js";

export const prerender = false;

const handleRequest: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const pluginId = params.pluginId!;
	const path = params.path || "";
	const method = request.method.toUpperCase();

	if (!emdash?.handlePluginApiRoute) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	const routeMeta = emdash.getPluginRouteMeta(pluginId, `/${path}`);

	if (!routeMeta) {
		return apiError("NOT_FOUND", "Plugin route not found", 404);
	}

	if (!routeMeta.public) {
		const permission = routeMeta.permission ?? "plugins:manage";
		if (!(permission in Permissions)) {
			return apiError("INVALID_PLUGIN_ROUTE", "Plugin route declares an invalid permission", 500);
		}
		const denied = requirePerm(user, permission as Permission);
		if (denied) return denied;

		const scopeError = requireScope(locals, "admin");
		if (scopeError) return scopeError;

		if (!locals.tokenScopes && request.headers.get("X-EmDash-Request") !== "1") {
			return apiError("CSRF_REJECTED", "Missing required header", 403);
		}
	}

	const caller = routeMeta.public ? undefined : user;

	const result = await emdash.handlePluginApiRoute(pluginId, method, `/${path}`, request, caller);

	if (!result.success) {
		const code = result.error?.code ?? "PLUGIN_ERROR";
		const message =
			code === "INTERNAL_ERROR"
				? "Plugin route error"
				: (result.error?.message ?? "Plugin route error");
		const status = (result as { status?: number }).status ?? (code === "NOT_FOUND" ? 404 : 400);
		return apiError(code, message, status);
	}

	const response = apiSuccess(result.data);
	if (routeMeta.cacheControl && (method === "GET" || method === "HEAD")) {
		response.headers.set("Cache-Control", routeMeta.cacheControl);
	}
	return response;
};

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
