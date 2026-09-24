import type { PluginLockEntry, RendererDescriptor } from "@superboard/supbrd-core";

import { CORE_OPERATOR_SURFACES } from "./core-front-contract.js";
import { assertNativeFrontRenderer } from "./native-front-plugins.js";
import { loadPluginClientView } from "./plugin-client-catalog.js";

interface RouteViewValidationFailure {
	route_id: string;
	path_pattern: string;
	plugin_id: string;
	error: string;
}

export async function validateReleaseRouteViews(
	routes: readonly { route_id: string; path_pattern: string; renderer_ids: readonly string[] }[],
	renderers: readonly RendererDescriptor[],
	pluginLock: readonly PluginLockEntry[],
): Promise<RouteViewValidationFailure[]> {
	const failures: RouteViewValidationFailure[] = [];
	const renderersById = new Map(renderers.map((renderer) => [renderer.renderer_id, renderer]));
	for (const route of routes) {
		for (const rendererId of route.renderer_ids.length ? route.renderer_ids : [undefined]) {
			const renderer = rendererId ? renderersById.get(rendererId) : undefined;
			let pluginId = renderer?.plugin_id ?? "unknown";
			try {
				if (!renderer) throw new Error(`Renderer descriptor missing: ${rendererId ?? "none"}`);
				const plugin = assertNativeFrontRenderer(renderer, pluginLock);
				pluginId = plugin.plugin_id;
				if (pluginId === "supbrd-core") {
					if (
						!CORE_OPERATOR_SURFACES.some(
							(surface) =>
								surface.route_id === route.route_id && surface.renderer_id === rendererId,
						)
					) {
						throw new Error(`View is not registered by ${pluginId}: ${route.route_id}`);
					}
				} else {
					await loadPluginClientView(pluginId, route.route_id);
				}
			} catch (error) {
				failures.push({
					route_id: route.route_id,
					path_pattern: route.path_pattern,
					plugin_id: pluginId,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
	return failures;
}
