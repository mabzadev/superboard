import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";

import { proxyOperatorApiRequest } from "../../../../../apps/site/src/lib/operator-api-proxy.js";
import {
	migratePluginPackages,
	packageActionComponents,
	syncInstalledPluginPackages,
} from "../../../../../apps/site/src/lib/plugin-package-state.js";

declare global {
	namespace Cloudflare {
		interface Env {
			PACKAGE_MIGRATIONS: D1Migration[];
		}
	}
}

const scope = { instance_id: "package-test", target: "local" as const };
const onboarding = "supbrd-plugmod-onboardings";
const flows = "supbrd-plugmod-flows";

test("SDK catalogue access follows Settings activation without requiring Observability", async () => {
	let dispatched = 0;
	const request = (path = "/api/v1/platform/libraries", role = 50) =>
		proxyOperatorApiRequest({
			request: new Request(`https://site.example.test${path}`),
			operator: { id: "catalogue-operator", role },
			env: {
				DB: env.DB,
				SUPERBOARD_INSTANCE_ID: scope.instance_id,
				SUPERBOARD_ENVIRONMENT: scope.target,
				SITE_OPERATOR_BRIDGE_TOKEN: "test-catalogue-bridge",
				API_SERVICE: {
					fetch: async () => {
						dispatched++;
						return Response.json({ data: { libraries: [] } });
					},
				},
			},
		});
	expect((await request()).status).toBe(404);
	expect(dispatched).toBe(0);
	await env.DB.prepare(
		"INSERT INTO superboard_plugin_lifecycle (instance_id,target,plugin_id,artifact_checksum,state,state_changed_at) SELECT ?,?,'supbrd-plug-settings',artifact_checksum,'active',? FROM superboard_plugin_manifest_artifacts WHERE plugin_id='supbrd-plug-settings' LIMIT 1",
	)
		.bind(scope.instance_id, scope.target, new Date().toISOString())
		.run();
	expect((await request()).status).toBe(200);
	expect((await request("/api/v1/platform/libraries/")).status).toBe(200);
	expect((await request("/api/v1/platform/status")).status).toBe(404);
	expect((await request("/api/v1/platform/libraries-other")).status).toBe(404);
	expect((await request("/api/v1/platform/libraries", 1)).status).toBe(403);
	expect(dispatched).toBe(2);
});

beforeEach(async () => {
	await applyD1Migrations(env.DB, env.PACKAGE_MIGRATIONS);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS options (name TEXT PRIMARY KEY,value TEXT NOT NULL)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS _plugin_state (plugin_id TEXT PRIMARY KEY,version TEXT NOT NULL,status TEXT NOT NULL,installed_at TEXT,activated_at TEXT,deactivated_at TEXT,source TEXT NOT NULL)",
	);
	await env.DB.batch([
		env.DB.prepare("DELETE FROM superboard_plugin_lifecycle"),
		env.DB.prepare("DELETE FROM superboard_plugin_packages"),
		env.DB.prepare("DELETE FROM superboard_plugin_feature_preferences"),
		env.DB.prepare("DELETE FROM superboard_plugin_package_migrations"),
		env.DB.prepare("DELETE FROM options"),
		env.DB.prepare("DELETE FROM _plugin_state"),
	]);
	for (const [id, state] of [
		[onboarding, "active"],
		[flows, "disabled"],
	]) {
		await env.DB.prepare(
			"INSERT INTO superboard_plugin_lifecycle (instance_id,target,plugin_id,artifact_checksum,state,state_changed_at) SELECT ?,?,?,artifact_checksum,?,? FROM superboard_plugin_manifest_artifacts WHERE plugin_id = ? LIMIT 1",
		)
			.bind(scope.instance_id, scope.target, id, state, "2026-09-09T00:00:00Z", id)
			.run();
	}
});

test("enabling a package includes all deployed functions despite legacy disabled preferences", async () => {
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	const action = await packageActionComponents(env.DB, scope, {
		packageId: "supbrd-plug-journeys",
		action: "enable",
		targetComponents: [onboarding, flows],
	});
	expect(action.components).toEqual([onboarding, flows]);
	const packages = await syncInstalledPluginPackages(env.DB, scope);
	expect(packages.find((row) => row.plugin_id === "supbrd-plug-journeys")?.status).toBe("active");
	expect(
		packages.find((row) => row.plugin_id === "supbrd-plugmod-reference-production"),
	).toBeUndefined();
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state='disabled' WHERE instance_id=? AND target=?",
	)
		.bind(scope.instance_id, scope.target)
		.run();
	expect(
		(
			await packageActionComponents(env.DB, scope, {
				packageId: onboarding,
				action: "enable",
				targetComponents: [onboarding, flows],
			})
		).components,
	).toEqual([onboarding, flows]);
});

test("migration and retries preserve settings in their existing storage", async () => {
	const original = "plugin:supbrd-plugmod-flows:settings:max_concurrent_runs";
	const destination =
		"plugin:supbrd-plug-journeys:settings:supbrd-plugmod-flows__max_concurrent_runs";
	await env.DB.prepare("INSERT INTO options(name,value) VALUES (?,?)").bind(original, "4").run();
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	expect(
		await env.DB.prepare("SELECT value FROM options WHERE name=?").bind(destination).first("value"),
	).toBeNull();
	await env.DB.prepare("UPDATE options SET value='8' WHERE name=?").bind(original).run();
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	expect(
		await env.DB.prepare("SELECT value FROM options WHERE name=?").bind(destination).first("value"),
	).toBeNull();
	expect(
		await env.DB.prepare("SELECT value FROM options WHERE name=?").bind(original).first("value"),
	).toBe("8");
});

