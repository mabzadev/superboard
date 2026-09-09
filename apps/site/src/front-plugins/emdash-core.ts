import {
	REQUIRED_FRONT_STATES,
	type FrontState,
	type NativeFrontPluginModule,
} from "@superboard/supbrd-core";

import {
	CORE_ADMIN_SHELL_RENDERER_ID,
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_STATE_RENDERER_IDS,
	CORE_OPERATOR_HOME_RENDERER_ID,
	CORE_OPERATOR_LOGIN_RENDERER_ID,
} from "../lib/core-front-contract.js";

const stateCopy: Record<FrontState, { title: string; description: string }> = {
	loading: { title: "site.front.loading", description: "site.front.loading_description" },
	empty: { title: "site.front.empty", description: "site.front.empty_description" },
	forbidden: {
		title: "site.front.forbidden",
		description: "site.front.forbidden_description",
	},
	not_found: {
		title: "site.front.not_found",
		description: "site.front.not_found_description",
	},
	error: {
		title: "site.front.error",
		description: "site.front.error_description",
	},
	unavailable: {
		title: "site.front.dependency_unavailable",
		description: "site.front.dependency_unavailable_description",
	},
	maintenance: {
		title: "site.front.unavailable",
		description: "site.front.unavailable_description",
	},
};
const stateByRenderer = new Map(
	REQUIRED_FRONT_STATES.map((state) => [CORE_STATE_RENDERER_IDS[state], state] as const),
);

export const nativeFrontPlugin: NativeFrontPluginModule = {
	plugin_id: "supbrd-core",
	renderer_ids: CORE_FRONT_RENDERER_DESCRIPTORS.map(({ renderer_id }) => renderer_id),
	renderer_builds: Object.fromEntries(
		CORE_FRONT_RENDERER_DESCRIPTORS.map(({ renderer_id: rendererId, build_checksum: checksum }) => [
			rendererId,
			checksum,
		]),
	),
	surfaces: [],
	mount_renderer(input) {
		if (
			input.renderer.renderer_id === CORE_OPERATOR_HOME_RENDERER_ID ||
			input.renderer.renderer_id === CORE_OPERATOR_LOGIN_RENDERER_ID
		) {
			const home = input.renderer.renderer_id === CORE_OPERATOR_HOME_RENDERER_ID;
			return {
				kind: "surface",
				eyebrow: "site.front.title",
				title: home ? "site.operator.home" : "site.operator.login",
				description: home ? "site.operator.home_description" : "site.operator.login_description",
				actions: [
					{
						label: "site.admin.open",
						href: home ? "/_emdash/admin/plugins-manager" : "/_emdash/admin/login",
					},
				],
				blocks: [],
				details: [],
			};
		}
		if (input.renderer.renderer_id === CORE_ADMIN_SHELL_RENDERER_ID) {
			return {
				kind: "layout",
				title: "site.front.title",
				description: "site.front.description",
				home_href: "/superboard-system/home",
				navigation_label: "site.front.navigation",
				actions: [{ label: "site.admin.open", href: "/_emdash/admin" }],
			};
		}
		const state = stateByRenderer.get(input.renderer.renderer_id);
		if (!state) return null;
		return { kind: "state", state, ...stateCopy[state] };
	},
};
