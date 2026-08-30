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
