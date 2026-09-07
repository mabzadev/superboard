import type { RoleLevel } from "@emdash-cms/auth";
import type { PublicEndpoints } from "@superboard/front-ui/context";
import {
	assertRendererCompatibility,
	parseFrontNavigation,
	resolveFrontRoute,
	resolveFrontRequest,
	type CompiledFrontRelease,
	type FrontReleasePayload,
	type FrontRequestResolution,
	type NativeFrontOperator,
} from "@superboard/supbrd-core";

import { CORE_FRONT_RENDERER_DESCRIPTORS } from "./core-front-contract.js";
import { assertNativeFrontRenderer } from "./native-front-plugins.js";
import { requireActiveSuperBoardPlugin } from "./plugin-availability.js";
import { probeSuperBoardPluginWorker } from "./plugin-readiness.js";
import { parsePublicEndpoints } from "./public-endpoints.js";
import {
	loadDependencyHealth,
	loadLastVerifiedFrontRelease,
	type LoadedFrontRelease,
} from "./release-source.js";
import type { SuperBoardSiteEnv } from "./site-env.js";
import { resolveSuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

interface EmDashUser {
	id: string;
	email: string;
	name: string | null;
	role: RoleLevel;
	disabled: boolean;
}

export interface FrontPageModel {
	public_endpoints?: PublicEndpoints;
	instance_id: string;
	requested_path: string;
	release: LoadedFrontRelease | null;
	resolution: FrontRequestResolution;
	page_title: string | null;
	operator: NativeFrontOperator | null;
	permissions: string[];
}

export async function resolveSiteFrontPage(
	env: SuperBoardSiteEnv,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	const instanceId = env.SUPERBOARD_INSTANCE_ID;
	const release = await loadLastVerifiedFrontRelease(env, instanceId);
	return resolveFrontPageFromRelease(env, release, requestedPath, user);
}

export async function resolvePreviewFrontPage(
	env: SuperBoardSiteEnv,
	release: CompiledFrontRelease,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	const loaded: LoadedFrontRelease = {
		release,
		runtime_release: {
			front_route_manifest: release.payload.front_route_manifest,
			dependency_policies: release.payload.dependency_policies,
		},
		pointer_revision: 0,
		source: "preview",
	};
	return resolveFrontPageFromRelease(env, loaded, requestedPath, user);
}

async function resolveFrontPageFromRelease(
	env: SuperBoardSiteEnv,
	release: LoadedFrontRelease | null,
	requestedPath: string,
	user: EmDashUser | undefined,
): Promise<FrontPageModel> {
	let dependencyHealth: Record<string, "ready" | "unavailable"> = {};
	if (release) {
		try {
			dependencyHealth = await loadDependencyHealth(
				env.DB,
				env.SUPERBOARD_INSTANCE_ID,
				new Date().toISOString(),
			);
		} catch {
			dependencyHealth = {};
		}
	}
	const permissions = await loadOperatorFrontPermissions(
		env.DB,
		env.SUPERBOARD_INSTANCE_ID,
		release,
		user,
	);
	let resolution = resolveFrontRequest({
		last_verified_release: release?.runtime_release ?? null,
		requested_path: requestedPath,
		admin_session: user ? "valid" : "absent",
		permissions,
		dependency_health: dependencyHealth,
	});
	if (resolution.result === "unavailable" && release && user) {
		const matched = resolveFrontRoute(release.runtime_release.front_route_manifest, requestedPath);
		if (matched.result === "matched") {
			try {
				for (const dependencyId of matched.route.dependencies) {
					if (dependencyHealth[dependencyId] === "ready") continue;
					const plugin = release.release.payload.plugin_lock.find(
						({ plugin_id }) => `dependency.${plugin_id.replaceAll("-", "_")}` === dependencyId,
					);
					if (!plugin) continue;
					const inactive = await requireActiveSuperBoardPlugin(env.DB, {
						instance_id: env.SUPERBOARD_INSTANCE_ID,
						target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
						plugin_id: plugin.plugin_id,
					});
					if (inactive) {
						resolution = { result: "not_found", route_id: null, state_renderer_id: null };
						break;
					}
					await probeSuperBoardPluginWorker(env, plugin.plugin_id, {
						operator_id: user.id,
						instance_id: env.SUPERBOARD_INSTANCE_ID,
						role: user.role,
					});
					dependencyHealth[dependencyId] = "ready";
				}
				if (resolution.result !== "not_found")
					resolution = resolveFrontRequest({
						last_verified_release: release.runtime_release,
						requested_path: requestedPath,
						admin_session: "valid",
						permissions,
						dependency_health: dependencyHealth,
					});
			} catch {
				// An activation receipt does not establish the current availability of its Worker.
			}
		}
	}
	if (release) {
		try {
			assertReleasePresentation(release.release.payload);
		} catch {
			const routeId = "route_id" in resolution ? resolution.route_id : null;
			const route = routeId
				? release.release.payload.front_route_manifest.routes.find(
						({ route_id: candidate }) => candidate === routeId,
					)
				: null;
			resolution = routeId
				? {
						result: "unavailable",
						route_id: routeId,
						state_renderer_id: route?.state_policies.unavailable ?? "emdash.core.state.unavailable",
					}
				: { result: "maintenance", route_id: null, state_renderer_id: null };
		}
	}
	const pageTitle =
		resolution.result === "rendered" && release
			? (release.release.payload.presentation.pages.find(
					(page) => page.page_id === resolution.page_id,
				)?.title ?? null)
			: null;
	const operator = user
		? { id: user.id, email: user.email, name: user.name, role: user.role, disabled: user.disabled }
		: null;
	return {
		public_endpoints: parsePublicEndpoints(env.SUPERBOARD_PUBLIC_ENDPOINTS_JSON),
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		requested_path: requestedPath,
		release,
		resolution,
		page_title: pageTitle,
		operator,
		permissions,
	};
}

export function assertReleasePresentation(payload: FrontReleasePayload): void {
	const renderers = new Map(
		[...CORE_FRONT_RENDERER_DESCRIPTORS, ...payload.renderers].map((renderer) => [
			renderer.renderer_id,
			renderer,
		]),
	);
	const lockedPlugins = new Set(payload.plugin_lock.map(({ plugin_id: pluginId }) => pluginId));
	const pages = new Map(payload.presentation.pages.map((page) => [page.page_id, page]));
	const layouts = new Map(payload.presentation.layouts.map((layout) => [layout.layout_id, layout]));
	const routes = new Map(
		payload.front_route_manifest.routes.map((route) => [route.route_id, route]),
	);
	const assertRenderer = (rendererId: string) => {
		const renderer = renderers.get(rendererId);
		if (!renderer) throw new Error(`Release renderer is missing: ${rendererId}`);
		if (!lockedPlugins.has(renderer.plugin_id)) {
			throw new Error(`Release renderer plugin is not locked: ${renderer.plugin_id}`);
		}
		assertRendererCompatibility(renderer, { abi_version: "1.0.0", runtime_version: "0.1.0" });
		assertNativeFrontRenderer(renderer, payload.plugin_lock);
	};
	for (const route of routes.values()) {
		if (!route.page_id) throw new Error(`Release route has no page: ${route.route_id}`);
		const page = pages.get(route.page_id);
		if (!page) throw new Error(`Release page is missing: ${route.page_id}`);
		if (!route.renderer_ids.includes(page.root_renderer_id)) {
			throw new Error(`Release page renderer is not selected by route: ${route.route_id}`);
		}
		for (const rendererId of route.renderer_ids) assertRenderer(rendererId);
		for (const rendererId of Object.values(route.state_policies)) assertRenderer(rendererId);
		for (const layoutId of route.layout_ids) {
			const layout = layouts.get(layoutId);
			if (!layout) throw new Error(`Release layout is missing: ${layoutId}`);
			assertRenderer(layout.root_renderer_id);
		}
	}
	for (const group of parseFrontNavigation(
		payload.presentation.navigation,
		payload.front_route_manifest.routes,
	)) {
		for (const item of group.items) {
			if (!routes.has(item.route_id)) {
				throw new Error(`Release navigation route is missing: ${item.route_id}`);
			}
			const navigationRoute = resolveFrontRoute(payload.front_route_manifest, item.href);
			if (
				navigationRoute.result !== "matched" ||
				navigationRoute.route.route_id !== item.route_id
			) {
				throw new Error(`Release navigation href is invalid: ${item.route_id}`);
			}
		}
	}
}

async function loadOperatorFrontPermissions(
	db: D1Database,
	instanceId: string,
	release: LoadedFrontRelease | null,
	user: EmDashUser | undefined,
): Promise<string[]> {
	if (!release || !user) return [];
	const declared = [
		...new Set(
			release.release.payload.front_route_manifest.routes
				.map(({ permission_expression: permission }) => permission)
				.filter((permission) => permission !== "allow"),
		),
	];
	try {
		const result = await db
			.prepare(
				`SELECT permission FROM superboard_front_permission_grants
				 WHERE role = ? AND (instance_id = ? OR instance_id = '*')`,
			)
			.bind(user.role, instanceId)
			.all<{ permission: string }>();
		const granted = new Set(result.results.map(({ permission }) => permission));
		return granted.has("*") ? declared : declared.filter((permission) => granted.has(permission));
	} catch {
		return [];
	}
}
