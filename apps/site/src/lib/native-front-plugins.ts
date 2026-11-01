import type {
	FrontNavigationGroup,
	NativeFrontPluginModule,
	NativeRendererDocument,
	NativeRendererMountInput,
	PluginLockEntry,
	RendererDescriptor,
} from "@superboard/supbrd-core";

import compatibility from "../../../../scripts/config/superboard-plugin-compatibility.json";
import {
	currentComponentId,
	nativeFrontPlugins as plugins,
	resolveLockedNativeFrontPlugin,
	resolveNativeRendererAlias,
} from "./native-front-renderers.js";

const compatibleLegacyBuilds = new Map<string, Set<string>>([
	[
		"superboard-user.renderer.admin_surface",
		new Set(["sha256:d7b1bda9489908a0fc50539a8a305d0c18e8c54f92fac05980ec30af32f28ba2"]),
	],
	[
		"superboard-user.renderer.login_form",
		new Set(["sha256:fb7093abcf297a8b10024c579ec6faeb0336a91e3551e0c397a670ead659d9d9"]),
	],
	[
		"superboard-user.renderer.members_table",
		new Set(["sha256:83e314240c11dfd0118ed0a0d2496e1589513f2c18b199e65e6e791ea430d0cb"]),
	],
	[
		"superboard-user.renderer.profile_card",
		new Set(["sha256:a6ca9335d1dc37ecaabddcce6f5c6add578ec1bdd2b5b637e44b97606825d86d"]),
	],
]);
for (const artifact of Object.values(compatibility.artifacts)) {
	for (const [rendererId, checksum] of Object.entries(artifact.renderer_builds)) {
		const current = currentComponentId(rendererId);
		const builds = compatibleLegacyBuilds.get(current) ?? new Set<string>();
		builds.add(checksum);
		compatibleLegacyBuilds.set(current, builds);
	}
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
	const renderer = resolveNativeRendererAlias(input.mount.renderer);
	const plugin = assertNativeFrontRenderer(renderer, input.plugin_lock);
	const document = plugin.mount_renderer({ ...input.mount, renderer });
	if (!document) throw new Error(`Native renderer rejected: ${input.mount.renderer.renderer_id}`);
	return document;
}

export function assertNativeFrontRenderer(
	requestedRenderer: RendererDescriptor,
	pluginLock: readonly PluginLockEntry[],
): NativeFrontPluginModule {
	const renderer = resolveNativeRendererAlias(requestedRenderer);
	const plugin = resolveLockedNativeFrontPlugin(renderer, pluginLock);
	if (
		plugin.renderer_builds[renderer.renderer_id] !== renderer.build_checksum &&
		!compatibleLegacyBuilds.get(renderer.renderer_id)?.has(renderer.build_checksum)
	) {
		throw new Error(`Native renderer build is unavailable: ${renderer.renderer_id}`);
	}
	return plugin;
}