test("package selection respects the deployment and rejects individual function actions", async () => {
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	await setPluginFeaturePreference(env.DB, scope, flows, true);
	expect(
		(
			await packageActionComponents(env.DB, scope, {
				packageId: "supbrd-plug-journeys",
				action: "enable",
				targetComponents: [onboarding, flows],
			})
		).components,
	).toEqual([onboarding, flows]);
	await expect(
		packageActionComponents(env.DB, scope, {
			packageId: "supbrd-plug-journeys",
			featureId: flows,
			action: "disable",
			targetComponents: [onboarding, flows],
		}),
	).rejects.toThrow("PLUGIN_FEATURE_NOT_FOUND");

	await expect(
		packageActionComponents(env.DB, scope, {
			packageId: "supbrd-plug-commerce",
			featureId: flows,
			action: "enable",
			targetComponents: [flows],
		}),
	).rejects.toThrow("PLUGIN_FEATURE_NOT_FOUND");
	await expect(
		packageActionComponents(env.DB, scope, {
			packageId: "supbrd-core",
			action: "disable",
			targetComponents: [],
		}),
	).rejects.toThrow("CORE_COMPONENT_REQUIRED");
	await expect(
		packageActionComponents(env.DB, scope, {
			packageId: "supbrd-plugmod-reference-production",
			action: "enable",
			targetComponents: [onboarding],
		}),
	).rejects.toThrow("PLUGIN_NOT_FOUND");
	const other = { ...scope, instance_id: "another-instance" };
	await migratePluginPackages(env.DB, other, [onboarding]);
	expect(
		(
			await packageActionComponents(env.DB, other, {
				packageId: "supbrd-plug-journeys",
				action: "enable",
				targetComponents: [onboarding],
			})
		).components,
	).toEqual([onboarding]);
});

test("a first installation selects declared functions without treating availability as an explicit disable", async () => {
	const components = ["supbrd-plug-products", "supbrd-plugmod-billing"];
	await migratePluginPackages(env.DB, scope, components);
	expect(
		(
			await packageActionComponents(env.DB, scope, {
				packageId: "supbrd-plug-commerce",
				action: "enable",
				targetComponents: components,
			})
		).components,
	).toEqual(components);
});

test("Acquisition includes transferred functions despite legacy activation preferences", async () => {
	const paywalls = "supbrd-plugmod-paywalls";
	const links = "supbrd-plugmod-dynamic-links";
	await env.DB.prepare(
		"INSERT INTO superboard_plugin_package_migrations (instance_id,target,migration_id,completed_at) VALUES (?,?,'packages-v1',?)",
	)
		.bind(scope.instance_id, scope.target, new Date().toISOString())
		.run();
	await setPluginFeaturePreference(env.DB, scope, paywalls, false);
	await setPluginFeaturePreference(env.DB, scope, links, true);
	expect(await migratePluginPackages(env.DB, scope, [paywalls, links])).toBe(true);
	const selected = await packageActionComponents(env.DB, scope, {
		packageId: "supbrd-plug-journeys",
		action: "enable",
		targetComponents: [paywalls, links],
	});
	expect(selected.components).toEqual([paywalls, links]);
	for (const [packageId, featureId] of [
		["supbrd-plug-commerce", paywalls],
		["supbrd-plug-communication", links],
	])
		await expect(
			packageActionComponents(env.DB, scope, {
				packageId: packageId!,
				featureId,
				action: "enable",
				targetComponents: [paywalls, links],
			}),
		).rejects.toThrow("PLUGIN_FEATURE_NOT_FOUND");
	expect(await migratePluginPackages(env.DB, scope, [paywalls, links])).toBe(false);
});

test("resuming before the completion receipt preserves changed feature preferences", async () => {
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	await setPluginFeaturePreference(env.DB, scope, flows, true);
	await env.DB.prepare(
		"DELETE FROM superboard_plugin_package_migrations WHERE instance_id=? AND target=?",
	)
		.bind(scope.instance_id, scope.target)
		.run();
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	expect(
		(
			await packageActionComponents(env.DB, scope, {
				packageId: "supbrd-plug-journeys",
				action: "enable",
				targetComponents: [onboarding, flows],
			})
		).components,
	).toEqual([onboarding, flows]);
});

test("unregistered application packages are not built into the platform", async () => {
	const component = "supbrd-plugmod-example";
	await migratePluginPackages(env.DB, scope, [component]);
	await expect(
		packageActionComponents(env.DB, scope, {
			packageId: component,
			action: "enable",
			targetComponents: [component],
		}),
	).rejects.toThrow("PLUGIN_NOT_FOUND");
});

async function setPluginFeaturePreference(
	db: D1Database,
	preferenceScope: typeof scope,
	componentId: string,
	enabled: boolean,
) {
	await db
		.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_feature_preferences (instance_id,target,component_id,enabled,updated_at) VALUES (?,?,?,?,?)",
		)
		.bind(
			preferenceScope.instance_id,
			preferenceScope.target,
			componentId,
			Number(enabled),
			new Date().toISOString(),
		)
		.run();
}

test("canonical product identifiers select every component of the same package", async () => {
	const selection = await packageActionComponents(env.DB, scope, {
		packageId: "superboard-acquisition",
		action: "enable",
		targetComponents: [onboarding, flows],
	});
	expect(selection.components).toEqual([onboarding, flows]);
});
