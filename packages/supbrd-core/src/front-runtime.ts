import type { DependencyPolicy, FrontRouteManifest } from "./contracts.js";
import { resolveFrontRoute } from "./front-router.js";

export interface LastVerifiedFrontRelease {
	front_route_manifest: FrontRouteManifest;
	dependency_policies: DependencyPolicy[];
}

export interface FrontRequestContext {
	last_verified_release: LastVerifiedFrontRelease | null;
	requested_path: string;
	admin_session: "absent" | "valid";
	application_token_audience?: string;
	permissions: string[];
	dependency_health: Record<string, "ready" | "unavailable">;
}

export type FrontRequestResolution =
	| { result: "maintenance"; route_id: null; state_renderer_id: null }
	| { result: "not_found"; route_id: null; state_renderer_id: null }
	| { result: "redirect"; route_id: string; location: string }
	| {
			result: "forbidden" | "unavailable";
			route_id: string;
			state_renderer_id: string;
	  }
	| {
			result: "rendered";
			route_id: string;
			page_id: string;
			layout_ids: string[];
			renderer_ids: string[];
			parameters: Record<string, string>;
	  };

export function resolveFrontRequest(context: FrontRequestContext): FrontRequestResolution {
	const release = context.last_verified_release;
	if (!release) return { result: "maintenance", route_id: null, state_renderer_id: null };

	const match = resolveFrontRoute(release.front_route_manifest, context.requested_path);
	if (match.result !== "matched") {
		return { result: "not_found", route_id: null, state_renderer_id: null };
	}

	const { route } = match;
	if (route.auth_policy === "anonymous_only" && context.admin_session === "valid") {
		return redirectToTransition(
			release.front_route_manifest,
			release.front_route_manifest.auth_transitions.authenticated_home_route_id,
		);
	}
	if (route.auth_policy === "authenticated" && context.admin_session !== "valid") {
		return redirectToTransition(
			release.front_route_manifest,
			release.front_route_manifest.auth_transitions.login_route_id,
		);
	}

	if (
		route.permission_expression !== "allow" &&
		!context.permissions.includes(route.permission_expression)
	) {
		return {
			result: "forbidden",
			route_id: route.route_id,
			state_renderer_id: route.state_policies.forbidden,
		};
	}

	const policies = new Map(
		release.dependency_policies.map((policy) => [policy.dependency_id, policy]),
	);
	for (const dependencyId of route.dependencies) {
		const policy = policies.get(dependencyId);
		if (policy?.kind === "required" && context.dependency_health[dependencyId] !== "ready") {
			return {
				result: "unavailable",
				route_id: route.route_id,
				state_renderer_id: route.state_policies.unavailable,
			};
		}
	}

	if (!route.page_id) {
		return { result: "not_found", route_id: null, state_renderer_id: null };
	}
	return {
		result: "rendered",
		route_id: route.route_id,
		page_id: route.page_id,
		layout_ids: [...route.layout_ids],
		renderer_ids: [...route.renderer_ids],
		parameters: match.parameters,
	};
}

function redirectToTransition(
	manifest: FrontRouteManifest,
	routeId: string,
): FrontRequestResolution {
	const destination = manifest.routes.find((route) => route.route_id === routeId);
	if (!destination || destination.path_pattern.includes(":")) {
		return { result: "maintenance", route_id: null, state_renderer_id: null };
	}
	return { result: "redirect", route_id: routeId, location: destination.path_pattern };
}
