import { describe, expect, test } from "vitest";

import {
	REQUIRED_FRONT_STATES,
	resolveFrontRoute,
	type FrontRouteDescriptor,
	type FrontRouteManifest,
} from "../src/index.js";

function route(
	routeId: string,
	pathPattern: string,
	parameters: FrontRouteDescriptor["parameters"],
	priority: number,
): FrontRouteDescriptor {
	return {
		route_id: routeId,
		path_pattern: pathPattern,
		route_kind: "page",
		audience: "superboard_front",
		auth_policy: "authenticated",
		permission_expression: "superboard.admin.access",
		priority,
		parameters,
		query: {},
		page_id: `page.${routeId}`,
		layout_ids: ["layout.superboard_admin_shell"],
		renderer_ids: [`renderer.${routeId}`],
		state_policies: Object.fromEntries(
			REQUIRED_FRONT_STATES.map((state) => [state, `emdash.core.state.${state}`]),
		) as FrontRouteDescriptor["state_policies"],
		dependencies: [],
		redirect: null,
	};
}

const manifest: FrontRouteManifest = {
	schema_version: "1.0.0",
	manifest_id: "01J00000000000000000000009",
	route_manifest_checksum: `sha256:${"e".repeat(64)}`,
	normalization: {
		unicode: "NFC",
		case_sensitive: true,
		trailing_slash: "strip",
		percent_decoding: "once",
	},
	auth_transitions: {
		login_route_id: "users.new",
		authenticated_home_route_id: "users.new",
	},
	system_routes: [],
	routes: [
		route("docs.catch_all", "/docs/:rest", { rest: { type: "path", required: true } }, 10),
		route("users.dynamic", "/users/:user_id", { user_id: { type: "integer", required: true } }, 20),
		route("users.new", "/users/new", {}, 1),
	],
};

describe("Front Route Manifest resolver", () => {
	test("uses static, typed dynamic, then bounded catch-all precedence", () => {
		expect(resolveFrontRoute(manifest, "/users/%6Eew/")).toMatchObject({
			result: "matched",
			route_id: "users.new",
			parameters: {},
		});
		expect(resolveFrontRoute(manifest, "/users/42")).toMatchObject({
			result: "matched",
			route_id: "users.dynamic",
			parameters: { user_id: "42" },
		});
		expect(resolveFrontRoute(manifest, "/docs/guides/setup")).toMatchObject({
			result: "matched",
			route_id: "docs.catch_all",
			parameters: { rest: "guides/setup" },
		});
		expect(resolveFrontRoute(manifest, "/users/not-an-integer")).toEqual({
			result: "not_found",
			normalized_path: "/users/not-an-integer",
		});
	});
});
