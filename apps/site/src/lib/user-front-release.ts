import { REQUIRED_FRONT_STATES, sha256Canonical } from "@superboard/supbrd-core";
import type { FrontReleaseInput, FrontState, RendererDescriptor } from "@superboard/supbrd-core";
import { USER_RENDERER_IDS, userPluginManifest } from "@superboard/supbrd-plug-user";

import { USER_FRONT_CATALOGS } from "./user-front-i18n.js";

export const CORE_ADMIN_SHELL_BUILD_CHECKSUM =
	"sha256:2a4948fa1c9ccfb2e9488a1e9ade131e6775f8a5f0eb773d45a9cc44b5dd6ffd";
export const SUPBRD_CORE_ARTIFACT_CHECKSUM =
	"sha256:1a0533cd2668a54fb7969ded48701f1b9b2021e87c95a2fee946f5944261c768";

export const CORE_ADMIN_SHELL_DESCRIPTOR: RendererDescriptor = {
	renderer_id: "emdash.core.renderer.admin_shell",
	plugin_id: "supbrd-core",
	plugin_version: "0.1.0",
	build_id: "01J00000000000000000000243",
	build_checksum: CORE_ADMIN_SHELL_BUILD_CHECKSUM,
	abi_version: "1.0.0",
	runtime_range: ">=0.1.0 <0.2.0",
	props_schema: {
		schema_id: "emdash.core.schema.admin_shell_props.v1",
		version: "1.0.0",
		checksum: await sha256Canonical({
			type: "object",
			additionalProperties: false,
			properties: {},
		}),
	},
	capabilities: ["renderer.mount"],
	slots: ["content"],
	supported_states: [...REQUIRED_FRONT_STATES],
};

export async function composeUserFrontReleaseInput(input: {
	instance_id: string;
	front_draft_id: string;
	draft_snapshot_id: string;
	compilation_id: string;
	candidate_id: string;
	release_id: string;
	release_sequence: number;
	previous_release_id: string | null;
	created_at: string;
}): Promise<FrontReleaseInput> {
	const statePolicies: Record<FrontState, string> = {
		loading: "emdash.core.state.loading",
		empty: "emdash.core.state.empty",
		forbidden: "emdash.core.state.forbidden",
		not_found: "emdash.core.state.not_found",
		error: "emdash.core.state.error",
		unavailable: "emdash.core.state.unavailable",
		maintenance: "emdash.core.state.maintenance",
	};
	const route = (
		routeId: string,
		path: string,
		pageId: string,
		rendererIds: string[],
		authPolicy: "anonymous_only" | "authenticated",
		permission: string,
	) => ({
		route_id: routeId,
		path_pattern: path,
		route_kind: "page" as const,
		audience: "superboard_front" as const,
		auth_policy: authPolicy,
		permission_expression: permission,
		priority: 100,
		parameters: {},
		query: {},
		page_id: pageId,
		layout_ids: authPolicy === "authenticated" ? ["layout.superboard_admin"] : [],
		renderer_ids: rendererIds,
		state_policies: statePolicies,
		dependencies: ["dependency.supbrd_plug_user"],
		redirect: null,
	});
	return {
		schema_version: "1.0.0",
		compiler_version: "0.1.0",
		...input,
		release_sequence: input.release_sequence,
		previous_release_id: input.previous_release_id,
		front_route_manifest: {
			schema_version: "1.0.0",
			manifest_id: "01J00000000000000000000220",
			normalization: {
				unicode: "NFC",
				case_sensitive: true,
				trailing_slash: "strip",
				percent_decoding: "once",
			},
			auth_transitions: {
				login_route_id: "superboard.login",
				authenticated_home_route_id: "superboard.app_shell",
			},
			system_routes: [],
			routes: [
				route(
					"superboard.login",
					"/login",
					"page.superboard_login",
					[USER_RENDERER_IDS.login],
					"anonymous_only",
					"allow",
				),
				route("superboard.app_shell", "/app", "page.superboard_app", [], "authenticated", "allow"),
				route(
					"superboard.profile",
					"/app/profile",
					"page.superboard_profile",
					[USER_RENDERER_IDS.profile],
					"authenticated",
					"users.read",
				),
				route(
					"superboard.users",
					"/app/users",
					"page.superboard_users",
					[USER_RENDERER_IDS.members],
					"authenticated",
					"users.read",
				),
			],
		},
		gateway_manifest: {
			schema_version: "1.0.0",
			gateway_manifest_id: "01J00000000000000000000221",
			routes: [],
		},
		presentation: {
			pages: [
				page("page.superboard_login", "user.page.sign_in", USER_RENDERER_IDS.login),
				page("page.superboard_app", "SuperBoard", CORE_ADMIN_SHELL_DESCRIPTOR.renderer_id),
				page("page.superboard_profile", "user.page.profile", USER_RENDERER_IDS.profile),
				page("page.superboard_users", "user.page.users", USER_RENDERER_IDS.members),
			],
			layouts: [
				{
					layout_id: "layout.superboard_admin",
					root_renderer_id: CORE_ADMIN_SHELL_DESCRIPTOR.renderer_id,
				},
			],
			navigation: [
				{ route_id: "superboard.profile", label: "user.page.profile", permission: "users.read" },
				{ route_id: "superboard.users", label: "user.page.users", permission: "users.read" },
			],
			translations: Object.entries(USER_FRONT_CATALOGS).map(([locale, messages]) => ({
				locale,
				messages,
			})),
			media: [],
			theme: { theme_id: "theme.superboard", tokens: {} },
		},
		renderers: userPluginManifest.renderers,
		plugin_lock: [
			{
				plugin_id: "supbrd-core",
				version: "0.1.0",
				artifact_checksum: SUPBRD_CORE_ARTIFACT_CHECKSUM,
				native: true,
			},
			{
				plugin_id: userPluginManifest.plugin_id,
				version: userPluginManifest.plugin_version,
				artifact_checksum: userPluginManifest.artifact_checksum,
				native: false,
			},
		],
		dependency_policies: [
			{
				dependency_id: "dependency.supbrd_plug_user",
				kind: "required",
				minimum_version: userPluginManifest.plugin_version,
				activation_policy: "ready",
				runtime_failure_policy: "unavailable",
				fallback_dependency_id: null,
			},
		],
		rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] },
		core_concrete_pages: [],
	};
}

export function visibleUserNavigation(input: FrontReleaseInput, permissions: readonly string[]) {
	const routeIds = new Set(input.front_route_manifest.routes.map(({ route_id }) => route_id));
	return input.presentation.navigation.flatMap((entry) =>
		isRecord(entry) &&
		typeof entry.route_id === "string" &&
		typeof entry.label === "string" &&
		typeof entry.permission === "string" &&
		routeIds.has(entry.route_id) &&
		permissions.includes(entry.permission)
			? [{ route_id: entry.route_id, label: entry.label }]
			: [],
	);
}

function page(pageId: string, title: string, rootRendererId: string) {
	return { page_id: pageId, title, root_renderer_id: rootRendererId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
