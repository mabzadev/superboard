import type { SuperBoardPluginManifest } from "@superboard/supbrd-core";

import {
	composeFrontReleaseInput,
	type FrontReleaseCompositionInput,
} from "../../../../apps/site/src/lib/front-release-composer.js";
import topology from "../../../../config/emdash-plugin-topology.json";
import {
	userPluginManifest,
	validateUserPluginManifest,
} from "../../../supbrd-plug-user/src/index.js";
import { nativeFrontPlugin as user } from "../../../supbrd-plug-user/src/native-front.js";
import { nativeFrontPlugin as audit } from "../front/plugins/supbrd-plug-audit.js";
import { nativeFrontPlugin as content } from "../front/plugins/supbrd-plug-content.js";
import { nativeFrontPlugin as products } from "../front/plugins/supbrd-plug-products.js";
import { nativeFrontPlugin as settings } from "../front/plugins/supbrd-plug-settings.js";
import { nativeFrontPlugin as analytics } from "../front/plugins/supbrd-plugmod-analytics.js";
import { nativeFrontPlugin as billing } from "../front/plugins/supbrd-plugmod-billing.js";
import { nativeFrontPlugin as dynamicLinks } from "../front/plugins/supbrd-plugmod-dynamic-links.js";
import { nativeFrontPlugin as email } from "../front/plugins/supbrd-plugmod-email.js";
import { nativeFrontPlugin as files } from "../front/plugins/supbrd-plugmod-files.js";
import { nativeFrontPlugin as flows } from "../front/plugins/supbrd-plugmod-flows.js";
import { nativeFrontPlugin as gateway } from "../front/plugins/supbrd-plugmod-gateway.js";
import { nativeFrontPlugin as marketing } from "../front/plugins/supbrd-plugmod-marketing.js";
import { nativeFrontPlugin as mcp } from "../front/plugins/supbrd-plugmod-mcp.js";
import { nativeFrontPlugin as observability } from "../front/plugins/supbrd-plugmod-observability.js";
import { nativeFrontPlugin as onboardings } from "../front/plugins/supbrd-plugmod-onboardings.js";
import { nativeFrontPlugin as paywalls } from "../front/plugins/supbrd-plugmod-paywalls.js";
import { nativeFrontPlugin as support } from "../front/plugins/supbrd-plugmod-support.js";

export { userPluginManifest, validateUserPluginManifest };

export const parityFrontPluginCatalog = Object.freeze([
	user,
	settings,
	content,
	products,
	audit,
	gateway,
	billing,
	support,
	flows,
	analytics,
	marketing,
	email,
	dynamicLinks,
	files,
	paywalls,
	onboardings,
	observability,
	mcp,
]);

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generated topology is validated by the parity gate
const typedTopology = topology as unknown as {
	plugins: Array<{ manifest: SuperBoardPluginManifest }>;
};
const parityManifests = typedTopology.plugins
	.filter(({ manifest }) => !manifest.plugin_id.includes("*"))
	.map(({ manifest }) =>
		manifest.plugin_id === userPluginManifest.plugin_id ? userPluginManifest : manifest,
	);

export function parityRuntimePluginCatalog() {
	return parityManifests;
}

export function composeParityFrontReleaseInput(input: FrontReleaseCompositionInput) {
	return composeFrontReleaseInput(input, parityManifests, parityFrontPluginCatalog);
}
