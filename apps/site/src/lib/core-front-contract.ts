import {
	REQUIRED_FRONT_STATES,
	sha256Canonical,
	type FrontState,
	type RendererDescriptor,
	type NativeFrontSurfaceContribution,
} from "@superboard/supbrd-core";

const corePlugin = { plugin_id: "supbrd-core", plugin_version: "0.1.0" } as const;

export const CORE_ADMIN_SHELL_RENDERER_ID = "emdash.core.renderer.admin_shell";
export const CORE_OPERATOR_HOME_RENDERER_ID = "emdash.core.renderer.operator_home";
export const CORE_OPERATOR_LOGIN_RENDERER_ID = "emdash.core.renderer.operator_login";
export const CORE_OPERATOR_SURFACES: readonly NativeFrontSurfaceContribution[] = [
	{
		route_id: "emdash.core.operator_home",
		path_pattern: "/superboard-system/home",
		page_id: "page.emdash_operator_home",
		title: "site.operator.home",
		renderer_id: CORE_OPERATOR_HOME_RENDERER_ID,
		audience: "superboard_front",
		auth_policy: "authenticated",
		permission_expression: "allow",
		priority: 200,
		navigation: null,
		transition: "authenticated_home",
	},
	{
		route_id: "emdash.core.operator_login",
		path_pattern: "/_emdash/admin/login",
		page_id: "page.emdash_operator_login",
		title: "site.operator.login",
		renderer_id: CORE_OPERATOR_LOGIN_RENDERER_ID,
		audience: "superboard_front",
		auth_policy: "anonymous_only",
		permission_expression: "allow",
		priority: 200,
		navigation: null,
		transition: "login",
	},
];
export const CORE_STATE_RENDERER_IDS: Record<FrontState, string> = {
	loading: "emdash.core.state.loading",
	empty: "emdash.core.state.empty",
	forbidden: "emdash.core.state.forbidden",
	not_found: "emdash.core.state.not_found",
	error: "emdash.core.state.error",
	unavailable: "emdash.core.state.unavailable",
	maintenance: "emdash.core.state.maintenance",
};

const propsSchemaChecksum = await sha256Canonical({
	type: "object",
	additionalProperties: false,
	properties: {},
});

export const CORE_FRONT_RENDERER_DESCRIPTORS: RendererDescriptor[] = await Promise.all([
	descriptor(CORE_ADMIN_SHELL_RENDERER_ID, "01J00000000000000000000243", ["content"]),
	...REQUIRED_FRONT_STATES.map((state, index) =>
		descriptor(
			CORE_STATE_RENDERER_IDS[state],
			`01J00000000000000000000${String(250 + index).padStart(3, "0")}`,
			[],
		),
	),
	descriptor(CORE_OPERATOR_HOME_RENDERER_ID, "01J00000000000000000000260", []),
	descriptor(CORE_OPERATOR_LOGIN_RENDERER_ID, "01J00000000000000000000261", []),
]);

export const CORE_ADMIN_SHELL_DESCRIPTOR = CORE_FRONT_RENDERER_DESCRIPTORS[0];
export const SUPBRD_CORE_ARTIFACT_CHECKSUM = await sha256Canonical({
	runtime: "superboard.native_front.v1",
	renderers: CORE_FRONT_RENDERER_DESCRIPTORS,
});

async function descriptor(
	rendererId: string,
	buildId: string,
	slots: string[],
): Promise<RendererDescriptor> {
	return {
		renderer_id: rendererId,
		...corePlugin,
		build_id: buildId,
		build_checksum: await sha256Canonical({ renderer_id: rendererId, runtime: "native_front.v1" }),
		abi_version: "1.0.0",
		runtime_range: ">=0.1.0 <0.2.0",
		props_schema: {
			schema_id: `${rendererId}.props.v1`,
			version: "1.0.0",
			checksum: propsSchemaChecksum,
		},
		capabilities: ["renderer.mount"],
		slots,
		supported_states: [...REQUIRED_FRONT_STATES],
	};
}
