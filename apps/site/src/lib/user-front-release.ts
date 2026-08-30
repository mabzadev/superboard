import { REQUIRED_FRONT_STATES, sha256Canonical } from "@superboard/supbrd-core";
import type { FrontReleaseInput, FrontState, RendererDescriptor } from "@superboard/supbrd-core";
import { USER_RENDERER_IDS } from "@superboard/supbrd-plug-user";

import parityMatrixJson from "../../../../config/emdash-parity-matrix.json";
import { superBoardRuntimePluginCatalog } from "./superboard-plugin-catalog.js";
import { USER_FRONT_CATALOGS } from "./user-front-i18n.js";

interface DashboardParityRow {
	id: string;
	kind: string;
	target: string;
	required: boolean;
	source_status: "delivered" | "unvalidated";
}

const dashboardParityRows = (parityMatrixJson.rows as DashboardParityRow[]).filter(
	({ kind }) => kind === "dashboard",
);

const ANONYMOUS_PATHS = new Set([
	"/accept-invite",
	"/login",
	"/new_password",
	"/register",
	"/register/with_email",
	"/reset_password",
]);

export const CORE_ADMIN_SHELL_BUILD_CHECKSUM =
	"sha256:3e842d3076f09509f8c0e48d4f4e05cd96eefce45e394287d79e0def502afc1b";
export const SUPBRD_CORE_ARTIFACT_CHECKSUM =
	"sha256:f7763053608b50525a66bfe0cb02355aa6b9093976c1a5368cd9e19c2806701a";

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
	plugin_lock: FrontReleaseInput["plugin_lock"];
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
	const catalog = superBoardRuntimePluginCatalog();
	const rendererRegistry = new Map<string, RendererDescriptor>();
	for (const { manifest } of catalog.plugins) {
		for (const renderer of manifest.renderers) rendererRegistry.set(renderer.renderer_id, renderer);
	}
	const routeSpecs = new Map<string, { path: string; target: string; title: string }>();
	for (const row of dashboardParityRows) {
		const path = dashboardPath(row.id);
		routeSpecs.set(path, { path, target: row.target, title: surfaceTitle(path) });
	}
	for (const special of [
		{ path: "/app", target: "supbrd-plugmod-analytics", title: "SuperBoard" },
		{ path: "/app/profile", target: "supbrd-plug-user", title: "Profile" },
	] as const) {
		routeSpecs.set(special.path, special);
	}
	const routes = [...routeSpecs.values()]
		.toSorted((left, right) => left.path.localeCompare(right.path))
		.map((spec) => {
			const rendererId = rendererForSurface(spec.path, spec.target);
			if (!rendererRegistry.has(rendererId)) {
				throw new Error(`Renderer ${rendererId} is not registered for ${spec.path}`);
			}
			const anonymous = ANONYMOUS_PATHS.has(spec.path);
			const parameters = Object.fromEntries(
				[...spec.path.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)].map(([, name]) => [
					name!,
					{ type: "string" as const, required: true },
				]),
			);
			return {
				route_id: routeIdForPath(spec.path),
				path_pattern: spec.path,
				route_kind: "page" as const,
				audience: "superboard_front" as const,
				auth_policy: anonymous ? ("anonymous_only" as const) : ("authenticated" as const),
				permission_expression: anonymous ? "allow" : permissionForPlugin(spec.target),
				priority: spec.path.includes(":") ? 100 : 200,
				parameters,
				query: {},
				page_id: pageIdForPath(spec.path),
				layout_ids: anonymous ? [] : ["layout.superboard_admin"],
				renderer_ids: [rendererId],
				state_policies: statePolicies,
				dependencies: [`dependency.${spec.target.replaceAll("-", "_")}`],
				redirect: null,
			};
		});
	const pages = [...routeSpecs.values()]
		.toSorted((left, right) => left.path.localeCompare(right.path))
		.map((spec) =>
			page(pageIdForPath(spec.path), spec.title, rendererForSurface(spec.path, spec.target)),
		);
	const navigation = [...routeSpecs.values()]
		.filter(({ path }) => !ANONYMOUS_PATHS.has(path) && !path.includes(":"))
		.toSorted((left, right) => left.path.localeCompare(right.path))
		.map((spec) => ({
			route_id: routeIdForPath(spec.path),
			label: spec.title,
			permission: permissionForPlugin(spec.target),
		}));
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
			routes,
		},
		gateway_manifest: {
			schema_version: "1.0.0",
			gateway_manifest_id: "01J00000000000000000000221",
			routes: [],
		},
		presentation: {
			pages,
			layouts: [
				{
					layout_id: "layout.superboard_admin",
					root_renderer_id: CORE_ADMIN_SHELL_DESCRIPTOR.renderer_id,
				},
			],
			navigation,
			translations: Object.entries(USER_FRONT_CATALOGS).map(([locale, messages]) => ({
				locale,
				messages,
			})),
			media: [],
			theme: { theme_id: "theme.superboard", tokens: {} },
		},
		renderers: [...rendererRegistry.values()].toSorted((left, right) =>
			left.renderer_id.localeCompare(right.renderer_id),
		),
		plugin_lock: [
			{
				plugin_id: "supbrd-core",
				version: "0.1.0",
				artifact_checksum: SUPBRD_CORE_ARTIFACT_CHECKSUM,
				native: true,
			},
			...input.plugin_lock
				.filter(({ plugin_id: pluginId }) => pluginId !== "supbrd-core")
				.toSorted((left, right) => left.plugin_id.localeCompare(right.plugin_id)),
		],
		dependency_policies: input.plugin_lock.map(({ plugin_id: pluginId, version }) => ({
			dependency_id: `dependency.${pluginId.replaceAll("-", "_")}`,
			kind: "required" as const,
			minimum_version: version,
			activation_policy: "ready" as const,
			runtime_failure_policy: "unavailable" as const,
			fallback_dependency_id: null,
		})),
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

