import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import { env } from "cloudflare:workers";
import { beforeAll, expect, test } from "vitest";

import apiInitialSchema from "../../../workers/api/migrations/0001_initial_schema.sql?raw";
import apiParitySchema from "../../../workers/api/migrations/0004_grovs_full_parity_schema.sql?raw";
import apiParityColumns from "../../../workers/api/migrations/0005_grovs_production_column_parity.sql?raw";
import billingDeadLetters from "../../../workers/api/migrations/0044_billing_dead_letter_quarantine.sql?raw";
import scopeMigration from "../../../workers/api/migrations/0063_site_operator_scope.sql?raw";
import mcpSiteGrantSchema from "../../../workers/api/migrations/0064_mcp_site_operator_grants.sql?raw";
import api from "../../../workers/api/src/index.js";
import { getRequestAuthContext } from "../../../workers/api/src/lib/auth.js";
import type { Env } from "../../../workers/api/src/types.js";
import billing from "../../../workers/billing/src/index.js";
import paywallsInitial from "../../../workers/paywalls/migrations/0001_paywalls.sql?raw";
import paywallsDomain from "../../../workers/paywalls/migrations/0002_paywalls_domain.sql?raw";
import paywallsAudit from "../../../workers/paywalls/migrations/0003_audit_context.sql?raw";
import paywalls from "../../../workers/paywalls/src/index.js";
import { proxyOperatorApiRequest } from "../src/lib/operator-api-proxy.js";
import {
	initializeOperatorProjectScope,
	resolveOperatorProjectScope,
} from "../src/lib/operator-project-scope.js";
import {
	synchronizeSuperBoardPluginCatalog,
	superBoardRuntimePluginCatalog,
} from "../src/lib/superboard-plugin-catalog.js";

test("accepts an EmDash operator without an account in the historical users table", async () => {
	const secret = "site-operator-runtime-secret";
	const operator = {
		operator_id: "operator-without-historical-account",
		instance_id: "vocostar",
		role: 50,
	};
	const url = "https://api.internal/api/v1/paywalls/projects/1-prod/paywalls";
	const headers = await signSiteOperatorRequest(new Request(url), operator, secret);
	const request = new Request(url, { headers });
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- real D1 binding with the environment fields consumed by the API authentication path
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: secret,
	} as unknown as Env;
	const result = await getRequestAuthContext(apiEnv, headers, { request });
	expect(result).toMatchObject({ source: "site", siteOperator: operator });
	const historicalUsers = await env.DB.prepare(
		"SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'users'",
	).first<{ count: number }>();
	expect(historicalUsers?.count).toBe(0);
	expect(
		await getRequestAuthContext({ ...apiEnv, SUPERBOARD_TARGET: "different-instance" }, headers, {
			request,
		}),
	).toBeNull();
});

beforeAll(async () => {
	await env.DB.batch(
		[paywallsInitial, paywallsDomain, paywallsAudit].flatMap((sql) =>
			sql
				.split(";")
				.map((statement) => statement.trim())
				.filter(Boolean)
				.map((statement) => env.DB.prepare(statement)),
		),
	);
	await synchronizeSuperBoardPluginCatalog(env.DB, {
		instance_id: "vocostar",
		target: "local",
		approved_by: "emdash-owner",
		checked_at: "2026-09-05T00:00:00.000Z",
		expires_at: "2999-09-06T00:00:00.000Z",
		target_artifact_checksum: `sha256:${"a".repeat(64)}`,
		target_plugin_ids: superBoardRuntimePluginCatalog().plugins.map(
			({ manifest }) => manifest.plugin_id,
		),
	});
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'active' WHERE instance_id = 'vocostar' AND target = 'local' AND plugin_id IN ('supbrd-plugmod-paywalls','supbrd-plugmod-billing','supbrd-plugmod-marketing','supbrd-plugmod-mcp')",
	).run();
	await env.DB.batch([
		env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS instances (id INTEGER PRIMARY KEY, uri_scheme TEXT NOT NULL UNIQUE, api_key TEXT NOT NULL UNIQUE, get_started_dismissed INTEGER DEFAULT 0, revenue_collection_enabled INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
		),
		env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, instance_id INTEGER NOT NULL, is_test INTEGER NOT NULL, name TEXT NOT NULL, identifier TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
		),
		...billingDeadLetters
			.split(";")
			.map((statement) => statement.trim())
			.filter(Boolean)
			.map((statement) => env.DB.prepare(statement)),
		env.DB.prepare(scopeMigration),
		env.DB.prepare(
			"INSERT OR IGNORE INTO instances (id, uri_scheme, api_key) VALUES (42, 'vocostar', 'runtime-api-key'), (43, 'other-instance', 'other-api-key')",
		),
		env.DB.prepare(
			"INSERT OR IGNORE INTO projects (id, instance_id, is_test, name, identifier) VALUES (81, 42, 0, 'Production', 'runtime-prod'), (82, 42, 1, 'Test', 'runtime-test'), (83, 43, 0, 'Other', 'other-prod')",
		),
	]);
});

