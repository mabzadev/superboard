import { verifyPluginTaskRequest } from "@superboard/contracts/plugin-task";

import { requireActiveSuperBoardPlugin } from "./plugin-availability.js";
import type { SuperBoardSiteEnv } from "./site-env.js";
import {
	resolveSuperBoardPluginTarget,
	superBoardRuntimePluginCatalog,
} from "./superboard-plugin-catalog.js";

export async function runtimePluginSettings(
	request: Request,
	pluginId: string,
	env: SuperBoardSiteEnv,
): Promise<Response> {
	const url = new URL(request.url);
	if (
		url.searchParams.get("instance_id") !== env.SUPERBOARD_INSTANCE_ID ||
		url.searchParams.get("environment") !== env.SUPERBOARD_ENVIRONMENT
	)
		return Response.json({ error: { code: "DEPLOYMENT_CONTEXT_MISMATCH" } }, { status: 403 });
	if (
		!env.SITE_OPERATOR_BRIDGE_TOKEN ||
		!(await verifyPluginTaskRequest(request, env.SITE_OPERATOR_BRIDGE_TOKEN))
	)
		return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
	const inactive = await requireActiveSuperBoardPlugin(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
		plugin_id: pluginId,
	});
	if (inactive) return inactive;
	const plugin = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest }) => manifest.plugin_id === pluginId,
	);
	if (!plugin) return Response.json({ error: { code: "PLUGIN_NOT_FOUND" } }, { status: 404 });
	const schema = plugin.manifest.settings.schema;
	const properties =
		schema &&
		typeof schema === "object" &&
		"properties" in schema &&
		schema.properties &&
		typeof schema.properties === "object"
			? schema.properties
			: {};
	const keys = Object.entries(properties)
		.filter(
			([, field]) =>
				field && typeof field === "object" && !("writeOnly" in field && field.writeOnly === true),
		)
		.map(([key]) => key);
	if (!keys.length) return Response.json({ values: {} });
	const prefix = `plugin:${pluginId}:settings:`;
	const names = keys.map((key) => `${prefix}${key}`);
	const rows = await env.DB.prepare(
		`SELECT name, value FROM options WHERE name IN (${names.map(() => "?").join(",")})`,
	)
		.bind(...names)
		.all<{ name: string; value: string }>();
	return Response.json(
		{
			values: Object.fromEntries(
				rows.results.map((row) => [row.name.slice(prefix.length), JSON.parse(row.value)]),
			),
		},
		{ headers: { "Cache-Control": "no-store" } },
	);
}
