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
		`https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/${id}`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": key },
			body: JSON.stringify({ method, path, body }),
		},
	);
}
test("Gateway publishes working optional routes, enforces policies and keeps unrelated APIs intact", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-gateway/enable",
		{ method: "POST", headers },
	);
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	const route = await command("update_gateway_route", "PUT", "/api/v1/gateway/routes/health", {
		method: "GET",
		path_pattern: "/health-check",
		target_path: "/health",
		rate_limit: 2,
		expected_revision: null,
	});
	expect(route.status, await route.clone().text()).toBe(200);
	const publication = await command(
		"publish_gateway_manifest",
		"POST",
		"/api/v1/gateway/manifests",
		{},
	);
	expect(publication.status, await publication.clone().text()).toBe(201);
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
});
