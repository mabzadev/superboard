import { env } from "cloudflare:test";
import { expect, test } from "vitest";

import { createCmsApi } from "./retirement-api-cms.js";
import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plug-settings";
const file = "retirement-api-settings.runtime.test.ts";
test("canonical Settings APIs retain changed values, versions and verified SDK configuration", async () => {
	const scope = await prepareApiPlugin(plugin);
	const cms = await createCmsApi();
	try {
		const name = `API proof ${crypto.randomUUID()}`;
		const settingsPath = "/_emdash/api/admin/plugins/supbrd-plug-settings/settings";
		await jsonResult(
			await cms.command(plugin, "update_effective_settings", {
				method: "PUT",
				path: settingsPath,
				body: { values: { site_name: name } },
			}),
		);
		const effective = await jsonResult<{ data: { values: Record<string, unknown> } }>(
			await cms.read(plugin, "effective_settings", { method: "GET", path: settingsPath }),
		);
		expect(effective.data.values.site_name).toBe(name);
		const versions = await jsonResult<{
			data: {
				items: Array<{ id: string; values: Record<string, unknown>; changed_keys: string[] }>;
			};
		}>(
			await cms.read(plugin, "settings_versions", {
				method: "GET",
				path: "/_emdash/api/superboard/settings/versions",
			}),
		);
		const version = versions.data.items.find((row) => row.values.site_name === name)!;
		expect(version).toBeDefined();
		expect(version.changed_keys).toContain("site_name");
		const saved = await env.DB.prepare(
			"SELECT values_json FROM _emdash_plugin_setting_versions WHERE id=? AND plugin_id=?",
		)
			.bind(version.id, plugin)
			.first<{ values_json: string }>();
		expect(JSON.parse(saved!.values_json).site_name).toBe(name);
		for (const [id, scenario] of [
			["update_effective_settings", "mutation"],
			["effective_settings", "read"],
			["settings_versions", "read"],
		] as const)
			proveApi(plugin, id, scenario, file, [version.id]);
		const path = `/api/v1/app/projects/${scope.production_project_ref}/setup/ios`;
		const bundle = `com.example.proof${crypto.randomUUID().replaceAll("-", "")}`;
		await jsonResult(
			await apiCommand(plugin, "save_sdk_configuration", {
				method: "PUT",
				path,
				body: {
					bundle_id: bundle,
					team_id: "PROOFTEAM12",
					minimum_version: "1.0.0",
					recommended_version: "1.1.0",
					maintenance_enabled: false,
				},
			}),
		);
		const configured = await pluginDatabase("app")
			.prepare(
				"SELECT id,status FROM sdk_configurations WHERE json_extract(configuration_json,'$.bundle_id')=?",
			)
			.bind(bundle)
			.first<{ id: string; status: string }>();
		expect(configured?.status).toBe("configured");
		proveApi(plugin, "save_sdk_configuration", "mutation", file, [configured!.id]);
		await jsonResult(
			await apiCommand(plugin, "test_sdk_configuration", {
				method: "POST",
				path: `${path}/test`,
				body: {},
			}),
		);
		const checked = await pluginDatabase("app")
			.prepare("SELECT status,verified_at FROM sdk_configurations WHERE id=?")
			.bind(configured!.id)
			.first<{ status: string; verified_at: string }>();
		expect(checked?.status).toBe("verified");
		expect(checked?.verified_at).toBeTruthy();
		proveApi(plugin, "test_sdk_configuration", "mutation", file, [configured!.id]);
		const read = await jsonResult<{
			data: { status: string; configuration: { bundle_id: string } };
		}>(await apiRead(plugin, "sdk_configurations", { method: "GET", path }));
		expect(read.data).toMatchObject({ status: "verified", configuration: { bundle_id: bundle } });
		proveApi(plugin, "sdk_configurations", "read", file, [configured!.id]);
	} finally {
		await cms.close();
	}
});
