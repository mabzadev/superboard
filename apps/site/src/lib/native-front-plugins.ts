import type {
	NativeFrontPluginModule,
	NativeRendererDocument,
	NativeRendererMountInput,
	PluginLockEntry,
	RendererDescriptor,
} from "@superboard/supbrd-core";

const discoveredModules = import.meta.glob<{ nativeFrontPlugin: NativeFrontPluginModule }>(
	[
		"../front-plugins/*.ts",
		"../../../../packages/supbrd-plug-user/src/native-front.ts",
		"../../../../packages/supbrd-runtime-plugins/src/front/plugins/*.ts",
	],
	{ eager: true },
);

const plugins = new Map<string, NativeFrontPluginModule>();
for (const [source, module] of Object.entries(discoveredModules)) {
	const plugin = module.nativeFrontPlugin;
	if (!plugin || typeof plugin.plugin_id !== "string") {
		throw new TypeError(`Native Front plugin module is invalid: ${source}`);
	}
	if (plugins.has(plugin.plugin_id)) {
		throw new TypeError(`Duplicate native Front plugin: ${plugin.plugin_id}`);
	}
	plugins.set(plugin.plugin_id, plugin);
}

export function nativeFrontPluginCatalog(): NativeFrontPluginModule[] {
	return [...plugins.values()].toSorted((left, right) =>
		left.plugin_id.localeCompare(right.plugin_id),
	);
}

export function mountNativeFrontRenderer(input: {
	mount: NativeRendererMountInput;
	plugin_lock: readonly PluginLockEntry[];
}): NativeRendererDocument {
	const plugin = assertNativeFrontRenderer(input.mount.renderer, input.plugin_lock);
	const document = plugin.mount_renderer(input.mount);
	if (!document) throw new Error(`Native renderer rejected: ${input.mount.renderer.renderer_id}`);
	return document;
}

export function assertNativeFrontRenderer(
	renderer: RendererDescriptor,
	pluginLock: readonly PluginLockEntry[],
): NativeFrontPluginModule {
	const pluginId = renderer.plugin_id;
	if (!pluginLock.some(({ plugin_id: lockedPluginId }) => lockedPluginId === pluginId)) {
		throw new Error(`Renderer plugin is not locked by the Release: ${pluginId}`);
	}
	const plugin = plugins.get(pluginId);
	if (!plugin || !plugin.renderer_ids.includes(renderer.renderer_id)) {
		throw new Error(`Native renderer is unavailable: ${renderer.renderer_id}`);
	}
	if (plugin.renderer_builds[renderer.renderer_id] !== renderer.build_checksum) {
		throw new Error(`Native renderer build is unavailable: ${renderer.renderer_id}`);
	}
	return plugin;
}
