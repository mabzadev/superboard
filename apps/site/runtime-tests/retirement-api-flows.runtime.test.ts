import { SELF, env, createExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";

import { dispatchLifecycleApi } from "./lifecycle-health-services.js";
import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-flows";
const file = "retirement-api-flows.runtime.test.ts";
type Items = { items: Array<Record<string, unknown>> };
test("canonical Flows APIs persist workflows, release versions, rotate real SDK keys and read actual SDK profiles", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/flows/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("flows");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = async <T>(id: string, path: string): Promise<T> =>
		(
			await jsonResult<{ data: T }>(
				await apiRead(plugin, id, { method: "GET", path: `${base}${path}` }),
			)
		).data;
	const project = (
		await jsonResult<{ data: { sdk_identifier: string } }>(
			await SELF.fetch(`https://site.example${base}/project`, { headers: apiHeaders }),
		)
	).data;
	const components = await read<Items>("components", "/components");
	expect(components.items).toContainEqual(
		expect.objectContaining({ key: "survey-popover", component_type: "BasicsV2SurveyPopover" }),
	);
	proveApi(
		plugin,
		"components",
		"read",
		file,
		components.items.map((item) => String(item.id)),
	);
	const environment = (
		await jsonResult<{ data: { id: string; key: string; sdk_key: string } }>(
			await command("create_environment", "POST", "/environments", {
				key: `proof-${crypto.randomUUID()}`,
				name: "Proof environment",
				kind: "test",
			}),
			201,
		)
	).data;
	const environments = await read<Items>("environments", "/environments");
	expect(environments.items).toContainEqual(
		expect.objectContaining({ id: environment.id, name: "Proof environment" }),
	);
	proveApi(plugin, "create_environment", "mutation", file, [environment.id]);
	proveApi(plugin, "environments", "read", file, [environment.id]);
	const sdk = (key: string) =>
		dispatchLifecycleApi(
			new Request("https://api.site.test/api/v1/flows/v2/sdk/blocks", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-superboard-flows-sdk-key": key },
				body: JSON.stringify({
					projectId: project.sdk_identifier,
					environment: environment.key,
					userId: "retirement-sdk-profile",
					language: "fr",
					userProperties: { country: "CH", platform: "web", name: "SDK profile" },
				}),
			}),
			{ ...env },
			createExecutionContext(),
		);
	const initialSdk = await sdk(environment.sdk_key);
	expect(initialSdk.status, await initialSdk.clone().text()).toBe(200);
	const rotated = (
		await jsonResult<{ data: { id: string; sdk_key: string } }>(
			await command("rotate_environment_key", "POST", `/environments/${environment.id}/rotate-key`),
		)
	).data;
	expect((await sdk(environment.sdk_key)).status).toBe(401);
	expect((await sdk(rotated.sdk_key)).status).toBe(200);
	proveApi(plugin, "rotate_environment_key", "mutation", file, [environment.id]);
	const users = await read<Items>("users", "/users");
	const user = users.items.find((item) => item.environment_id === environment.id);
	expect(user).toMatchObject({ locale: "fr", country: "CH", platform: "web" });
	expect(user?.user_id_hash).toMatch(/^[a-f0-9]{64}$/u);
	proveApi(plugin, "users", "read", file, [String(user!.user_id_hash)]);
	const details = await read<{ profiles: Array<Record<string, unknown>> }>(
		"user_details",
		`/users/${String(user!.user_id_hash)}`,
	);
	expect(details.profiles).toContainEqual(
		expect.objectContaining({
			external_user_id: "retirement-sdk-profile",
			properties: expect.objectContaining({ name: "SDK profile" }),
		}),
	);
	proveApi(plugin, "user_details", "read", file, [String(user!.user_id_hash)]);
	const localization = (
		await jsonResult<{ data: { id: string } }>(
			await command("save_localization", "PUT", "/localization", {
				name: "Swiss languages",
				default_locale: "fr",
				locales: ["fr", "en"],
				fallbacks: { de: "en" },
			}),
		)
	).data;
	const languages = await read<Items>("localization", "/localization");
	expect(languages.items).toContainEqual(
		expect.objectContaining({
			id: localization.id,
			locales: ["fr", "en"],
			fallbacks: { de: "en" },
		}),
	);
	proveApi(plugin, "save_localization", "mutation", file, [localization.id]);
	proveApi(plugin, "localization", "read", file, [localization.id]);
	const workflow = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_workflow", "POST", "/workflows", {
				identifier: `proof-${crypto.randomUUID()}`,
				name: "Proof workflow",
				frequency: "once",
			}),
			201,
		)
	).data;
	expect(
		await db.prepare("SELECT name FROM flow_workflows WHERE id=?").bind(workflow.id).first(),
	).toEqual({ name: "Proof workflow" });
	proveApi(plugin, "create_workflow", "mutation", file, [workflow.id]);
	await jsonResult(
		await command("update_workflow", "PUT", `/workflows/${workflow.id}`, {
			name: "Updated workflow",
		}),
	);
	const workflows = await read<Items>("workflows", "/workflows");
	expect(workflows.items).toContainEqual(
		expect.objectContaining({ id: workflow.id, name: "Updated workflow" }),
	);
	proveApi(plugin, "update_workflow", "mutation", file, [workflow.id]);
	proveApi(plugin, "workflows", "read", file, [workflow.id]);
	const version = (
		await jsonResult<{ data: { id: string } }>(
			await command("publish_workflow", "POST", `/workflows/${workflow.id}/publish`, {
				migration_strategy: "finish-current",
			}),
			201,
		)
	).data;
	expect(
		await db
			.prepare("SELECT workflow_id FROM flow_workflow_versions WHERE id=?")
			.bind(version.id)
			.first(),
	).toEqual({ workflow_id: workflow.id });
	proveApi(plugin, "publish_workflow", "mutation", file, [version.id]);
	const release = (
		await jsonResult<{ data: { migration_execution_id: string } }>(
			await command("activate_version", "POST", `/workflows/${workflow.id}/releases`, {
				environment_id: environment.id,
				version_id: version.id,
			}),
		)
	).data;
	const detail = await read<{
		releases: Array<Record<string, unknown>>;
		versions: Array<Record<string, unknown>>;
	}>("workflow", `/workflows/${workflow.id}`);
	expect(detail.versions).toContainEqual(expect.objectContaining({ id: version.id }));
	expect(detail.releases).toContainEqual(
		expect.objectContaining({
			environment_id: environment.id,
			workflow_version_id: version.id,
			active: 1,
		}),
	);
	expect(release.migration_execution_id).toBeTruthy();
	proveApi(plugin, "activate_version", "mutation", file, [
		workflow.id,
		version.id,
		release.migration_execution_id,
	]);
	proveApi(plugin, "workflow", "read", file, [workflow.id]);
	const overview = await read<{ counters: Record<string, number> }>("overview", "/overview");
	expect(overview.counters).toMatchObject({ workflows: 1, active_workflows: 1, users: 1 });
	proveApi(plugin, "overview", "read", file, [workflow.id, String(user!.user_id_hash)]);
});
