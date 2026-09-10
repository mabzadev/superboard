import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { dispatchMcpInstanceIntegration } from "../../../workers/api/src/lib/mcp-instance-integrations.js";
import appWorker from "../../../workers/app/src/index.js";

const plugin = "supbrd-plugmod-mcp";
const headers = {
	"X-Parity-Operator": "1",
	"X-EmDash-Request": "1",
	Origin: "https://site.example",
	"Content-Type": "application/json",
};
function invoke(body: unknown, key = crypto.randomUUID()) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/commands/invoke_tool`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": key },
			body: JSON.stringify({ method: "POST", path: "/api/v1/mcp/operator/invocations", body }),
		},
	);
}
function read(source: string, path: string) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/data-sources/${source}?request=${encodeURIComponent(JSON.stringify({ method: "GET", path }))}`,
		{ headers },
	);
}
test("MCP invokes its real protocol using an ephemeral operator grant and retains scoped sessions and receipts", async () => {
	const enabled = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${plugin}/enable`,
		{ method: "POST", headers },
	);
	expect(enabled.status).toBe(201);
	const scope = await SELF.fetch("https://site.example/_emdash/api/superboard/operator-context", {
		method: "POST",
		headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
	});
	expect(scope.status).toBe(200);
	const key = crypto.randomUUID();
	const called = await invoke({ tool: "get_status", arguments: {} }, key);
	expect(called.status, await called.clone().text()).toBe(200);
	const result = (await called.json()) as {
		data: {
			session_id: string;
			receipt_id: string;
			status: string;
			result: { content: Array<{ text: string }>; isError?: boolean };
		};
	};
	expect(result.data.status).toBe("completed");
	expect(result.data.result.isError).not.toBe(true);
	expect(result.data.result.content[0]?.text).toContain("Account Overview");
	const repeated = await invoke({ tool: "get_status", arguments: {} }, key);
	expect(await repeated.json()).toEqual(result);
	const sessions = await read("sessions", "/api/v1/mcp/operator/sessions");
	expect(sessions.status).toBe(200);
	expect(await sessions.json()).toMatchObject({
		data: { items: [{ session_id: result.data.session_id, status: "active" }] },
	});
	const receipts = await read("tool_receipts", "/api/v1/mcp/operator/receipts");
	expect(receipts.status).toBe(200);
	expect(await receipts.json()).toMatchObject({
		data: {
			items: [{ receipt_id: result.data.receipt_id, tool: "get_status", status: "completed" }],
		},
	});
	const db = (env as unknown as { HEALTH_API_DB: D1Database }).HEALTH_API_DB;
	expect(
		await db.prepare("SELECT COUNT(*) AS count FROM mcp_operator_invocations").first(),
	).toEqual({ count: 1 });
	expect(
		await db
			.prepare(
				"SELECT COUNT(*) AS count FROM mcp_tokens WHERE mcp_client_id='superboard:operator-invocation' AND revoked_at IS NULL",
			)
			.first(),
	).toEqual({ count: 0 });
	expect(await db.prepare("SELECT COUNT(*) AS count FROM users").first()).toEqual({ count: 0 });
	const failed = await invoke({
		tool: "tool_does_not_exist",
		arguments: {},
		session_id: result.data.session_id,
	});
	expect(failed.status).toBe(200);
	expect(await failed.json()).toMatchObject({ data: { status: "failed" } });
	await db
		.prepare(
			"UPDATE mcp_operator_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE session_id=?",
		)
		.bind(result.data.session_id)
		.run();
	expect(
		(await invoke({ tool: "get_status", arguments: {}, session_id: result.data.session_id }))
			.status,
	).toBe(409);
	await db
		.prepare(
			"INSERT INTO mcp_clients(id,name,client_id,redirect_uris) VALUES ('consent-test','Registered application','consent-client','[\"http://localhost:3210/callback\"]')",
		)
		.run();
	const consent = (redirect: string) =>
		SELF.fetch(
			`https://site.example/api/v1/mcp/consent-request?client_id=consent-client&redirect_uri=${encodeURIComponent(redirect)}`,
			{ headers },
		);
	expect(await (await consent("http://localhost:3210/callback")).json()).toEqual({
		client_id: "consent-client",
		name: "Registered application",
		redirect_uri: "http://localhost:3210/callback",
	});
	expect((await consent("javascript:alert(1)")).status).toBe(400);
	expect((await consent("https://unregistered.example/callback")).status).toBe(400);
});