test("forwards the EmDash operator through the real domain gateway without historical users or roles", async () => {
	const secret = "runtime-site-operator-health-secret";
	const moduleSecret = "runtime-module-secret";
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: secret,
		MODULE_INTERNAL_TOKEN: moduleSecret,
		PAYWALLS_MODULE: {
			fetch: async (request: Request) => {
				const result = await verifyInternalProjectContextRequest(request, moduleSecret, "paywalls");
				return Response.json(result, { status: result.ok ? 200 : 401 });
			},
		},
	} as unknown as Env;
	const service = { fetch: (request: Request) => api.fetch(request, apiEnv) };
	const response = await proxyOperatorApiRequest({
		request: new Request("https://site.test/api/v1/paywalls/projects/42-prod/paywalls"),
		operator: { id: "emdash-core-owner", role: 50 },
		env: {
			DB: env.DB,
			API_SERVICE: service,
			SITE_OPERATOR_BRIDGE_TOKEN: secret,
			SUPERBOARD_INSTANCE_ID: "vocostar",
		},
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		ok: true,
		context: {
			projectId: 81,
			instanceId: 42,
			actorId: 0,
			operatorId: "emdash-core-owner",
			role: "owner",
		},
	});
	const forbidden = await proxyOperatorApiRequest({
		request: new Request("https://site.test/api/v1/paywalls/projects/43-prod/paywalls"),
		operator: { id: "emdash-core-owner", role: 50 },
		env: {
			DB: env.DB,
			API_SERVICE: service,
			SITE_OPERATOR_BRIDGE_TOKEN: secret,
			SUPERBOARD_INSTANCE_ID: "vocostar",
		},
	});
	expect(forbidden.status).toBe(403);
	const tables = await env.DB.prepare(
		"SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('users', 'instance_roles')",
	).first<{ count: number }>();
	expect(tables?.count).toBe(0);
});

test("persists a Paywalls mutation and its EmDash actor, and replays without duplicate effects", async () => {
	const secret = "runtime-site-operator-health-secret";
	const moduleSecret = "mutation-module-secret";
	const paywallsEnv = { DB: env.DB, INTERNAL_API_TOKEN: moduleSecret } as Parameters<
		typeof paywalls.fetch
	>[1];
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: secret,
		MODULE_INTERNAL_TOKEN: moduleSecret,
		PAYWALLS_MODULE: { fetch: (request: Request) => paywalls.fetch(request, paywallsEnv) },
	} as unknown as Env;
	const siteEnv = {
		...env,
		SUPERBOARD_INSTANCE_ID: "vocostar",
		SITE_OPERATOR_BRIDGE_TOKEN: secret,
		API_SERVICE: { fetch: (request: Request) => api.fetch(request, apiEnv) },
	};
	const operator = { id: "emdash-core-mutation-actor", role: 50 };
	const create = () =>
		proxyOperatorApiRequest({
			env: siteEnv,
			operator,
			request: new Request("https://site.test/api/v1/paywalls/projects/42-prod/paywalls", {
				method: "POST",
				headers: {
					Origin: "https://site.test",
					"X-EmDash-Request": "1",
					"Idempotency-Key": "paywalls-auth-create",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					display_name: "Independent Paywall",
					identifier: "independent-paywall",
				}),
			}),
		});
	const created = await create();
	expect({ status: created.status, body: await created.clone().json() }).toMatchObject({
		status: 201,
	});
	const payload = await created.json();
	const replay = await create();
	expect(replay.status).toBe(201);
	expect(await replay.json()).toEqual(payload);
	const read = await proxyOperatorApiRequest({
		env: siteEnv,
		operator,
		request: new Request("https://site.test/api/v1/paywalls/projects/42-prod/paywalls"),
	});
	expect(read.status).toBe(200);
	expect(await read.json()).toMatchObject({
		data: [expect.objectContaining({ name: "Independent Paywall" })],
	});
	const audit = await env.DB.prepare(
		"SELECT actor_id, project_ref FROM audit_events WHERE action = 'paywall.created'",
	).all<{ actor_id: string; project_ref: string }>();
	expect(audit.results).toEqual([{ actor_id: operator.id, project_ref: "42-prod" }]);
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'disabled' WHERE instance_id = 'vocostar' AND plugin_id = 'supbrd-plugmod-paywalls'",
	).run();
	const disabled = await proxyOperatorApiRequest({
		env: siteEnv,
		operator,
		request: new Request("https://site.test/api/v1/paywalls/projects/42-prod/paywalls"),
	});
	expect(disabled.status).toBe(404);
	expect(await disabled.json()).toMatchObject({ error: { code: "PLUGIN_NOT_ACTIVE" } });
});

