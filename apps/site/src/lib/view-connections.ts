import { canonicalFrontPath } from "@superboard/contracts/front-paths";
import { canonicalPluginId } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { FrontReleasePayload } from "@superboard/supbrd-core";

const contributionPathPattern = /\/(commands|data-sources)\/([^/]+)$/u;

export function pluginViewBindings(release: FrontReleasePayload | null, pluginId: string) {
	const dataSources = new Set<string>();
	const commands = new Set<string>();
	if (release?.plugin_lock.some((plugin) => plugin.plugin_id === pluginId)) {
		for (const route of release.gateway_manifest.routes) {
			if (route.destination !== pluginId || route.audience !== "superboard_front") continue;
			const contribution = route.path_pattern.match(contributionPathPattern);
			if (!contribution?.[2]) continue;
			if (contribution[1] === "commands" && route.method === "POST")
				commands.add(canonicalPluginId(contribution[2]));
			if (contribution[1] === "data-sources" && route.method === "GET")
				dataSources.add(canonicalPluginId(contribution[2]));
		}
	}
	return { data_sources: [...dataSources], commands: [...commands] };
}

export function resolveViewConnections(
	data: Record<string, unknown>,
	release: FrontReleasePayload | null,
): Record<string, unknown> {
	const path = typeof data.path === "string" ? canonicalFrontPath(data.path) : null;
	const route = release?.front_route_manifest.routes.find(
		(candidate) =>
			candidate.route_kind === "page" &&
			candidate.audience === "superboard_front" &&
			(path
				? canonicalFrontPath(candidate.path_pattern) === path
				: candidate.route_id === data.route_id),
	);
	const renderer =
		route &&
		release?.renderers.find((candidate) => route.renderer_ids.includes(candidate.renderer_id));
	if (
		!route ||
		!renderer ||
		!release?.plugin_lock.some((plugin) => plugin.plugin_id === renderer.plugin_id)
	)
		return { ...data, renderer_id: "", bindings: { data_sources: [], commands: [] } };
	return {
		...data,
		plugin_id: renderer.plugin_id,
		route_id: route.route_id,
		path: route.path_pattern,
		renderer_id: renderer.renderer_id,
		bindings: pluginViewBindings(release, renderer.plugin_id),
	};
}

export async function withViewConnections(response: Response, release: FrontReleasePayload | null) {
	if (!response.ok) return response;
	const body = await readJsonObjectLimited(response.clone(), 2_000_000);
	if (!isRecord(body.data)) return response;
	if (!Array.isArray(body.data.items) && !isRecord(body.data.item)) return response;
	const project = (item: unknown) =>
		isRecord(item) && isRecord(item.data)
			? { ...item, data: canonicalViewData(resolveViewConnections(item.data, release)) }
			: item;
	if (Array.isArray(body.data.items)) body.data.items = body.data.items.map(project);
	if (body.data.item) body.data.item = project(body.data.item);
	const headers = new Headers(response.headers);
	headers.set("Cache-Control", "private, no-store");
	headers.delete("Content-Length");
	headers.delete("ETag");
	return Response.json(body, { status: response.status, headers });
}

function canonicalViewData(data: Record<string, unknown>) {
	return {
		...data,
		plugin_id:
			typeof data.plugin_id === "string" ? canonicalPluginId(data.plugin_id) : data.plugin_id,
		renderer_id:
			typeof data.renderer_id === "string" ? canonicalPluginId(data.renderer_id) : data.renderer_id,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
