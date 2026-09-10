import { resolvePluginApiOwner } from "@superboard/contracts/plugin-api-owner";
import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import type { MiddlewareHandler } from "hono";

import type { Env } from "../types.js";

export const pluginHttpAdmission: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	const url = new URL(c.req.url);
	const host = c.req.header("Host") ?? url.hostname;
	const applicationRoute =
		url.pathname === "/custom/v1" ||
		url.pathname.startsWith("/custom/v1/") ||
		url.pathname.startsWith("/api/v1/sdk/custom/") ||
		url.pathname.startsWith("/api/v1/platform/custom/");
	const plugin =
		applicationRoute && c.env.CUSTOM_WORKER_PLUGIN_ID
			? c.env.CUSTOM_WORKER_PLUGIN_ID
			: host === c.env.AUTH_DOMAIN
				? "supbrd-plug-user"
				: host === c.env.FILES_DOMAIN
					? "supbrd-plugmod-files"
					: host === c.env.SHORTLINK_DOMAIN
						? "supbrd-plugmod-dynamic-links"
						: resolvePluginApiOwner(url.pathname);
	if (plugin === "supbrd-core" || c.req.method === "OPTIONS") return next();
	try {
		const result = await runPluginTask(
			c.env,
			plugin,
			{ kind: "runtime", task_id: `http:${crypto.randomUUID()}`, duration_ms: 60000 },
			async () => {
				await next();
				return c.res;
			},
		);
		return result.ran
			? result.value
			: Response.json(
					{ error: { code: "PLUGIN_NOT_ACTIVE", message: "Plugin is not active" } },
					{ status: 404, headers: { "Cache-Control": "no-store" } },
				);
	} catch (error) {
		if (error instanceof PluginTaskUnavailable)
			return Response.json(
				{ error: { code: error.code, message: error.code } },
				{ status: error.status, headers: { "Cache-Control": "no-store" } },
			);
		throw error;
	}
};
