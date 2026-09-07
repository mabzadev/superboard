import { SELF, env } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import { proxyOperatorApiRequest } from "../src/lib/operator-api-proxy.js";
import { initializeOperatorProjectScope } from "../src/lib/operator-project-scope.js";
import { matchPluginApiAdapter } from "../src/lib/plugin-api-adapter.js";
import { resolveRepositoryCommandScope } from "../src/lib/plugin-command-authority.js";
import { importPluginStoreEncryptionKey } from "../src/lib/plugin-store-repository.js";

const pluginId = "supbrd-plugmod-paywalls";
const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
	"Content-Type": "application/json",
};
let projectRef: string;

beforeAll(async () => {
	const scope = await initializeOperatorProjectScope(
		env,
		{ id: "operator-1", role: 50 },
		crypto.randomUUID(),
	);
	projectRef = scope.production_project_ref;
	for (const id of [pluginId, "supbrd-plug-settings"]) {
		const enabled = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${id}/enable`,
			{ method: "POST", headers },
		);
		expect(enabled.status, await enabled.clone().text()).toBe(201);
	}
});

function command(
	envelope: unknown,
	operationId = crypto.randomUUID(),
	commandId = "create_paywall",
) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/commands/${commandId}`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": operationId },
			body: JSON.stringify(envelope),
		},
	);
}

test("Settings configures and verifies an SDK with User disabled", async () => {
	const root = "https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings";
	const path = `/api/v1/app/projects/${projectRef}/setup/ios`;
	const body = {
		bundle_id: "com.example.independent",
		team_id: "TEAM123",
		minimum_version: "1.0.0",
		recommended_version: "1.0.0",
		maintenance_enabled: false,
	};
	const saved = await SELF.fetch(`${root}/commands/save_sdk_configuration`, {
		method: "POST",
		headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({ method: "PUT", path, body }),
	});
	expect(saved.status, await saved.clone().text()).toBe(200);
	const checked = await SELF.fetch(`${root}/commands/test_sdk_configuration`, {
		method: "POST",
		headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({ method: "POST", path: `${path}/test`, body: {} }),
	});
	expect(checked.status, await checked.clone().text()).toBe(200);
	const read = new URL(`${root}/data-sources/sdk_configurations`);
	read.searchParams.set("request", JSON.stringify({ method: "GET", path }));
	const response = await SELF.fetch(read, { headers });
	expect(await response.json()).toMatchObject({
		data: { status: "verified", configuration: { bundle_id: "com.example.independent" } },
	});
});

