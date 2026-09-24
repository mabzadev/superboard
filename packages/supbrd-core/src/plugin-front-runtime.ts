import frontBundle from "../../../scripts/config/superboard-front-bundle.json";
import { canonicalFrontHref, canonicalFrontPath } from "../../contracts/src/front-paths.js";
import { defineNativeFrontPlugin as definePlugin, navigationGroup } from "./native-front.js";

export { navigationGroup };

export function defineNativeFrontPlugin(input: Parameters<typeof definePlugin>[0]) {
	const plugin = definePlugin(input);
	const surfaces = new Map<string, (typeof plugin.surfaces)[number]>();
	for (const surface of plugin.surfaces.toSorted(
		(left, right) =>
			Number(canonicalFrontPath(left.path_pattern) !== left.path_pattern) -
			Number(canonicalFrontPath(right.path_pattern) !== right.path_pattern),
	)) {
		const path = canonicalFrontPath(surface.path_pattern);
		if (surfaces.has(path)) continue;
		surfaces.set(path, {
			...surface,
			path_pattern: path,
			navigation: surface.navigation
				? {
						...surface.navigation,
						item_href: surface.navigation.item_href
							? canonicalFrontHref(surface.navigation.item_href)
							: null,
					}
				: null,
		});
	}
	return {
		...plugin,
		surfaces: [...surfaces.values()],
		renderer_builds: Object.fromEntries(
			plugin.renderer_ids.map((rendererId) => [rendererId, frontBundle.build_checksum]),
		),
	};
}