test("MCP link tools use the Dynamic Links authority and preserve custom metadata", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/enable",
		{ method: "POST", headers },
	);
	expect(enabled.status).toBe(201);
	const scopeResponse = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/operator-context",
		{ method: "POST", headers: { ...headers, "Idempotency-Key": "mcp-links-context" } },
	);
	const scope = (await scopeResponse.json()) as { production_project_ref: string };
	const configured = await invoke({
		tool: "configure_redirects",
		arguments: {
			project_id: scope.production_project_ref,
			fallback_url: "https://application.example/welcome",
		},
	});
	expect(configured.status).toBe(200);
	const configuredBody = await configured.json();
	expect(configuredBody, JSON.stringify(configuredBody)).toMatchObject({
		data: { status: "completed" },
	});
	const created = await invoke({
		tool: "create_link",
		arguments: {
			project_id: scope.production_project_ref,
			name: "MCP owned link",
			path: "mcp-owned-link",
			tags: ["mcp"],
			data: { source: "operator-tool" },
		},
	});
	expect(created.status).toBe(200);
	const createdBody = await created.json();
	expect(createdBody, JSON.stringify(createdBody)).toMatchObject({ data: { status: "completed" } });
	const stores = env as unknown as {
		HEALTH_DYNAMIC_LINKS_DB: D1Database;
		HEALTH_API_DB: D1Database;
	};
	const row = await stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
		"SELECT id,destination_url,data_json,tags_json FROM links WHERE slug='mcp-owned-link'",
	).first<{ id: string; destination_url: string; data_json: string; tags_json: string }>();
	expect(row).toMatchObject({
		destination_url: "https://application.example/welcome",
		data_json: '{"source":"operator-tool"}',
		tags_json: '["mcp"]',
	});
	expect(
		await stores.HEALTH_API_DB.prepare(
			"SELECT COUNT(*) AS count FROM links WHERE path='mcp-owned-link'",
		).first(),
	).toEqual({ count: 0 });
	await invoke({
		tool: "configure_redirects",
		arguments: {
			project_id: scope.production_project_ref,
			fallback_url: "https://application.example/updated",
		},
	});
	const resolved = await SELF.fetch(
		`https://site.example/api/v1/dynamic-links/projects/${scope.production_project_ref}/links/mcp-owned-link/resolve`,
		{
			method: "POST",
			headers: { ...headers, "Idempotency-Key": "mcp-link-resolve" },
			body: JSON.stringify({ platform: "desktop" }),
		},
	);
	expect(await resolved.json()).toMatchObject({
		data: { destination_url: "https://application.example/updated" },
	});
	const updated = await invoke({
		tool: "update_link",
		arguments: {
			project_id: scope.production_project_ref,
			link_id: row!.id,
			name: "MCP updated link",
		},
	});
	expect(updated.status).toBe(200);
	expect(await updated.json()).toMatchObject({ data: { status: "completed" } });
	expect(
		await stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
			"SELECT name,data_json,tags_json FROM links WHERE id=?",
		)
			.bind(row!.id)
			.first(),
	).toEqual({
		name: "MCP updated link",
		data_json: '{"source":"operator-tool"}',
		tags_json: '["mcp"]',
	});
	const archived = await invoke({
		tool: "archive_link",
		arguments: { project_id: scope.production_project_ref, link_id: row!.id },
	});
	expect(archived.status).toBe(200);
	expect(await archived.json()).toMatchObject({ data: { status: "completed" } });
	expect(
		await stores.HEALTH_DYNAMIC_LINKS_DB.prepare("SELECT active FROM links WHERE id=?")
			.bind(row!.id)
			.first(),
	).toEqual({ active: 0 });
});