test("creates a real Paywall and replays the command without a second mutation", async () => {
	const identifier = `canonical-${crypto.randomUUID()}`;
	const payload = {
		method: "POST",
		path: `/api/v1/paywalls/projects/${projectRef}`,
		body: { identifier, display_name: "Canonical Paywall" },
	};
	const key = crypto.randomUUID();
	const created = await command(payload, key);
	expect(created.status, await created.clone().text()).toBe(201);
	const createdBody = await created.json();
	const replay = await command(payload, key);
	expect(replay.status).toBe(201);
	expect(await replay.json()).toEqual(createdBody);
	const bindings = env as unknown as { HEALTH_PAYWALLS_DB: D1Database };
	const stored = await bindings.HEALTH_PAYWALLS_DB.prepare(
		"SELECT identifier, name FROM paywalls WHERE identifier = ?",
	)
		.bind(identifier)
		.all();
	expect(stored.results).toEqual([{ identifier, name: "Canonical Paywall" }]);
	const read = new URL(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/data-sources/paywalls`,
	);
	read.searchParams.set(
		"request",
		JSON.stringify({ method: "GET", path: `/api/v1/paywalls/projects/${projectRef}` }),
	);
	const listed = await SELF.fetch(read, { headers });
	expect(listed.status, await listed.clone().text()).toBe(200);
	expect(await listed.text()).toContain(identifier);
	const conflict = await command(
		{ ...payload, body: { ...payload.body, display_name: "Changed replay" } },
		key,
	);
	expect(conflict.status).toBe(400);
});

test("blocks paths, methods, query parameters and project scope outside the verified operation", async () => {
	const path = `/api/v1/paywalls/projects/${projectRef}`;
	for (const envelope of [
		{ method: "DELETE", path, body: {} },
		{ method: "POST", path: `${path}/paywalls/other`, body: {} },
		{ method: "POST", path: `${path}?project_ref=999-prod`, body: {} },
		{ method: "POST", path: "https://evil.example/api/v1/paywalls", body: {} },
		{
			method: "POST",
			path: `/api/v1/paywalls/projects/../products/projects/${projectRef}`,
			body: {},
		},
	])
		expect((await command(envelope)).status).toBe(422);
	expect(
		(await command({ method: "POST", path: "/api/v1/paywalls/projects/999-prod", body: {} }))
			.status,
	).toBe(403);
	const foreign = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-products/commands/create_product",
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				method: "POST",
				path: "/api/v1/products/projects/999-prod/catalog/products",
				body: {},
			}),
		},
	);
	expect(foreign.status).toBe(404);
});

test("declared settings commands reject unrelated paths instead of writing a generic store", async () => {
	const unresolved = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings/commands/update_effective_settings",
		{
			method: "POST",
			headers,
			body: JSON.stringify({ method: "PUT", path: "/api/v1/settings", body: { name: "test" } }),
		},
	);
	expect(unresolved.status).toBe(422);
	expect(await unresolved.json()).toMatchObject({
		error: { code: "PLUGIN_ADAPTER_OPERATION_NOT_ALLOWED" },
	});
});

test("keeps encoded slashes inside an opaque Flows user identifier", () => {
	const matched = matchPluginApiAdapter(
		"supbrd-plugmod-flows",
		"supbrd-plugmod-flows.data_source.user_details",
		"data_source",
		{ method: "GET", path: `/api/v1/flows/projects/${projectRef}/users/provider%2Fcustomer` },
	);
	expect(matched.parameters.userHash).toBe("provider/customer");
	expect(matched.url.pathname).toContain("provider%2Fcustomer");
});

test("checks operator and CSRF before dispatch", async () => {
	const url = `https://site.example/_emdash/api/superboard/plugins/${pluginId}/commands/create_paywall`;
	const body = JSON.stringify({
		method: "POST",
		path: `/api/v1/paywalls/projects/${projectRef}`,
		body: {},
	});
	expect(
		(
			await SELF.fetch(url, {
				method: "POST",
				headers: { ...headers, "X-Parity-Operator": "0" },
				body,
			})
		).status,
	).toBe(401);
	expect(
		(
			await SELF.fetch(url, {
				method: "POST",
				headers: { ...headers, "X-EmDash-Request": "0" },
				body,
			})
		).status,
	).toBe(403);
	expect(
		(
			await SELF.fetch(url, {
				method: "POST",
				headers: { ...headers, Origin: "https://other.example" },
				body,
			})
		).status,
	).toBe(403);
});

test("direct App business URLs remain gated when User is inactive", async () => {
	const request = new Request(`https://site.example/api/v1/app/projects/${projectRef}`);
	const result = await proxyOperatorApiRequest({
		request,
		operator: { id: "operator-1", role: 50 },
		env,
	});
	expect(result.status).toBe(404);
	expect(
		resolveRepositoryCommandScope(
			new URL(`/api/v1/app/projects/${projectRef}/setup/web`, request.url),
		).plugin_id,
	).toBe("supbrd-plug-settings");
	expect(
		resolveRepositoryCommandScope(
			new URL(`/api/v1/app/projects/${projectRef}/purchases`, request.url),
		).plugin_id,
	).toBe("supbrd-plugmod-billing");
	expect(
		resolveRepositoryCommandScope(
			new URL(`/api/v1/app/projects/${projectRef}/analytics`, request.url),
		).plugin_id,
	).toBe("supbrd-plugmod-analytics");
	expect(
		resolveRepositoryCommandScope(
			new URL(`/api/v1/app/projects/${projectRef}/access-key`, request.url),
		).plugin_id,
	).toBe("supbrd-plug-settings");
});

test("preserves multipart bytes through the command repository and signed Worker request", async () => {
	const form = new FormData();
	form.set("description", "binary transport");
	form.set(
		"file",
		new File([new Uint8Array([0, 255, 128, 10])], "sample.bin", {
			type: "application/octet-stream",
		}),
	);
	const key = crypto.randomUUID();
	const requestHeaders = new Headers(headers);
	requestHeaders.delete("Content-Type");
	requestHeaders.set("Idempotency-Key", key);
	requestHeaders.set(
		"X-SuperBoard-Adapter-Request",
		JSON.stringify({ method: "POST", path: `/api/v1/paywalls/projects/${projectRef}` }),
	);
	const request = new Request(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/commands/create_paywall`,
		{ method: "POST", headers: requestHeaders, body: form },
	);
	const original = new Uint8Array(await request.clone().arrayBuffer());
	const response = await SELF.fetch(request);
	// The Paywalls handler accepts JSON; this exercises transport and admission, not an upload feature.
	expect(response.status, await response.clone().text()).toBe(400);
	const row = await env.DB.prepare(
		"SELECT request_payload_json FROM superboard_plugin_command_operations WHERE operation_id = ?",
	)
		.bind(key)
		.first<{ request_payload_json: string }>();
	expect(row).not.toBeNull();
	const payload = JSON.parse(row!.request_payload_json) as { iv: string; ciphertext: string };
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0)) },
		await importPluginStoreEncryptionKey(env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY),
		Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0)),
	);
	expect(new Uint8Array(decrypted)).toEqual(original);
});
