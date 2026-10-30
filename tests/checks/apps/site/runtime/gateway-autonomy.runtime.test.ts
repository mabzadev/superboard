import { parseRouteManifest } from "@superboard/contracts/route-manifest";
import { signPluginTaskRequest } from "@superboard/contracts/plugin-task";
import api from "../../../../../packages/plugins/superboard-core/api/src/index.js";
import { pluginDatabase } from "./retirement-api-helpers.js";
import { env } from "cloudflare:test";
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

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
	const response = await api.fetch(new Request(request, { headers: await signPluginTaskRequest(request, token) }), { DB: pluginDatabase("api"), MODULE_INTERNAL_TOKEN: token, SUPERBOARD_INSTANCE_ID: env.SUPERBOARD_INSTANCE_ID, ENVIRONMENT: "test" } as never, {} as ExecutionContext);
	expect({ status: response.status, error: response.ok ? undefined : await response.clone().text() }).toEqual({ status: 200, error: undefined });
	return parseRouteManifest(await response.json()).routes.filter(route => route.module === "gateway-published");
}

test("Gateway publishes working optional routes, enforces policies and keeps unrelated APIs intact", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/superboard-gateway/enable",
		{ method: "POST", headers },
	);
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	const head = await SELF.fetch("https://site.example/api/v1/gateway/routes", { method: "HEAD", headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } });
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
	expect((await observedGatewayRoutes()).some(item => item.path.endsWith("/health-check"))).toBe(false);
	const publication = await command(
		"publish_gateway_manifest",
		"POST",
		"/api/v1/gateway/manifests",
		{},
	);
	expect(publication.status, await publication.clone().text()).toBe(201);
	expect(await observedGatewayRoutes()).toContainEqual(expect.objectContaining({ path: "/api/v1/gateway/proxy/health-check", pluginId: "superboard-gateway" }));
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
	const withdrawn = await command("update_gateway_route", "PUT", "/api/v1/gateway/routes/health", { method: "GET", path_pattern: "/health-check", target_path: "/health", rate_limit: 2, expected_revision: 1, enabled: false });
	expect({ status: withdrawn.status, error: withdrawn.ok ? undefined : await withdrawn.clone().text() }).toEqual({ status: 200, error: undefined });
	expect((await observedGatewayRoutes()).some(item => item.path.endsWith("/health-check"))).toBe(true);
	const republished = await command("publish_gateway_manifest", "POST", "/api/v1/gateway/manifests", {});
	expect({ status: republished.status, error: republished.ok ? undefined : await republished.clone().text() }).toEqual({ status: 201, error: undefined });
	expect((await observedGatewayRoutes()).some(item => item.path.endsWith("/health-check"))).toBe(false);
	expect((await call()).status).toBe(404);
});