test("MCP SDK settings and usage use the owning Workers with User absent", async () => {
	for (const id of ["supbrd-plug-settings", "supbrd-plugmod-analytics"])
		expect(
			(
				await SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${id}/enable`, {
					method: "POST",
					headers,
				})
			).ok,
		).toBe(true);
	const stores = env as unknown as {
		HEALTH_API_DB: D1Database;
		HEALTH_APP_DB: D1Database;
		HEALTH_ANALYTICS_DB: D1Database;
	};
	const instance = await stores.HEALTH_API_DB.prepare(
		"SELECT id FROM instances WHERE uri_scheme='reference-production'",
	).first<{ id: number }>();
	const configured = await invoke({
		tool: "configure_sdk",
		arguments: {
			instance_id: String(instance!.id),
			ios_bundle_id: "com.example.mcp",
			ios_team_id: "MCPTEAM123",
		},
	});
	expect(await configured.json()).toMatchObject({ data: { status: "completed" } });
	const configurations = await stores.HEALTH_APP_DB.prepare(
		"SELECT configuration_json FROM sdk_configurations WHERE platform='ios'",
	).all<{ configuration_json: string }>();
	expect(configurations.results).toHaveLength(2);
	for (const row of configurations.results)
		expect(JSON.parse(row.configuration_json)).toMatchObject({
			bundle_id: "com.example.mcp",
			team_id: "MCPTEAM123",
		});
	expect(
		await stores.HEALTH_API_DB.prepare("SELECT COUNT(*) AS count FROM ios_configurations").first(),
	).toEqual({ count: 0 });
	const project = await stores.HEALTH_API_DB.prepare(
		"SELECT id FROM projects WHERE instance_id=? AND is_test=0",
	)
		.bind(instance!.id)
		.first<{ id: number }>();
	await stores.HEALTH_ANALYTICS_DB.prepare(
		"INSERT INTO analytics_events_hot(project_id,event_id,event_name,event_source,application_id,user_id_hash,occurred_at,archive_key,expires_at) VALUES (?,'mcp-usage-event','session.started','system','mcp-app','mcp-subject',?,'fixture/mcp-usage','2099-01-01T00:00:00.000Z')",
	)
		.bind(String(project!.id), new Date().toISOString())
		.run();
	const usage = await invoke({
		tool: "get_usage",
		arguments: { instance_id: String(instance!.id) },
	});
	const body = (await usage.json()) as {
		data: { status: string; result: { content: Array<{ text: string }> } };
	};
	expect(body.data.status).toBe("completed");
	expect(body.data.result.content[0]?.text).toContain("Active users (30 days): 1");
});

async function mcpScope() {
	await SELF.fetch(`https://site.example/_emdash/api/superboard/plugins/${plugin}/enable`, {
		method: "POST",
		headers,
	});
	await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/enable",
		{ method: "POST", headers },
	);
	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/operator-context",
		{ method: "POST", headers: { ...headers, "Idempotency-Key": crypto.randomUUID() } },
	);
	return (await response.json()) as { production_project_ref: string };
}
function mcpRequest(path: string, body: unknown, method = "POST") {
	return SELF.fetch(`https://site.example/api/v1/mcp${path}`, {
		method,
		headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify(body),
	});
}
async function boundaryLinks() {
	const scope = await mcpScope();
	const stores = env as unknown as {
		HEALTH_DYNAMIC_LINKS_DB: D1Database;
		HEALTH_API_DB: D1Database;
	};
	const project = await stores.HEALTH_API_DB.prepare(
		"SELECT id FROM projects WHERE is_test=0 ORDER BY id LIMIT 1",
	).first<{ id: number }>();
	const prefix = `boundary-${crypto.randomUUID()}`;
	await stores.HEALTH_DYNAMIC_LINKS_DB.batch(
		Array.from({ length: 105 }, (_, index) =>
			stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
				"INSERT INTO links(id,project_id,slug,name,destination_url,title,tags_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
			).bind(
				`${prefix}-${index}`,
				String(project!.id),
				`${prefix}-${String(index).padStart(3, "0")}`,
				`${prefix} ${String(index).padStart(3, "0")}`,
				"https://example.test",
				index === 104 ? `${prefix}-needle` : "",
				JSON.stringify(index === 104 ? [`${prefix}-tag`] : []),
				index === 104 ? "2000-01-01" : "2026-01-01",
			),
		),
	);
	return { scope, stores, prefix, projectId: String(project!.id) };
}
test("MCP pagination returns links after the first hundred with accurate totals", async () => {
	const { scope, prefix } = await boundaryLinks();
	const response = await mcpRequest("/links/search", {
		project_id: scope.production_project_ref,
		search: prefix,
		page: 2,
		limit: 100,
		sort_by: "name",
		sort_order: "asc",
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { links: Array<{ path: string }>; meta: unknown };
	expect(body.links.map((row) => row.path)).toEqual(
		Array.from({ length: 5 }, (_, i) => `${prefix}-${i + 100}`),
	);
	expect(body.meta).toMatchObject({ page: 2, per_page: 100, total_entries: 105, total_pages: 2 });
});
test("MCP search matches titles and tags beyond the first hundred", async () => {
	const { scope, prefix } = await boundaryLinks();
	for (const search of [`${prefix}-needle`, `${prefix}-tag`]) {
		const response = await mcpRequest("/links/search", {
			project_id: scope.production_project_ref,
			search,
		});
		expect(await response.json()).toMatchObject({ links: [{ path: `${prefix}-104` }] });
	}
});
test("MCP top links ranks the full project, including older links", async () => {
	const { scope, prefix, stores, projectId } = await boundaryLinks();
	await stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
		"INSERT INTO link_events(id,project_id,link_id,event_type,occurred_at) VALUES (?,?,?,'view',?)",
	)
		.bind(crypto.randomUUID(), projectId, `${prefix}-104`, new Date().toISOString())
		.run();
	const response = await mcpRequest("/analytics/top_links", {
		project_id: scope.production_project_ref,
		limit: 1,
	});
	expect(await response.json()).toMatchObject({ links: [{ path: `${prefix}-104`, views: 1 }] });
});
test("MCP partial redirect changes preserve other platforms and reject non-string URLs", async () => {
	const scope = await mcpScope();
	const first = await mcpRequest(
		"/redirects",
		{
			project_id: scope.production_project_ref,
			fallback_url: "https://default.test",
			ios_redirect: "https://ios.test",
			android_redirect: "https://android.test",
		},
		"PUT",
	);
	expect(first.status).toBe(200);
	const changed = await mcpRequest(
		"/redirects",
		{ project_id: scope.production_project_ref, ios_redirect: "https://new-ios.test" },
		"PUT",
	);
	expect(await changed.json()).toMatchObject({
		redirect_config: {
			default_fallback: "https://default.test",
			platforms: {
				ios: { fallback_url: "https://new-ios.test" },
				android: { fallback_url: "https://android.test" },
			},
		},
	});
	for (const invalid of [{ ios_redirect: 42 }, { platforms: { ios: { fallback_url: 42 } } }]) {
		const response = await mcpRequest(
			"/redirects",
			{ project_id: scope.production_project_ref, ...invalid },
			"PUT",
		);
		expect(response.status).toBe(422);
	}
});
test("MCP create_link accepts a native string campaign ID", async () => {
	const scope = await mcpScope();
	const created = await mcpRequest("/campaigns", {
		project_id: scope.production_project_ref,
		name: "Native campaign",
	});
	const campaign = (await created.json()) as { campaign: { id: string } };
	const result = await invoke({
		tool: "create_link",
		arguments: {
			project_id: scope.production_project_ref,
			campaign_id: campaign.campaign.id,
			name: "Campaign member",
			path: `campaign-member-${crypto.randomUUID()}`,
			custom_redirects: { default_fallback: "https://example.test" },
		},
	});
	expect(await result.json()).toMatchObject({ data: { status: "completed" } });
});

test("managed Infrastructure and MCP report unavailable historical metrics explicitly", async () => {
	await mcpScope();
	await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-observability/enable",
		{ method: "POST", headers },
	);
	for (const path of ["/api/v1/platform/status", "/api/v1/mcp/platform-status"]) {
		const response = await SELF.fetch(`https://site.example${path}`, { headers });
		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			metrics: Record<string, unknown>;
			jobs: Record<string, unknown>;
			metricAvailability: Record<string, unknown>;
		};
		expect(result.metrics.users).toBeNull();
		expect(result.metrics.pushDevices).toBeNull();
		expect(result.jobs.billingExports).toBeNull();
		expect(result.jobs.failedPurchases).toBeNull();
		expect(result.metrics.instances).toBe(1);
		expect(result.metrics.projects).toBe(2);
		expect(result.metricAvailability).toMatchObject({
			mode: "managed",
			historicalMetrics: "unavailable",
		});
	}
});

