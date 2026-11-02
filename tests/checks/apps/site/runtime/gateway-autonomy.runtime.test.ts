import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import { parseRouteManifest } from "@superboard/contracts/route-manifest";
import { env } from "cloudflare:test";
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import api from "../../../../../packages/plugins/superboard-core/api/src/index.js";
import {
	apiCommand,
	apiHeaders,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";

const headers = {
	"X-Parity-Operator": "1",
	"X-EmDash-Request": "1",
	Origin: "https://site.example",
	"Content-Type": "application/json",
};
async function command(
	id: string,
	method: string,
	path: string,
	body: unknown,
	key = crypto.randomUUID(),
) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/superboard-gateway/commands/${id}`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": key },
			body: JSON.stringify({ method, path, body }),
		},
	);
}

async function observedGatewayRoutes() {
	const request = new Request("https://api.internal/internal/route-manifest/v1");
	const token = "gateway-inventory-test";
	const response = await api.fetch(
		new Request(request, { headers: await signPluginTaskRequest(request, token) }),
		{
			DB: pluginDatabase("api"),
			MODULE_INTERNAL_TOKEN: token,
			SUPERBOARD_INSTANCE_ID: env.SUPERBOARD_INSTANCE_ID,
			ENVIRONMENT: "test",
		} as never,
		{} as ExecutionContext,
	);
	expect({
		status: response.status,
		error: response.ok ? undefined : await response.clone().text(),
	}).toEqual({ status: 200, error: undefined });
	return parseRouteManifest(await response.json()).routes.filter(
		(route) => route.module === "gateway-published",
	);
}

test("Gateway publishes working optional routes, enforces policies and keeps unrelated APIs intact", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-gateway/enable",
		{ method: "POST", headers },
	);
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	const head = await SELF.fetch("https://site.example/api/v1/gateway/routes", {
		method: "HEAD",
		headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
	});
	expect(head.status).toBe(404);
	const list = await SELF.fetch("https://site.example/api/v1/gateway/routes", { headers });
	expect(list.status).toBe(200);
	expect(await list.json()).toEqual({ data: [] });
	const route = await command("update_gateway_route", "PUT", "/api/v1/gateway/routes/health", {
		method: "GET",
		path_pattern: "/health-check",
		target_path: "/health",
		rate_limit: 2,
		expected_revision: null,
	});
	expect(route.status, await route.clone().text()).toBe(200);
	expect((await observedGatewayRoutes()).some((item) => item.path.endsWith("/health-check"))).toBe(
		false,
	);
	const publication = await command(
		"publish_gateway_manifest",
		"POST",
		"/api/v1/gateway/manifests",
		{},
	);
	expect(publication.status, await publication.clone().text()).toBe(201);
	expect(await observedGatewayRoutes()).toContainEqual(
		expect.objectContaining({
			path: "/api/v1/gateway/proxy/health-check",
			pluginId: "superboard-gateway",
		}),
	);
	const call = () =>
		SELF.fetch("https://site.example/api/v1/gateway/invoke/health", {
			method: "POST",
			headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
			body: "{}",
		});
	const invoked = await call();
	expect(invoked.status, await invoked.clone().text()).toBe(200);
	expect(await invoked.json()).toMatchObject({ status: "ok" });
	expect((await call()).status).toBe(200);
	expect((await call()).status).toBe(429);
	const policy = await command("rotate_access_policy", "POST", "/api/v1/gateway/access-policy", {
		allowed_operator_ids: ["different-operator"],
	});
	expect(policy.status).toBe(200);
	expect((await call()).status).toBe(403);
	const rejected = await command("update_gateway_route", "PUT", "/api/v1/gateway/routes/unsafe", {
		method: "GET",
		path_pattern: "/unsafe",
		target_path: "https://external.example",
		rate_limit: 2,
		expected_revision: null,
	});
	expect(rejected.status).toBe(422);
	const withdrawn = await command("update_gateway_route", "PUT", "/api/v1/gateway/routes/health", {
		method: "GET",
		path_pattern: "/health-check",
		target_path: "/health",
		rate_limit: 2,
		expected_revision: 1,
		enabled: false,
	});
	expect({
		status: withdrawn.status,
		error: withdrawn.ok ? undefined : await withdrawn.clone().text(),
	}).toEqual({ status: 200, error: undefined });
	expect((await observedGatewayRoutes()).some((item) => item.path.endsWith("/health-check"))).toBe(
		true,
	);
	const republished = await command(
		"publish_gateway_manifest",
		"POST",
		"/api/v1/gateway/manifests",
		{},
	);
	expect({
		status: republished.status,
		error: republished.ok ? undefined : await republished.clone().text(),
	}).toEqual({ status: 201, error: undefined });
	expect((await observedGatewayRoutes()).some((item) => item.path.endsWith("/health-check"))).toBe(
		false,
	);
	expect((await call()).status).toBe(404);
});

const plugin = "superboard-gateway";
const file = "gateway-autonomy.runtime.test.ts";
test("canonical Gateway APIs persist a published route, enforce its rate limit and rotate operator access", async () => {
	await prepareApiPlugin(plugin);
	await pluginDatabase("api")
		.prepare("DELETE FROM gateway_operator_policies WHERE instance_id=?")
		.bind(env.SUPERBOARD_INSTANCE_ID)
		.run();
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