function dashboardPath(requirementId: string): string {
	return requirementId
		.slice("dashboard:".length)
		.replaceAll(/\[\.\.\.([^\]]+)\]/gu, "*$1")
		.replaceAll(/\[([^\]]+)\]/gu, ":$1");
}

function routeIdForPath(path: string): string {
	const fixed = {
		"/login": "superboard.login",
		"/app": "superboard.app_shell",
		"/app/profile": "superboard.profile",
		"/app/users": "superboard.users",
	} as Record<string, string>;
	return fixed[path] ?? `superboard.${surfaceName(path)}`;
}

function pageIdForPath(path: string): string {
	const fixed = {
		"/login": "page.superboard_login",
		"/app": "page.superboard_app",
		"/app/profile": "page.superboard_profile",
		"/app/users": "page.superboard_users",
	} as Record<string, string>;
	return fixed[path] ?? `page.superboard_${surfaceName(path)}`;
}

function rendererForSurface(path: string, pluginId: string): string {
	if (path === "/login") return USER_RENDERER_IDS.login;
	if (path === "/app/profile") return USER_RENDERER_IDS.profile;
	if (path === "/app/users") return USER_RENDERER_IDS.members;
	if (pluginId === "supbrd-plug-user") return USER_RENDERER_IDS.admin;
	return `${pluginId}.renderer.admin_surface`;
}

function permissionForPlugin(pluginId: string): string {
	return pluginId === "supbrd-plug-user" ? "users.read" : `${pluginId}.read`;
}

function surfaceName(path: string): string {
	if (path === "/") return "home";
	return path
		.slice(1)
		.replaceAll(/[:*]/gu, "by_")
		.replaceAll(/[^a-zA-Z0-9]+/gu, "_")
		.replaceAll(/^_+|_+$/gu, "")
		.toLowerCase();
}

function surfaceTitle(path: string): string {
	if (path === "/") return "SuperBoard";
	return path
		.split("/")
		.filter(Boolean)
		.filter((segment) => !segment.startsWith(":") && !segment.startsWith("*"))
		.map((segment) =>
			segment
				.split("-")
				.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
				.join(" "),
		)
		.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