test("keeps signed Site requests on the dedicated Billing Worker", async () => {
	const moduleSecret = "billing-context-secret";
	const billingEnv = {
		...env,
		INTERNAL_API_TOKEN: moduleSecret,
		CREDENTIAL_KEY_SCOPE: "billing",
	} as Parameters<typeof billing.fetch>[1];
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: "runtime-site-operator-health-secret",
		MODULE_INTERNAL_TOKEN: moduleSecret,
		BILLING_EXECUTION_MODE: "service",
		BILLING: { fetch: (request: Request) => billing.fetch(request, billingEnv) },
	} as unknown as Env;
	const request = new Request(
		"https://api.internal/api/v2/purchases/projects/42-prod/dead-letters",
	);
	const headers = await signSiteOperatorRequest(
		request,
		{ operator_id: "billing-site-operator", instance_id: "vocostar", role: 50 },
		"runtime-site-operator-health-secret",
	);
	const response = await api.fetch(new Request(request, { headers }), apiEnv);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ data: [] });
	const other = new Request("https://api.internal/api/v2/purchases/projects/43-prod/dead-letters");
	const forgedHeaders = await signSiteOperatorRequest(
		other,
		{ operator_id: "billing-site-operator", instance_id: "vocostar", role: 50 },
		"runtime-site-operator-health-secret",
	);
	expect((await api.fetch(new Request(other, { headers: forgedHeaders }), apiEnv)).status).toBe(
		403,
	);
});

test("legacy instance adapters expose only the bound instance without historical roles", async () => {
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: "runtime-site-operator-health-secret",
		SHORTLINK_DOMAIN: "links.test",
	} as unknown as Env;
	const request = async (path: string, method = "GET") => {
		const input = new Request(`https://api.internal${path}`, { method });
		const headers = await signSiteOperatorRequest(
			input,
			{ operator_id: "legacy-site-owner", instance_id: "vocostar", role: 50 },
			"runtime-site-operator-health-secret",
		);
		return api.fetch(new Request(input, { headers }), apiEnv);
	};
	const instances = await request("/api/v1/instances");
	expect(instances.status).toBe(200);
	expect(await instances.json()).toMatchObject({
		instances: [
			{ id: "42", production: { id: "42-prod" }, test: { id: "42-test" }, role: "owner" },
		],
	});
	expect((await request("/api/v1/instances/43", "PUT")).status).toBe(403);
	expect((await request("/api/v1/instances", "POST")).status).toBe(409);
	expect((await request("/api/v1/projects/43-prod/campaigns", "POST")).status).toBe(403);
	expect((await request("/api/v1/mcp/validate")).status).toBe(200);
	expect((await request("/api/v1/mcp/projects", "POST")).status).toBe(409);
	expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM instances").first()).toEqual({
		count: 2,
	});
});