test("SDK partial project failures report completed writes and can resume", async () => {
	await mcpScope();
	const stores = env as unknown as { HEALTH_API_DB: D1Database; HEALTH_APP_DB: D1Database };
	const instance = await stores.HEALTH_API_DB.prepare(
		"SELECT id FROM instances WHERE uri_scheme='reference-production'",
	).first<{ id: number }>();
	let writes = 0;
	let fail = true;
	const runtime = {
		DB: stores.HEALTH_API_DB,
		MODULE_INTERNAL_TOKEN: "sdk-partial-secret",
		APP_MODULE: {
			fetch: async (request: Request) => {
				if (request.method === "PUT" && ++writes === 2 && fail)
					return Response.json({ error: "unavailable" }, { status: 503 });
				return appWorker.fetch(
					request,
					{ DB: stores.HEALTH_APP_DB, INTERNAL_API_TOKEN: "sdk-partial-secret" } as never,
					createExecutionContext(),
				);
			},
		},
	};
	const invokeSdk = () =>
		dispatchMcpInstanceIntegration(
			runtime as never,
			{ operator_id: "sdk-partial-operator", instance_id: "reference-production", role: 50 },
			instance!.id,
			"sdk",
			{ ios_bundle_id: "com.example.partial", ios_team_id: "PARTIAL123" },
		);
	const response = await invokeSdk();
	expect(response.status).toBe(503);
	expect(await response.json()).toMatchObject({
		error: expect.stringContaining("partially"),
		environments: [
			{ project_id: `${instance!.id}-prod`, platform: "ios", status: "configured" },
			{ project_id: `${instance!.id}-test`, platform: "ios", status: "unavailable" },
		],
	});
	fail = false;
	const resumed = await invokeSdk();
	expect(resumed.status).toBe(200);
	expect(await resumed.json()).toMatchObject({
		environments: [{ status: "configured" }, { status: "configured" }],
	});
});

