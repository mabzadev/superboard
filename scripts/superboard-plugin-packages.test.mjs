import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildPluginPackages, lintPluginPackageProject } from "./superboard-plugin-packages.mjs";

const topology = JSON.parse(
	readFileSync(new URL("../config/emdash-plugin-topology.json", import.meta.url), "utf8"),
);

test("seven installable business packages retain every component contract and store", () => {
	const catalog = buildPluginPackages(topology);
	assert.equal(catalog.plugins.filter((plugin) => plugin.kind === "business").length, 7);
	assert.equal(catalog.plugins.filter((plugin) => plugin.kind === "application").length, 1);
	assert.equal(catalog.plugins.filter((plugin) => plugin.kind === "core").length, 1);
	const originals = topology.plugins.filter(({ manifest }) => !manifest.plugin_id.includes("*"));
	assert.deepEqual(
		catalog.plugins.flatMap((plugin) => plugin.components).sort(),
		originals.map(({ manifest }) => manifest.plugin_id).sort(),
	);
	for (const collection of ["stores", "schemas", "renderers", "commands", "data_sources"]) {
		const key = {
			stores: "store_id",
			schemas: "schema_id",
			renderers: "renderer_id",
			commands: "command_id",
			data_sources: "data_source_id",
		}[collection];
		assert.deepEqual(
			catalog.plugins
				.flatMap(({ manifest }) => manifest[collection].map((item) => item[key]))
				.sort(),
			originals.flatMap(({ manifest }) => manifest[collection].map((item) => item[key])).sort(),
		);
	}
	for (const plugin of catalog.plugins) {
		for (const store of plugin.manifest.stores)
			assert.equal(store.authority, plugin.manifest.plugin_id);
	}
});

test("one component change updates its package artifact and preserves unrelated packages", () => {
	const before = buildPluginPackages(topology);
	const changed = structuredClone(topology);
	changed.plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-files",
	).manifest.settings.schema.properties.max_upload_bytes.maximum += 1;
	const after = buildPluginPackages(changed);
	for (const plugin of before.plugins) {
		const updated = after.plugins.find(
			({ manifest }) => manifest.plugin_id === plugin.manifest.plugin_id,
		);
		if (plugin.components.includes("supbrd-plugmod-files"))
			assert.notEqual(updated.manifest.artifact_checksum, plugin.manifest.artifact_checksum);
		else assert.equal(updated.manifest.artifact_checksum, plugin.manifest.artifact_checksum);
	}
});

test("unknown component ownership fails instead of silently dropping its functionality", () => {
	const changed = structuredClone(topology);
	changed.plugins.push({
		manifest: { ...changed.plugins[0].manifest, plugin_id: "supbrd-plug-unassigned" },
	});
	assert.throws(() => buildPluginPackages(changed), /UNASSIGNED_COMPONENT/);
});

test("lint blocks a stale package catalogue and a restored standalone component entrypoint", () => {
	const root = mkdtempSync(join(tmpdir(), "superboard-package-lint-"));
	try {
		const catalog = buildPluginPackages(topology);
		mkdirSync(join(root, "config"));
		const entries = join(root, "packages/supbrd-runtime-plugins/src/entries");
		mkdirSync(entries, { recursive: true });
		writeFileSync(join(root, "config/emdash-plugin-topology.json"), JSON.stringify(topology));
		writeFileSync(join(root, "config/superboard-plugin-catalog.json"), JSON.stringify(catalog));
		for (const name of [
			"front-catalog",
			...catalog.plugins.map(({ manifest }) => manifest.plugin_id),
		])
			writeFileSync(join(entries, `${name}.ts`), "");
		expectClean();
		writeFileSync(join(entries, "supbrd-plugmod-flows.ts"), "");
		assert.equal(lintPluginPackageProject(root)[0].message, "PLUGIN_PACKAGE_ENTRYPOINTS_INVALID");
		rmSync(join(entries, "supbrd-plugmod-flows.ts"));
		catalog.plugins[0].manifest.commands.pop();
		writeFileSync(join(root, "config/superboard-plugin-catalog.json"), JSON.stringify(catalog));
		assert.equal(lintPluginPackageProject(root)[0].message, "PLUGIN_PACKAGE_CATALOG_STALE");
		function expectClean() {
			assert.deepEqual(lintPluginPackageProject(root), []);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
