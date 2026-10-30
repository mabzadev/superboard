import { delegatedAppOwner } from "./delegated-route-owner.js";
import { registeredRequestDefinition } from "@superboard/contracts/route-registry";
import { runPluginTask, PluginTaskUnavailable, pluginTaskManagementRequired } from "@superboard/contracts/plugin-task";
import type { MiddlewareHandler } from "hono";

import type { Env } from "../types.js";

export const pluginHttpAdmission: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	if (c.req.method === "OPTIONS") return next();
	const definition = registeredRequestDefinition(c.req.matchedRoutes);
	if (!definition) return c.json({ error: { code: "ROUTE_OWNER_UNAVAILABLE" } }, 503);
	try {
		if (definition.delegatedOwner === "app" && !pluginTaskManagementRequired(c.env)) return next();
		const plugin = definition.delegatedOwner === "app" ? await delegatedAppOwner(c.req.raw, c.env) : definition.ownerBinding ? c.env[definition.ownerBinding] ?? definition.pluginId : definition.pluginId;
		if (plugin === "supbrd-core") return next();
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
