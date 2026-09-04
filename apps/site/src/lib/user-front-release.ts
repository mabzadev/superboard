import type { NativeFrontPluginModule } from "@superboard/supbrd-core";

import {
	composeFrontReleaseInput,
	type FrontReleaseCompositionInput,
} from "./front-release-composer.js";
import { superBoardRuntimePluginCatalog } from "./superboard-plugin-catalog.js";

export {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
} from "./core-front-contract.js";
export { visibleUserNavigation } from "./front-release-composer.js";

export async function composeUserFrontReleaseInput(
	input: FrontReleaseCompositionInput & {
		native_plugins?: readonly NativeFrontPluginModule[];
	},
) {
	const { native_plugins: nativePluginOverride, ...releaseIdentity } = input;
	const nativePlugins =
		nativePluginOverride ?? (await import("./native-front-plugins.js")).nativeFrontPluginCatalog();
	return composeFrontReleaseInput(
		releaseIdentity,
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => manifest),
		nativePlugins,
	);
}
