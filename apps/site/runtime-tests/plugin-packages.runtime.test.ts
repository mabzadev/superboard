import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, expect, test } from "vitest";

import {
	migratePluginPackages,
	packageActionComponents,
	setPluginFeaturePreference,
	syncInstalledPluginPackages,
} from "../src/lib/plugin-package-state.js";

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

test("migration keeps disabled functions and re-enabling a package does not enable them", async () => {
	await migratePluginPackages(env.DB, scope, [onboarding, flows]);
	const action = await packageActionComponents(env.DB, scope, {
		packageId: "supbrd-plug-journeys",
		action: "enable",
		targetComponents: [onboarding, flows],
	});
	expect(action.components).toEqual([onboarding]);
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
	).toEqual([onboarding]);
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

test("a function change is scoped to its instance and checks package ownership", async () => {
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
	const components = ["supbrd-plug-products", "supbrd-plugmod-billing", "supbrd-plugmod-paywalls"];
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
