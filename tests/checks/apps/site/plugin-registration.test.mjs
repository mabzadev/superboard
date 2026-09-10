import assert from "node:assert/strict";
import test from "node:test";

import {
	SUPERBOARD_PLUGIN_TEMPLATES,
	configureSuperBoardPlugins,
	superboardConfiguredPlugins,
} from "../../../../apps/site/superboard-emdash-plugins.mjs";
import topology from "../../../../scripts/config/emdash-plugin-topology.json" with { type: "json" };
import catalog from "../../../../scripts/config/superboard-plugin-catalog.json" with { type: "json" };

void test("registers business packages and the core instead of independent component plugins", () => {
	const concrete = catalog.plugins;
	assert.deepEqual(
		superboardConfiguredPlugins.map(({ id }) => id).toSorted(),
		concrete.map(({ manifest }) => manifest.plugin_id).toSorted(),
	);
	assert.equal(
		superboardConfiguredPlugins.find(({ id }) => id === "supbrd-plug-identity")?.version,
		"2.0.0",
	);
	assert.deepEqual(SUPERBOARD_PLUGIN_TEMPLATES, ["supbrd-plugmod-custom-*"]);
	assert.ok(superboardConfiguredPlugins.every(({ id }) => !id.includes("*")));
});

void test("keeps a module available in the catalog while its Worker is not ready", () => {
	const module = topology.plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-analytics",
	);
	const configured = configureSuperBoardPlugins([
		{
			...module,
			worker_descriptor: { ...module.worker_descriptor, deployment_status: "not_ready" },
		},
	]);
	assert.deepEqual(
		configured.map(({ id }) => id),
		["supbrd-plugmod-analytics"],
	);
});

void test("registers the canonical settings, Admin page and functional contract for every plugin", () => {
	for (const plugin of superboardConfiguredPlugins) {
		assert.equal(plugin.format, "standard", `${plugin.id} is not sandbox-compatible`);
		assert.equal(plugin.adminEntry, undefined, `${plugin.id} exposes a trusted React Admin entry`);
		assert.ok(plugin.adminPages?.length, `${plugin.id} is missing its Admin page`);
		assert.ok(Object.keys(plugin.settingsSchema ?? {}).length, `${plugin.id} has no settings`);
		assert.ok(plugin.superboardManifest, `${plugin.id} is missing its SuperBoard manifest`);
		assert.ok(plugin.superboardManifest.commands.length, `${plugin.id} has no commands`);
		assert.ok(plugin.superboardManifest.data_sources.length, `${plugin.id} has no data sources`);
		assert.ok(plugin.routes.includes("admin"), `${plugin.id} has no Block Kit Admin route`);
		assert.ok(plugin.routes.includes("health"), `${plugin.id} has no health route`);
	}
	assert.deepEqual(
		Object.keys(
			superboardConfiguredPlugins.find(({ id }) => id === "supbrd-plug-identity")?.settingsSchema ??
				{},
		).toSorted(),
		[
			"supbrd-plug-user__allow_anonymous_upgrade",
			"supbrd-plug-user__max_active_sessions",
			"supbrd-plug-user__mfa_policy",
		],
	);
});
