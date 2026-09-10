import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-gateway";
const file = "retirement-api-gateway.runtime.test.ts";
test("canonical Gateway APIs persist a published route, enforce its rate limit and rotate operator access", async () => {
	await prepareApiPlugin(plugin);
	const id = `proof-${crypto.randomUUID()}`;
	const route = await jsonResult<{ data: { route_id: string; revision: number } }>(
		await apiCommand(plugin, "update_gateway_route", {
			method: "PUT",
			path: `/api/v1/gateway/routes/${id}`,
			body: {
				method: "GET",
				path_pattern: `/${id}`,
				target_path: "/health",
				rate_limit: 1,
				expected_revision: null,
			},
		}),
	);
	expect(route.data.route_id).toBe(id);
	const stored = await pluginDatabase("api")
		.prepare(
			"SELECT route_json,revision FROM gateway_operator_routes WHERE instance_id=? AND route_id=?",
		)
		.bind(env.SUPERBOARD_INSTANCE_ID, id)
		.first<{ route_json: string; revision: number }>();
	expect(JSON.parse(stored!.route_json)).toMatchObject({ target_path: "/health", rate_limit: 1 });
	expect(stored!.revision).toBe(route.data.revision);
	proveApi(plugin, "update_gateway_route", "mutation", file, [id]);
	const routes = await jsonResult<{ data: Array<{ route_id: string }> }>(
		await apiRead(plugin, "gateway_routes", { method: "GET", path: "/api/v1/gateway/routes" }),
	);
	expect(routes.data.some((row) => row.route_id === id)).toBe(true);
	proveApi(plugin, "gateway_routes", "read", file, [id]);
	const published = await jsonResult<{ data: { manifest_id: string; checksum: string } }>(
		await apiCommand(plugin, "publish_gateway_manifest", {
			method: "POST",
			path: "/api/v1/gateway/manifests",
			body: {},
		}),
		201,
	);
	const active = await jsonResult<{
		data: { manifest_id: string; checksum: string; routes: Array<{ route_id: string }> };
	}>(
		await apiRead(plugin, "active_gateway_manifest", {
			method: "GET",
			path: "/api/v1/gateway/active-manifest",
		}),
	);
	expect(active.data.manifest_id).toBe(published.data.manifest_id);
	expect(active.data.checksum).toBe(published.data.checksum);
	expect(active.data.routes.some((row) => row.route_id === id)).toBe(true);
	proveApi(plugin, "publish_gateway_manifest", "mutation", file, [active.data.manifest_id]);
	proveApi(plugin, "active_gateway_manifest", "read", file, [active.data.manifest_id]);
	const invoke = () =>
		SELF.fetch(`https://site.example/api/v1/gateway/invoke/${id}`, {
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
			body: "{}",
		});
	expect(await jsonResult(await invoke())).toMatchObject({ status: "ok" });
	expect((await invoke()).status).toBe(429);
	const limits = await jsonResult<{ data: Array<{ route_id: string; requests: number }> }>(
		await apiRead(plugin, "rate_limits", { method: "GET", path: "/api/v1/gateway/rate-limits" }),
	);
	expect(limits.data.find((row) => row.route_id === id)?.requests).toBeGreaterThanOrEqual(1);
	proveApi(plugin, "rate_limits", "read", file, [id]);
	await jsonResult(
		await apiCommand(plugin, "rotate_access_policy", {
			method: "POST",
			path: "/api/v1/gateway/access-policy",
			body: { allowed_operator_ids: ["another-operator"] },
		}),
	);
	expect((await invoke()).status).toBe(403);
	const policy = await pluginDatabase("api")
		.prepare("SELECT policy_json,version FROM gateway_operator_policies WHERE instance_id=?")
		.bind(env.SUPERBOARD_INSTANCE_ID)
		.first<{ policy_json: string; version: number }>();
	expect(JSON.parse(policy!.policy_json)).toMatchObject({
		allowed_operator_ids: ["another-operator"],
	});
	proveApi(plugin, "rotate_access_policy", "mutation", file, [
		`${env.SUPERBOARD_INSTANCE_ID}:${policy!.version}`,
	]);
});
