import {
	REQUIRED_FRONT_STATES,
	parseFrontNavigation,
	type FrontReleaseInput,
	type FrontState,
	type NativeFrontPluginModule,
	type RendererDescriptor,
} from "@superboard/supbrd-core";

import {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_STATE_RENDERER_IDS,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
} from "./core-front-contract.js";
import { nativeFrontPluginCatalog } from "./native-front-plugins.js";
import { superBoardRuntimePluginCatalog } from "./superboard-plugin-catalog.js";
import { USER_FRONT_CATALOGS } from "./user-front-i18n.js";

export {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
} from "./core-front-contract.js";

const ADMIN_LAYOUT_ID = "layout.superboard_admin";

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
	const statePolicies = Object.fromEntries(
		REQUIRED_FRONT_STATES.map((state) => [state, CORE_STATE_RENDERER_IDS[state]]),
	) as Record<FrontState, string>;
	const manifests = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	const nativePlugins = new Map(
		nativeFrontPluginCatalog().map((plugin) => [plugin.plugin_id, plugin]),
	);
	const activePlugins = input.plugin_lock
		.filter(({ plugin_id: pluginId }) => pluginId !== "supbrd-core")
		.toSorted((left, right) => left.plugin_id.localeCompare(right.plugin_id))
		.map((lock) => {
			const manifest = manifests.get(lock.plugin_id);
			if (
				!manifest ||
				manifest.plugin_version !== lock.version ||
				manifest.artifact_checksum !== lock.artifact_checksum
			) {
				throw new Error(`PLUGIN_LOCK_MANIFEST_MISMATCH:${lock.plugin_id}`);
			}
			const nativePlugin = nativePlugins.get(lock.plugin_id);
			if (!nativePlugin) throw new Error(`NATIVE_FRONT_PLUGIN_MISSING:${lock.plugin_id}`);
			assertPluginRenderers(nativePlugin, manifest.renderers);
			return { lock, manifest, nativePlugin };
		});
	const surfaces = activePlugins.flatMap(({ nativePlugin }) => nativePlugin.surfaces);
	const login = selectTransition(surfaces, "login");
	const authenticatedHome = selectTransition(surfaces, "authenticated_home");
	if (!login) throw new Error("FRONT_LOGIN_ROUTE_MISSING");
	if (!authenticatedHome) throw new Error("FRONT_AUTHENTICATED_HOME_ROUTE_MISSING");
	const routes = surfaces
		.toSorted((left, right) => left.path_pattern.localeCompare(right.path_pattern))
		.map((surface) => ({
			route_id: surface.route_id,
			path_pattern: surface.path_pattern,
			route_kind: "page" as const,
			audience: surface.audience,
			auth_policy: surface.auth_policy,
			permission_expression: surface.permission_expression,
			priority: surface.priority,
			parameters: routeParameters(surface.path_pattern),
			query: {},
			page_id: surface.page_id,
			layout_ids: surface.auth_policy === "anonymous_only" ? [] : [ADMIN_LAYOUT_ID],
			renderer_ids: [surface.renderer_id],
			state_policies: statePolicies,
			dependencies: [
				`dependency.${pluginIdForRenderer(surface.renderer_id, activePlugins).replaceAll("-", "_")}`,
			],
			redirect: null,
		}));
	const navigation = composeNavigation(surfaces);
	const renderers = new Map<string, RendererDescriptor>();
	for (const renderer of CORE_FRONT_RENDERER_DESCRIPTORS) {
		renderers.set(renderer.renderer_id, renderer);
	}
	for (const { manifest } of activePlugins) {
		for (const renderer of manifest.renderers) renderers.set(renderer.renderer_id, renderer);
	}

	return {
		schema_version: "1.0.0",
		compiler_version: "0.1.0",
		...input,
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
				login_route_id: login.route_id,
				authenticated_home_route_id: authenticatedHome.route_id,
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
			pages: surfaces
				.map(({ page_id, title, renderer_id }) => ({
					page_id,
					title,
					root_renderer_id: renderer_id,
				}))
				.toSorted((left, right) => left.page_id.localeCompare(right.page_id)),
			layouts: [
				{
					layout_id: ADMIN_LAYOUT_ID,
					root_renderer_id: CORE_ADMIN_SHELL_DESCRIPTOR.renderer_id,
				},
			],
			navigation,
			translations: Object.entries(USER_FRONT_CATALOGS).map(([locale, messages]) => ({
				locale,
				messages,
			})),
			media: [],
			theme: {
				theme_id: "theme.superboard",
				tokens: {
					accent: "#2f81f7",
					background: "#070b14",
					foreground: "#f4f7fb",
					panel: "#0d1524",
				},
			},
		},
		renderers: [...renderers.values()].toSorted((left, right) =>
			left.renderer_id.localeCompare(right.renderer_id),
		),
		plugin_lock: [
			{
				plugin_id: "supbrd-core",
				version: "0.1.0",
				artifact_checksum: SUPBRD_CORE_ARTIFACT_CHECKSUM,
				native: true,
			},
			...activePlugins.map(({ lock }) => lock),
		],
		dependency_policies: activePlugins.map(({ lock }) => ({
			dependency_id: `dependency.${lock.plugin_id.replaceAll("-", "_")}`,
			kind: "required" as const,
			minimum_version: lock.version,
			activation_policy: "ready" as const,
			runtime_failure_policy: "unavailable" as const,
			fallback_dependency_id: null,
		})),
		rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] },
		core_concrete_pages: [],
	};
}

