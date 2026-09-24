import type { SuperBoardPluginManifest } from "@superboard/supbrd-core";

import { nativeFrontPlugin as dynamicLinks } from "../../../../packages/plugins/superboard-acquisition/src/front-dynamic-links.js";
import { nativeFrontPlugin as flows } from "../../../../packages/plugins/superboard-acquisition/src/front-flows.js";
import { nativeFrontPlugin as onboardings } from "../../../../packages/plugins/superboard-acquisition/src/front-onboardings.js";
import { nativeFrontPlugin as paywalls } from "../../../../packages/plugins/superboard-acquisition/src/front-paywalls.js";
import { nativeFrontPlugin as analytics } from "../../../../packages/plugins/superboard-analytics/src/front-analytics.js";
import { nativeFrontPlugin as user } from "../../../../packages/plugins/superboard-authentification/src/front-user.js";
import {
	userPluginManifest,
	validateUserPluginManifest,
	buildUserPluginManifest,
} from "../../../../packages/plugins/superboard-authentification/src/user.js";
import { nativeFrontPlugin as email } from "../../../../packages/plugins/superboard-communication/src/front-email.js";
import { nativeFrontPlugin as marketing } from "../../../../packages/plugins/superboard-communication/src/front-marketing.js";
import { nativeFrontPlugin as audit } from "../../../../packages/plugins/superboard-core/src/front-audit.js";
import { nativeFrontPlugin as gateway } from "../../../../packages/plugins/superboard-core/src/front-gateway.js";
import { nativeFrontPlugin as mcp } from "../../../../packages/plugins/superboard-core/src/front-mcp.js";
import { nativeFrontPlugin as observability } from "../../../../packages/plugins/superboard-core/src/front-observability.js";
import { nativeFrontPlugin as settings } from "../../../../packages/plugins/superboard-core/src/front-settings.js";
import { nativeFrontPlugin as content } from "../../../../packages/plugins/superboard-data/src/front-content.js";
import { nativeFrontPlugin as files } from "../../../../packages/plugins/superboard-data/src/front-files.js";
import { nativeFrontPlugin as billing } from "../../../../packages/plugins/superboard-monetization/src/front-billing.js";
import { nativeFrontPlugin as products } from "../../../../packages/plugins/superboard-monetization/src/front-products.js";
import { nativeFrontPlugin as support } from "../../../../packages/plugins/superboard-support/src/front-support.js";
import topology from "../../../../scripts/config/emdash-plugin-topology.json";
import {
	composeFrontReleaseInput,
	type FrontReleaseCompositionInput,
} from "./front-release-composer.js";

export { userPluginManifest, validateUserPluginManifest, buildUserPluginManifest };

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
