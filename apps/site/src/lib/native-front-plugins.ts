import type {
	FrontNavigationGroup,
	NativeFrontPluginModule,
	NativeRendererDocument,
	NativeRendererMountInput,
	PluginLockEntry,
	RendererDescriptor,
} from "@superboard/supbrd-core";

import compatibility from "../../../../config/superboard-plugin-compatibility.json";

const discoveredModules = import.meta.glob<{ nativeFrontPlugin: NativeFrontPluginModule }>(
	[
		"../front-plugins/*.ts",
		"../../../../packages/supbrd-plug-user/src/native-front.ts",
		"../../../../packages/supbrd-runtime-plugins/src/front/plugins/*.ts",
	],
	{ eager: true },
);

const plugins = new Map<string, NativeFrontPluginModule>();
const compatibleLegacyBuilds = new Map<string, Set<string>>([
	[
		"supbrd-plug-user.renderer.admin_surface",
		new Set(["sha256:d7b1bda9489908a0fc50539a8a305d0c18e8c54f92fac05980ec30af32f28ba2"]),
	],
	[
		"supbrd-plug-user.renderer.login_form",
		new Set(["sha256:fb7093abcf297a8b10024c579ec6faeb0336a91e3551e0c397a670ead659d9d9"]),
	],
	[
		"supbrd-plug-user.renderer.members_table",
		new Set(["sha256:83e314240c11dfd0118ed0a0d2496e1589513f2c18b199e65e6e791ea430d0cb"]),
	],
	[
		"supbrd-plug-user.renderer.profile_card",
		new Set(["sha256:a6ca9335d1dc37ecaabddcce6f5c6add578ec1bdd2b5b637e44b97606825d86d"]),
	],
]);
for (const artifact of Object.values(compatibility.artifacts)) {
	for (const [rendererId, checksum] of Object.entries(artifact.renderer_builds)) {
		const builds = compatibleLegacyBuilds.get(rendererId) ?? new Set<string>();
		builds.add(checksum);
		compatibleLegacyBuilds.set(rendererId, builds);
	}
}
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

export function groupNativeFrontNavigation(
	groups: readonly FrontNavigationGroup[],
): FrontNavigationGroup[] {
	if (groups.length !== 1 || groups[0]?.group_id !== "legacy") return [...groups];
	const navigationByRoute = new Map(
		[...plugins.values()].flatMap((plugin) =>
			plugin.surfaces.flatMap((surface) =>
				surface.navigation ? [[surface.route_id, surface.navigation] as const] : [],
			),
		),
	);
	const grouped = new Map<string, FrontNavigationGroup>();
	for (const item of groups[0].items) {
		const contribution = navigationByRoute.get(item.route_id);
		if (!contribution) continue;
		const group = grouped.get(contribution.group_id) ?? {
			group_id: contribution.group_id,
			label: contribution.group_label,
			order: contribution.group_order,
			items: [],
		};
		group.items.push({
			...item,
			label: contribution.item_label,
			order: contribution.item_order,
			href: contribution.item_href ?? item.href,
		});
		grouped.set(group.group_id, group);
	}
	return Array.from(grouped.values(), (group) => ({
		...group,
		items: group.items.toSorted(
			(left, right) => left.order - right.order || left.route_id.localeCompare(right.route_id),
		),
	})).toSorted(
		(left, right) => left.order - right.order || left.group_id.localeCompare(right.group_id),
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
	if (
		plugin.renderer_builds[renderer.renderer_id] !== renderer.build_checksum &&
		!compatibleLegacyBuilds.get(renderer.renderer_id)?.has(renderer.build_checksum)
	) {
		throw new Error(`Native renderer build is unavailable: ${renderer.renderer_id}`);
	}
	return plugin;
}