export function visibleUserNavigation(input: FrontReleaseInput, permissions: readonly string[]) {
	const routes = new Set(input.front_route_manifest.routes.map(({ route_id }) => route_id));
	return parseFrontNavigation(
		input.presentation.navigation,
		input.front_route_manifest.routes,
	).flatMap((group) =>
		group.items.flatMap((item) =>
			routes.has(item.route_id) &&
			(item.permission === "allow" || permissions.includes(item.permission))
				? [{ route_id: item.route_id, label: item.label }]
				: [],
		),
	);
}

function composeNavigation(surfaces: readonly NativeFrontPluginModule["surfaces"][number][]) {
	const groups = new Map<
		string,
		{
			group_id: string;
			label: string;
			order: number;
			items: { route_id: string; label: string; permission: string; order: number; href: string }[];
		}
	>();
	for (const surface of surfaces) {
		if (!surface.navigation) continue;
		const contribution = surface.navigation;
		const group = groups.get(contribution.group_id) ?? {
			group_id: contribution.group_id,
			label: contribution.group_label,
			order: contribution.group_order,
			items: [],
		};
		if (group.label !== contribution.group_label || group.order !== contribution.group_order) {
			throw new Error(`NAVIGATION_GROUP_CONFLICT:${contribution.group_id}`);
		}
		group.items.push({
			route_id: surface.route_id,
			label: contribution.item_label,
			permission: surface.permission_expression,
			order: contribution.item_order,
			href: contribution.item_href ?? surface.path_pattern,
		});
		groups.set(group.group_id, group);
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			items: group.items.toSorted(
				(left, right) => left.order - right.order || left.route_id.localeCompare(right.route_id),
			),
		}))
		.toSorted(
			(left, right) => left.order - right.order || left.group_id.localeCompare(right.group_id),
		);
}

function routeParameters(path: string) {
	return Object.fromEntries(
		[...path.matchAll(/(?:^|\/)(?::|\*)([A-Za-z][A-Za-z0-9_]*)/gu)].map(([token, name]) => [
			name!,
			{ type: token.includes("*") ? ("path" as const) : ("string" as const), required: true },
		]),
	);
}

function selectTransition(
	surfaces: readonly NativeFrontPluginModule["surfaces"][number][],
	transition: NonNullable<NativeFrontPluginModule["surfaces"][number]["transition"]>,
) {
	return surfaces
		.filter((surface) => surface.transition === transition)
		.toSorted(
			(left, right) =>
				left.path_pattern.length - right.path_pattern.length ||
				left.path_pattern.localeCompare(right.path_pattern),
		)[0];
}

function assertPluginRenderers(
	plugin: NativeFrontPluginModule,
	descriptors: readonly RendererDescriptor[],
) {
	const declared = new Set(descriptors.map(({ renderer_id }) => renderer_id));
	const descriptorsById = new Map(
		descriptors.map((descriptor) => [descriptor.renderer_id, descriptor]),
	);
	for (const rendererId of plugin.renderer_ids) {
		if (!declared.has(rendererId)) {
			throw new Error(`NATIVE_RENDERER_NOT_DECLARED:${rendererId}`);
		}
		if (plugin.renderer_builds[rendererId] !== descriptorsById.get(rendererId)?.build_checksum) {
			throw new Error(`NATIVE_RENDERER_BUILD_MISMATCH:${rendererId}`);
		}
	}
	for (const surface of plugin.surfaces) {
		if (!plugin.renderer_ids.includes(surface.renderer_id)) {
			throw new Error(`SURFACE_RENDERER_NOT_EXECUTABLE:${surface.renderer_id}`);
		}
	}
}

function pluginIdForRenderer(
	rendererId: string,
	plugins: readonly { nativePlugin: NativeFrontPluginModule }[],
): string {
	const plugin = plugins.find(({ nativePlugin }) => nativePlugin.renderer_ids.includes(rendererId));
	if (!plugin) throw new Error(`NATIVE_RENDERER_PLUGIN_MISSING:${rendererId}`);
	return plugin.nativePlugin.plugin_id;
}
