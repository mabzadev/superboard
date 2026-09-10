import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import { createExecutionContext, env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import appWorker from "../../../../../packages/plugins/supbrd-core/app/src/index.js";
import { dispatchLifecycleApi } from "./lifecycle-health-services.js";
import {
	apiHeaders,
	apiCommand,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
} from "./retirement-api-helpers.js";

test("an App-owned rotated key authenticates the real SDK gateway and rejects revoked keys and mismatched scope", async () => {
	const scope = await prepareApiPlugin("supbrd-plug-user");
	await prepareApiPlugin("supbrd-plug-settings");
	const api = pluginDatabase("api");
	const before = await api
		.prepare("SELECT api_key FROM instances WHERE id=?")
		.bind(scope.instance.id)
		.first<{ api_key: string }>();
	const domains = { production: "native-sdk.example", test: "test-sdk.example" };
	for (const [ref, domain] of [
		[scope.production_project_ref, domains.production],
		[scope.test_project_ref, domains.test],
	])
		await jsonResult(
			await apiCommand("supbrd-plug-settings", "save_sdk_configuration", {
				method: "PUT",
				path: `/api/v1/app/projects/${ref}/setup/web`,
				body: {
					domain,
					minimum_version: "1.0.0",
					recommended_version: "1.0.0",
					maintenance_enabled: false,
				},
			}),
		);
	const rotate = async (ref: string) =>
		jsonResult<{ data: { id: string; secret: string } }>(
			await SELF.fetch(`https://site.example/api/v1/app/projects/${ref}/access-key/rotate`, {
				method: "POST",
				headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
				body: "{}",
			}),
		);
	const sdk = (key: string, environment = "production", identifier = domains.production) =>
		dispatchLifecycleApi(
			new Request("https://api.site.test/api/v1/app/runtime-policy", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"PROJECT-KEY": key,
					PLATFORM: "web",
					IDENTIFIER: identifier,
					ENVIRONMENT: environment,
				},
				body: JSON.stringify({ app_version: "1.0.0" }),
			}),
			{ ...env },
			createExecutionContext(),
		);
	const first = await rotate(scope.production_project_ref);
	expect(first.data.secret).toMatch(/^og_app_/u);
	const accepted = await sdk(first.data.secret);
	expect(accepted.status, accepted.status === 200 ? undefined : await accepted.clone().text()).toBe(
		200,
	);
	expect(await accepted.json()).toMatchObject({ data: { status: "operational", platform: "web" } });
	expect((await sdk(first.data.secret, "test")).status).toBe(403);
	expect((await sdk(first.data.secret, "production", domains.test)).status).toBe(403);
	const testing = await rotate(scope.test_project_ref);
	expect((await sdk(testing.data.secret, "test", domains.test)).status).toBe(200);
	expect((await sdk(testing.data.secret, "production", domains.test)).status).toBe(403);
	const second = await rotate(scope.production_project_ref);
	expect((await sdk(first.data.secret)).status).toBe(403);
	expect((await sdk(second.data.secret)).status).toBe(200);
	const foreignInstance = await api
		.prepare("INSERT INTO instances (uri_scheme, api_key) VALUES (?, ?) RETURNING id")
		.bind(`foreign-${crypto.randomUUID()}`, crypto.randomUUID())
		.first<{ id: number }>();
	expect(foreignInstance).toBeTruthy();
	const foreignProject = await api
		.prepare(
			"INSERT INTO projects (instance_id,is_test,name,identifier) VALUES (?,0,?,?) RETURNING id",
		)
		.bind(foreignInstance!.id, "Foreign SDK fixture", crypto.randomUUID())
		.first<{ id: number }>();
	expect(foreignProject).toBeTruthy();
	const appEnv = { ...env, DB: pluginDatabase("app"), INTERNAL_API_TOKEN: "runtime-module-secret" };
	const foreignRequest = async (method: string, path: string, body: unknown) => {
		const headers = await createProjectContextHeaders(
			{
				module: "app",
				projectId: foreignProject!.id,
				instanceId: foreignInstance!.id,
				projectRef: `${foreignInstance!.id}-prod`,
				environment: "production",
				role: "owner",
				actorId: 1,
				requestId: crypto.randomUUID(),
				issuedAt: Math.floor(Date.now() / 1000),
				method,
				pathname: path,
			},
			"runtime-module-secret",
		);
		headers.set("Content-Type", "application/json");
		headers.set("Idempotency-Key", crypto.randomUUID());
		return appWorker.fetch(
			new Request(`https://app.internal${path}`, { method, headers, body: JSON.stringify(body) }),
			appEnv as never,
			createExecutionContext(),
		);
	};
	await jsonResult(
		await foreignRequest("PUT", "/internal/v1/setup/web", {
			domain: domains.production,
			minimum_version: "1.0.0",
			recommended_version: "1.0.0",
			maintenance_enabled: false,
		}),
	);
	const foreignKey = await jsonResult<{ data: { id: string; secret: string } }>(
		await foreignRequest("POST", "/internal/v1/access-key/rotate", {}),
	);
	expect((await sdk(foreignKey.data.secret)).status).toBe(403);
	const foreignStored = await pluginDatabase("app")
		.prepare("SELECT project_id,revoked_at FROM access_keys WHERE id=?")
		.bind(foreignKey.data.id)
		.first();
	expect(foreignStored).toEqual({ project_id: String(foreignProject!.id), revoked_at: null });
	const lookup = (token: string, identifier: string) =>
		appWorker.fetch(
			new Request("https://app.internal/internal/v1/sdk-credentials/resolve", {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Internal-Token": token },
				body: JSON.stringify({ key: second.data.secret, platform: "web", identifier }),
			}),
			appEnv as never,
			createExecutionContext(),
		);
	expect((await lookup("", domains.production)).status).toBe(401);
	expect((await lookup("wrong-token", domains.production)).status).toBe(401);
	expect(
		(await lookup("runtime-module-secret", `https://${domains.production}/unexpected`)).status,
	).toBe(403);
	expect(
		(await lookup("runtime-module-secret", `https://${domains.production.toUpperCase()}/`)).status,
	).toBe(200);
	const stored = await pluginDatabase("app")
		.prepare("SELECT key_hash,revoked_at FROM access_keys WHERE id=?")
		.bind(first.data.id)
		.first<{ key_hash: string; revoked_at: string }>();
	expect(stored?.revoked_at).toBeTruthy();
	expect(stored?.key_hash).not.toBe(first.data.secret);
	const after = await api
		.prepare("SELECT api_key FROM instances WHERE id=?")
		.bind(scope.instance.id)
		.first<{ api_key: string }>();
	expect(after?.api_key === before?.api_key).toBe(true);
	expect(
		await api
			.prepare("SELECT COUNT(*) count FROM instances WHERE api_key=?")
			.bind(second.data.secret)
			.first(),
	).toEqual({ count: 0 });
});
