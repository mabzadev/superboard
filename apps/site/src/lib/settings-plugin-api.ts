import {
	pluginSettingLocation,
	pluginPackage,
	componentSettingKey,
} from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { APIContext } from "astro";
import { unwrapResult } from "emdash/api/error";
import {
	requirePerm,
	getPluginSettingsSchema,
	handlePluginSettingsGet,
	handlePluginSettingsUpdate,
} from "emdash/api/plugin-settings";
import * as settings from "emdash/routes/api/admin/plugins/_id_/settings";

export async function dispatchSettingsPluginApi(
	context: APIContext,
	request: Request,
	pluginId = "supbrd-plug-settings",
): Promise<Response> {
	const url = new URL(request.url);
	const owner = pluginPackage(pluginId);
	const aliased = owner && owner.id !== pluginId;
	if (url.pathname === "/_emdash/api/superboard/settings/versions" && request.method === "GET") {
		const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
		let query = context.locals.emdash.db
			.selectFrom("_emdash_plugin_setting_versions")
			.selectAll()
			.where("plugin_id", "in", aliased ? [pluginId, owner.id] : [pluginId]);
		const cursor = url.searchParams.get("cursor");
		if (cursor) query = query.where("id", "<", cursor);
		const rows = await query
			.orderBy("id", "desc")
			.limit(limit + 1)
			.execute();
		return Response.json({
			data: {
				items: rows.slice(0, limit).flatMap((row) => {
					const values: Record<string, unknown> = JSON.parse(row.values_json);
					const secrets: Record<string, boolean> = JSON.parse(row.secrets_set_json);
					const changedKeys: string[] = JSON.parse(row.changed_keys_json);
					if (aliased && row.plugin_id === owner.id) {
						const prefix = `${pluginId}__`;
						const keys = changedKeys.filter((key) => key.startsWith(prefix));
						if (!keys.length) return [];
						return [
							{
								id: row.id,
								values: filterComponentSettings(values, prefix),
								secrets_set: filterComponentSettings(secrets, prefix),
								changed_keys: keys.map((key) => key.slice(prefix.length)),
								created_at: row.created_at,
							},
						];
					}
					return [
						{
							id: row.id,
							values,
							secrets_set: secrets,
							changed_keys: changedKeys,
							created_at: row.created_at,
						},
					];
				}),
				next_cursor: rows.length > limit ? rows[limit - 1].id : null,
			},
		});
	}
	if (url.pathname !== `/_emdash/api/admin/plugins/${pluginId}/settings`)
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	const target = { ...context, request, url, params: { id: owner?.id ?? pluginId } };
	if (!owner)
		return request.method === "GET"
			? settings.GET(target)
			: request.method === "PUT"
				? settings.PUT(target)
				: Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
	const denied = requirePerm(context.locals.user, "plugins:manage");
	if (denied) return denied;
	const runtime = context.locals.emdash;
	const schema = getPluginSettingsSchema(
		runtime.configuredPlugins,
		runtime.sandboxedPluginEntries,
		owner.id,
	);
	if (!schema) return Response.json({ error: { code: "PLUGIN_NOT_FOUND" } }, { status: 404 });
	const keyForSetting = (key: string) => {
		const location = componentSettingKey(owner.id, key);
		return location
			? `plugin:${location.component}:settings:${location.key}`
			: `plugin:${owner.id}:settings:${key}`;
	};
	let response: Response | null = null;
	if (request.method === "PUT") {
		const body = await readJsonObjectLimited(request, 65536);
		if (!body.values || typeof body.values !== "object" || Array.isArray(body.values))
			return Response.json({ error: { code: "INVALID_REQUEST" } }, { status: 422 });
		const values = Object.fromEntries(
			Object.entries(body.values).map(([key, value]) => [
				aliased ? pluginSettingLocation(pluginId, key).key : key,
				value,
			]),
		);
		response = unwrapResult(
			await handlePluginSettingsUpdate(runtime.db, owner.id, schema, values, keyForSetting),
		);
	}
	if (request.method === "GET")
		response = unwrapResult(
			await handlePluginSettingsGet(runtime.db, owner.id, schema, keyForSetting),
		);
	if (response) {
		if (!response.ok || !aliased) return response;
		const body = await readJsonObjectLimited(response, 1_000_000);
		if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
			const prefix = `${pluginId}__`;
			for (const key of ["schema", "values", "secretsSet"] as const) {
				const value = Reflect.get(body.data, key);
				if (value && typeof value === "object" && !Array.isArray(value))
					Reflect.set(
						body.data,
						key,
						Object.fromEntries(
							Object.entries(value)
								.filter(([name]) => name.startsWith(prefix))
								.map(([name, setting]) => [name.slice(prefix.length), setting]),
						),
					);
			}
		}
		return Response.json(body, {
			status: response.status,
			headers: { "Cache-Control": "private, no-store" },
		});
	}
	return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
}

function filterComponentSettings<T>(values: Record<string, T>, prefix: string) {
	return Object.fromEntries(
		Object.entries(values)
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, value]) => [key.slice(prefix.length), value]),
	);
}
