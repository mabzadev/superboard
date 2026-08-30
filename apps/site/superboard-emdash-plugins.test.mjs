import assert from "node:assert/strict";
import test from "node:test";

import topology from "../../config/emdash-plugin-topology.json" with { type: "json" };
import {
	SUPERBOARD_PLUGIN_TEMPLATES,
	superboardConfiguredPlugins,
} from "./superboard-emdash-plugins.mjs";

test("adapts every concrete SuperBoard manifest into one configured EmDash plugin", () => {
	const concrete = topology.plugins.filter(({ manifest }) => !manifest.plugin_id.includes("*"));
	assert.equal(superboardConfiguredPlugins.length, 18);
	assert.deepEqual(
		superboardConfiguredPlugins.map(({ id }) => id).toSorted(),
		concrete.map(({ manifest }) => manifest.plugin_id).toSorted(),
	);
	assert.equal(
		superboardConfiguredPlugins.find(({ id }) => id === "supbrd-plug-user")?.version,
		"1.3.0",
	);
	assert.deepEqual(SUPERBOARD_PLUGIN_TEMPLATES, ["supbrd-plugmod-custom-*"]);
	assert.ok(superboardConfiguredPlugins.every(({ id }) => !id.includes("*")));
});

test("does not register a module whose Worker descriptor is not ready", () => {
	const readyModuleIds = topology.plugins
		.filter(
			({ manifest, worker_descriptor: descriptor }) =>
				manifest.plugin_kind === "module" && descriptor?.deployment_status === "ready",
		)
		.map(({ manifest }) => manifest.plugin_id)
		.toSorted();
	assert.deepEqual(
		superboardConfiguredPlugins
			.filter(({ id }) => id.startsWith("supbrd-plugmod-"))
			.map(({ id }) => id)
			.toSorted(),
		readyModuleIds,
	);
});

test("registers the canonical settings, Admin page and functional contract for every plugin", () => {
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
			superboardConfiguredPlugins.find(({ id }) => id === "supbrd-plug-user")?.settingsSchema ?? {},
		).toSorted(),
		["allow_anonymous_upgrade", "max_active_sessions", "mfa_policy"],
	);
});