test("MCP consent, exchange, refresh and revocation use stable EmDash grants without a historical account", async () => {
	const userTable = apiInitialSchema.match(/CREATE TABLE IF NOT EXISTS users \([\s\S]*?;/)![0];
	const mcpTables = apiParitySchema.match(/CREATE TABLE IF NOT EXISTS mcp_[\s\S]*?;/g)!;
	const mcpColumns = apiParityColumns.match(/ALTER TABLE mcp_[^;]+;/g)!;
	await env.DB.batch(
		[
			userTable,
			...mcpTables,
			...mcpColumns,
			...mcpSiteGrantSchema.split(";").filter((statement) => statement.trim()),
		].map((statement) => env.DB.prepare(statement)),
	);
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: "runtime-site-operator-health-secret",
	} as unknown as Env;
	const operator = { operator_id: "emdash-mcp-owner", instance_id: "vocostar", role: 50 };
	const post = (path: string, body: unknown) =>
		api.fetch(
			new Request(`https://api.internal${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			apiEnv,
		);
	const signed = async (path: string, method = "GET", body?: unknown, identity = operator) => {
		const init: RequestInit = {
			method,
			headers: body ? { "Content-Type": "application/json" } : {},
		};
		if (body !== undefined) init.body = JSON.stringify(body);
		const request = new Request(`https://api.internal${path}`, init);
		const headers = await signSiteOperatorRequest(
			request,
			identity,
			"runtime-site-operator-health-secret",
		);
		if (body) headers.set("Content-Type", "application/json");
		return api.fetch(new Request(request, { headers }), apiEnv);
	};
	const registered = await post("/register", {
		client_name: "Scoped MCP Runtime",
		redirect_uris: ["http://localhost:3210/callback"],
	});
	expect(registered.status).toBe(201);
	const client = (await registered.json()) as { client_id: string };
	const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
	const consent = await signed("/api/v1/mcp/approve_consent", "POST", {
		client_id: client.client_id,
		redirect_uri: "http://localhost:3210/callback",
		code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		code_challenge_method: "S256",
		scope: "mcp:full",
	});
	expect(consent.status).toBe(200);
	const code = (await consent.json()) as { code: string };
	const exchange = () =>
		post("/token", {
			grant_type: "authorization_code",
			code: code.code,
			code_verifier: verifier,
			client_id: client.client_id,
			redirect_uri: "http://localhost:3210/callback",
		});
	const results = await Promise.all([exchange(), exchange()]);
	expect(results.map((result) => result.status).toSorted((left, right) => left - right)).toEqual([
		200, 400,
	]);
	const token = (await results.find((result) => result.status === 200)!.json()) as {
		access_token: string;
		refresh_token: string;
	};
	const validate = (access: string, target = apiEnv) =>
		api.fetch(
			new Request("https://api.internal/api/v1/mcp/validate", {
				headers: { Authorization: `Bearer ${access}` },
			}),
			target,
		);
	expect((await validate(token.access_token)).status).toBe(200);
	expect(
		(await validate(token.access_token, { ...apiEnv, SUPERBOARD_TARGET: "unrelated-instance" }))
			.status,
	).toBe(401);
	const refreshed = await post("/token", {
		grant_type: "refresh_token",
		refresh_token: token.refresh_token,
		client_id: client.client_id,
	});
	expect(refreshed.status).toBe(200);
	const nextToken = (await refreshed.json()) as { access_token: string };
	expect((await validate(token.access_token)).status).toBe(401);
	expect((await validate(nextToken.access_token)).status).toBe(200);
	const list = await signed("/api/v1/mcp/tokens");
	const data = (await list.json()) as { tokens: Array<{ id: string }> };
	expect(data.tokens).toHaveLength(1);
	expect(
		(
			await signed(`/api/v1/mcp/tokens/${data.tokens[0]!.id}`, "DELETE", undefined, {
				...operator,
				operator_id: "another-operator",
			})
		).status,
	).toBe(404);
	expect((await signed(`/api/v1/mcp/tokens/${data.tokens[0]!.id}`, "DELETE")).status).toBe(200);
	expect((await validate(nextToken.access_token)).status).toBe(401);
	expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first()).toEqual({ count: 0 });
});

