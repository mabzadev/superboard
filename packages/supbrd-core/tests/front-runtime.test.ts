import { describe, expect, test } from "vitest";

import {
	REQUIRED_FRONT_STATES,
	resolveFrontRequest,
	type DependencyPolicy,
	type FrontRouteDescriptor,
	type FrontRouteManifest,
} from "../src/index.js";

function statePolicies(): FrontRouteDescriptor["state_policies"] {
	return Object.fromEntries(
		REQUIRED_FRONT_STATES.map((state) => [state, `emdash.core.state.${state}`]),
	) as FrontRouteDescriptor["state_policies"];
}

function pageRoute(
	routeId: string,
	pathPattern: string,
	authPolicy: FrontRouteDescriptor["auth_policy"],
	permissionExpression: string,
	dependencies: string[] = [],
): FrontRouteDescriptor {
	return {
		route_id: routeId,
		path_pattern: pathPattern,
		route_kind: "page",
		audience: "superboard_front",
		auth_policy: authPolicy,
		permission_expression: permissionExpression,
		priority: 100,
		parameters: {},
		query: {},
		page_id: `page.${routeId}`,
		layout_ids: ["layout.superboard"],
		renderer_ids: [`renderer.${routeId}`],
		state_policies: statePolicies(),
		dependencies,
		redirect: null,
	};
}

const login = pageRoute("superboard.login", "/login", "anonymous_only", "allow");
const home = pageRoute(
	"superboard.admin.home",
	"/app",
	"authenticated",
	"superboard.admin.access",
	["dependency.analytics"],
);
const manifest: FrontRouteManifest = {
	schema_version: "1.0.0",
	manifest_id: "01J00000000000000000000010",
	route_manifest_checksum: `sha256:${"f".repeat(64)}`,
	normalization: {
		unicode: "NFC",
		case_sensitive: true,
		trailing_slash: "strip",
		percent_decoding: "once",
	},
	auth_transitions: {
		login_route_id: login.route_id,
		authenticated_home_route_id: home.route_id,
	},
	system_routes: [],
	routes: [login, home],
};
const dependencyPolicies: DependencyPolicy[] = [
	{
		dependency_id: "dependency.analytics",
		kind: "required",
		minimum_version: "1.0.0",
		activation_policy: "ready",
		runtime_failure_policy: "unavailable",
		fallback_dependency_id: null,
	},
];

describe("Front SuperBoard runtime", () => {
	test("fails closed across release, session, permission, and dependency states", () => {
		expect(
			resolveFrontRequest({
				last_verified_release: null,
				requested_path: "/app",
				admin_session: "absent",
				permissions: [],
				dependency_health: {},
			}),
		).toEqual({ result: "maintenance", route_id: null, state_renderer_id: null });

		const release = { front_route_manifest: manifest, dependency_policies: dependencyPolicies };
		expect(
			resolveFrontRequest({
				last_verified_release: release,
				requested_path: "/app",
				admin_session: "absent",
				application_token_audience: "superboard_api",
				permissions: ["superboard.admin.access"],
				dependency_health: { "dependency.analytics": "ready" },
			}),
		).toMatchObject({ result: "redirect", location: "/login" });
		expect(
			resolveFrontRequest({
				last_verified_release: release,
				requested_path: "/app",
				admin_session: "valid",
				permissions: [],
				dependency_health: { "dependency.analytics": "ready" },
			}),
		).toMatchObject({
			result: "forbidden",
			route_id: home.route_id,
			state_renderer_id: "emdash.core.state.forbidden",
		});
		expect(
			resolveFrontRequest({
				last_verified_release: release,
				requested_path: "/app",
				admin_session: "valid",
				permissions: ["superboard.admin.access"],
				dependency_health: { "dependency.analytics": "unavailable" },
			}),
		).toMatchObject({
			result: "unavailable",
			route_id: home.route_id,
			state_renderer_id: "emdash.core.state.unavailable",
		});
	});
});
