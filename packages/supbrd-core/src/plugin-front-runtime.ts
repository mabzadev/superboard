import frontBundle from "../../../scripts/config/superboard-front-bundle.json";
import { defineNativeFrontPlugin as definePlugin, navigationGroup } from "./native-front.js";

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
