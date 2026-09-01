import { defineNativeFrontPlugin as definePlugin, navigationGroup } from "@superboard/supbrd-core";

import frontBundle from "../../../../config/superboard-front-bundle.json";

export { navigationGroup };

export function defineNativeFrontPlugin(input: Parameters<typeof definePlugin>[0]) {
	const plugin = definePlugin(input);
	return {
		...plugin,
		renderer_builds: Object.fromEntries(
			plugin.renderer_ids.map((rendererId) => [rendererId, frontBundle.build_checksum]),
		),
	};
}