test("MCP campaign search paginates and ranks metrics across all campaigns", async () => {
	const { scope, stores, prefix, projectId } = await boundaryLinks();
	await stores.HEALTH_DYNAMIC_LINKS_DB.batch(
		Array.from({ length: 105 }, (_, i) =>
			stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
				"INSERT INTO campaigns(id,project_id,name,slug,status) VALUES (?,?,?,?,'active')",
			).bind(
				`${prefix}-campaign-${i}`,
				projectId,
				`${prefix} ${String(i).padStart(3, "0")}`,
				`${prefix}-campaign-${i}`,
			),
		),
	);
	const page = await mcpRequest("/campaigns/search", {
		project_id: scope.production_project_ref,
		term: prefix,
		page: 2,
		per_page: 100,
		sort_by: "name",
		ascendent: true,
	});
	const result = (await page.json()) as { campaigns: Array<{ name: string }>; meta: unknown };
	expect(result.campaigns.map((row) => row.name)).toEqual(
		Array.from({ length: 5 }, (_, i) => `${prefix} ${i + 100}`),
	);
	expect(result.meta).toMatchObject({ page: 2, total_entries: 105, total_pages: 2 });
	await stores.HEALTH_DYNAMIC_LINKS_DB.prepare(
		"INSERT INTO link_events(id,project_id,campaign_id,event_type,occurred_at) VALUES (?,?,?,'view',?)",
	)
		.bind(crypto.randomUUID(), projectId, `${prefix}-campaign-104`, new Date().toISOString())
		.run();
	const ranked = await mcpRequest("/campaigns/search", {
		project_id: scope.production_project_ref,
		term: prefix,
		per_page: 1,
		sort_by: "views",
	});
	expect(await ranked.json()).toMatchObject({
		campaigns: [{ id: `${prefix}-campaign-104`, total_views: 1 }],
	});
});
test("MCP partial link redirects preserve the other destination", async () => {
	const scope = await mcpScope();
	const created = await mcpRequest("/links", {
		project_id: scope.production_project_ref,
		name: "Partial destinations",
		custom_redirects: {
			default_fallback: "https://default.test",
			ios: "https://ios.test",
			android: "https://android.test",
		},
	});
	const { link } = (await created.json()) as { link: { id: string } };
	const updated = await mcpRequest(
		`/links/${link.id}`,
		{
			project_id: scope.production_project_ref,
			custom_redirects: { ios: "https://updated-ios.test" },
		},
		"PATCH",
	);
	expect(await updated.json()).toMatchObject({
		link: {
			custom_redirects: { ios: "https://updated-ios.test", android: "https://android.test" },
		},
	});
	const invalid = await mcpRequest(
		`/links/${link.id}`,
		{ project_id: scope.production_project_ref, custom_redirects: { ios: 42 } },
		"PATCH",
	);
	expect(invalid.status).toBe(422);
});
