import { canonicalPluginId } from "@superboard/contracts/plugin-packages";
import type {
	NativeFrontPluginModule,
	NativeRendererDocument,
	NativeRendererMountInput,
	PluginLockEntry,
	RendererDescriptor,
} from "@superboard/supbrd-core";

// Browser-safe renderer registry. The build compatibility catalogue stays in
// native-front-plugins.ts so the client entry does not ship it.
const discoveredModules = import.meta.glob<{ nativeFrontPlugin: NativeFrontPluginModule }>(
	["../front-plugins/*.ts", "../../../../packages/plugins/superboard-*/src/front-*.ts"],
	{ eager: true },
);

export const nativeFrontPlugins = new Map<string, NativeFrontPluginModule>();
const legacyComponentPrefix = /^supbrd-(?:plug|plugmod)-/u;

// Releases published before the superboard-* namespace keep their original ids.
export function currentComponentId(id: string): string {
	return id.replace(legacyComponentPrefix, "superboard-");
}

for (const [source, module] of Object.entries(discoveredModules)) {
	const plugin = module.nativeFrontPlugin;
	if (!plugin || typeof plugin.plugin_id !== "string") {
		throw new TypeError(`Native Front plugin module is invalid: ${source}`);
	}
	if (nativeFrontPlugins.has(plugin.plugin_id)) {
		throw new TypeError(`Duplicate native Front plugin: ${plugin.plugin_id}`);
	}
	nativeFrontPlugins.set(plugin.plugin_id, plugin);
}

export function resolveNativeRendererAlias(renderer: RendererDescriptor): RendererDescriptor {
	if (nativeFrontPlugins.has(renderer.plugin_id)) return renderer;
	const current = nativeFrontPlugins.get(currentComponentId(renderer.plugin_id));
	const currentRendererId = currentComponentId(renderer.renderer_id);
	if (current?.renderer_ids.includes(currentRendererId))
		return { ...renderer, plugin_id: current.plugin_id, renderer_id: currentRendererId };
	for (const plugin of nativeFrontPlugins.values()) {
		if (canonicalPluginId(plugin.plugin_id) !== renderer.plugin_id) continue;
		const id = plugin.renderer_ids.find(
			(candidate) => canonicalPluginId(candidate) === renderer.renderer_id,
		);
		if (id) return { ...renderer, plugin_id: plugin.plugin_id, renderer_id: id };
	}
	return renderer;
}

export function resolveLockedNativeFrontPlugin(
	renderer: RendererDescriptor,
	pluginLock: readonly PluginLockEntry[],
): NativeFrontPluginModule {
	const pluginId = renderer.plugin_id;
	if (
		!pluginLock.some(
			({ plugin_id: lockedPluginId }) =>
				lockedPluginId === pluginId || currentComponentId(lockedPluginId) === pluginId,
		)
	) {
		throw new Error(`Renderer plugin is not locked by the Release: ${pluginId}`);
	}
	const plugin = nativeFrontPlugins.get(pluginId);
	if (!plugin || !plugin.renderer_ids.includes(renderer.renderer_id)) {
		throw new Error(`Native renderer is unavailable: ${renderer.renderer_id}`);
	}
	return plugin;
}

/**
 * Client mount path. The server verifies every renderer build checksum against the
 * compatibility catalogue (assertReleasePresentation) before it projects the page,
 * so the browser only re-checks the Release lock and the renderer export.
 */
export function mountProjectedNativeFrontRenderer(input: {
	mount: NativeRendererMountInput;
	plugin_lock: readonly PluginLockEntry[];
}): NativeRendererDocument {
	const renderer = resolveNativeRendererAlias(input.mount.renderer);
	const plugin = resolveLockedNativeFrontPlugin(renderer, input.plugin_lock);
	const document = plugin.mount_renderer({ ...input.mount, renderer });
	if (!document) throw new Error(`Native renderer rejected: ${input.mount.renderer.renderer_id}`);
	return document;
}