test("resolves real project references and only initializes missing scope on explicit POST", async () => {
	const operator = { id: "emdash-owner-without-user-account", role: 50 };
	const apiEnv = {
		...env,
		SUPERBOARD_TARGET: "vocostar",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
		SITE_OPERATOR_BRIDGE_TOKEN: "runtime-scope-secret",
	} as unknown as Env;
	const siteEnv = {
		SUPERBOARD_INSTANCE_ID: "vocostar",
		SITE_OPERATOR_BRIDGE_TOKEN: "runtime-scope-secret",
		API_SERVICE: { fetch: (request: Request) => api.fetch(request, apiEnv) },
	};
	await env.DB.prepare("UPDATE instances SET get_started_dismissed = 1 WHERE id = 42").run();
	const metadata = await resolveOperatorProjectScope(siteEnv, operator);
	expect(metadata.instance).toMatchObject({
		id: "42",
		uri_scheme: "vocostar",
		get_started_dismissed: true,
		production: { internal_id: "81", name: "Production" },
	});
	expect(JSON.stringify(metadata)).not.toContain("runtime-api-key");
	expect(metadata.instance).not.toHaveProperty("api_key");
	expect(metadata).toMatchObject({
		production_project_ref: "42-prod",
		test_project_ref: "42-test",
	});
	const freshApi = { ...apiEnv, SUPERBOARD_TARGET: "new-instance" };
	const freshSite = {
		...siteEnv,
		SUPERBOARD_INSTANCE_ID: "new-instance",
		API_SERVICE: { fetch: (request: Request) => api.fetch(request, freshApi) },
	};
	await expect(resolveOperatorProjectScope(freshSite, operator)).rejects.toThrow(
		"OPERATOR_PROJECT_SCOPE_UNAVAILABLE",
	);
	expect(
		await env.DB.prepare("SELECT id FROM instances WHERE uri_scheme = 'new-instance'").first(),
	).toBeNull();
	await expect(
		initializeOperatorProjectScope(freshSite, operator, "ambiguous-instance"),
	).rejects.toThrow("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	expect(
		await env.DB.prepare("SELECT id FROM instances WHERE uri_scheme = 'new-instance'").first(),
	).toBeNull();
	expect(
		await initializeOperatorProjectScope(freshSite, operator, "bind-existing-instance", {
			legacy_instance_id: 42,
		}),
	).toMatchObject({ production_project_ref: "42-prod", test_project_ref: "42-test" });
	await expect(
		initializeOperatorProjectScope(freshSite, operator, "reject-rebinding", {
			legacy_instance_id: 43,
		}),
	).rejects.toThrow("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	await env.DB.batch([
		env.DB.prepare("DELETE FROM site_operator_instances"),
		env.DB.prepare("DELETE FROM projects"),
		env.DB.prepare("DELETE FROM instances"),
	]);
	const scope = await initializeOperatorProjectScope(
		freshSite,
		operator,
		"initialize-new-instance",
	);
	expect(scope.production_project_ref).toMatch(/^[1-9][0-9]*-prod$/);
	expect(
		await initializeOperatorProjectScope(freshSite, operator, "initialize-new-instance"),
	).toEqual(scope);
	expect(await resolveOperatorProjectScope(freshSite, operator)).toEqual(scope);
	const projection = await env.DB.prepare(
		"SELECT instance_id, linked_by FROM site_operator_instances WHERE instance_slug = 'new-instance'",
	).first<{ instance_id: number; linked_by: string }>();
	expect(projection?.linked_by).toBe(operator.id);
	const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM projects WHERE instance_id = ?")
		.bind(projection!.instance_id)
		.first<{ count: number }>();
	expect(count?.count).toBe(2);
	await env.DB.prepare("UPDATE instances SET uri_scheme = 'renamed-legacy-display' WHERE id = ?")
		.bind(projection!.instance_id)
		.run();
	expect(await resolveOperatorProjectScope(freshSite, operator)).toMatchObject({
		production_project_ref: scope.production_project_ref,
		test_project_ref: scope.test_project_ref,
		instance: { uri_scheme: "renamed-legacy-display" },
	});
	const wrongSite = { ...siteEnv, SUPERBOARD_INSTANCE_ID: "other-instance" };
	await expect(resolveOperatorProjectScope(wrongSite, operator)).rejects.toThrow(
		"OPERATOR_PROJECT_SCOPE_UNAVAILABLE",
	);
});
