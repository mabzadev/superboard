import type { APIContext } from "astro";
import * as settings from "emdash/routes/api/admin/plugins/_id_/settings";

const pluginId = "supbrd-plug-settings";

export async function dispatchSettingsPluginApi(
	context: APIContext,
	request: Request,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/_emdash/api/superboard/settings/versions" && request.method === "GET") {
		const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
		let query = context.locals.emdash.db
			.selectFrom("_emdash_plugin_setting_versions")
			.selectAll()
			.where("plugin_id", "=", pluginId);
		const cursor = url.searchParams.get("cursor");
		if (cursor) query = query.where("id", "<", cursor);
		const rows = await query
			.orderBy("id", "desc")
			.limit(limit + 1)
			.execute();
		return Response.json({
			data: {
				items: rows
					.slice(0, limit)
					.map((row) => ({
						id: row.id,
						values: JSON.parse(row.values_json),
						secrets_set: JSON.parse(row.secrets_set_json),
						changed_keys: JSON.parse(row.changed_keys_json),
						created_at: row.created_at,
					})),
				next_cursor: rows.length > limit ? rows[limit - 1].id : null,
			},
		});
	}
	if (url.pathname !== `/_emdash/api/admin/plugins/${pluginId}/settings`)
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	const target = { ...context, request, url, params: { id: pluginId } };
	if (request.method === "GET") return settings.GET(target);
	if (request.method === "PUT") return settings.PUT(target);
	return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
}
