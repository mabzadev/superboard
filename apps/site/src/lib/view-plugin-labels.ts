import { pluginPackage } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";

export async function withViewPluginLabels(response: Response, locale: string): Promise<Response> {
	if (!response.ok) return response;
	const body = await readJsonObjectLimited(response.clone(), 2_000_000);
	const data = record(body.data);
	const collections = record(data?.collections);
	const views = record(collections?.views);
	const fields = record(views?.fields);
	const plugin = record(fields?.plugin_id);
	if (!fields || !plugin) return response;
	const available = new Map<string, { value: string; label: string }>();
	for (const [id, state] of Object.entries(record(data?.plugins) ?? {})) {
		const owner = pluginPackage(id);
		if (!owner || record(state)?.enabled === false) continue;
		available.set(owner.directory, {
			value: owner.directory,
			label: locale === "fr" ? owner.label_fr : owner.label,
		});
	}
	fields.plugin_id = {
		...plugin,
		kind: "select",
		readOnly: false,
		options: [...available.values()],
	};
	for (const name of ["route_id", "path", "renderer_id", "bindings"]) {
		const field = record(fields[name]);
		if (field) fields[name] = { ...field, readOnly: true };
	}
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "private, no-store");
	headers.delete("Content-Length");
	headers.delete("ETag");
	return Response.json(body, { status: response.status, headers });
}

function record(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
