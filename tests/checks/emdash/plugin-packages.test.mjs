import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	buildPluginPackages,
	lintPluginPackageProject,
} from "../../../scripts/emdash/plugin-packages.mjs";

const topology = JSON.parse(
	readFileSync(
		new URL("../../../scripts/config/emdash-plugin-topology.json", import.meta.url),
		"utf8",
	),
);

test("every package declares canonical contributions while preserving its legacy contract", () => {
	const catalog = buildPluginPackages(topology);
	for (const plugin of catalog.plugins) {
		const manifest = plugin.canonical_manifest;
		assert.ok(manifest, plugin.directory);
		assert.equal(manifest.plugin_id, plugin.directory);
		assert.ok(
			Object.keys(manifest.settings.schema.properties).every((key) =>
				key.startsWith(`${plugin.directory}.setting.`),
			),
		);
		assert.ok(
			manifest.settings.schema.required.every((key) =>
				Object.hasOwn(manifest.settings.schema.properties, key),
			),
		);
		for (const [collection, key] of [
			["commands", "command_id"],
			["data_sources", "data_source_id"],
			["renderers", "renderer_id"],
		]) {
			assert.equal(manifest[collection].length, plugin.manifest[collection].length);
			assert.equal(
				new Set(manifest[collection].map((entry) => entry[key])).size,
				manifest[collection].length,
			);
			assert.ok(
				manifest[collection].every((entry) => entry[key].startsWith(`${plugin.directory}.`)),
			);
		}
	}
	const acquisition = catalog.plugins.find(
		(plugin) => plugin.directory === "superboard-acquisition",
	);
	assert.ok(
		acquisition.canonical_manifest.commands.some(
			(command) => command.command_id === "superboard-acquisition.command.create_workflow",
		),
	);
	assert.ok(
		acquisition.canonical_manifest.renderers.some(
			(renderer) => renderer.renderer_id === "superboard-acquisition.renderer.flows_admin_surface",
		),
	);
});

test("seven installable business packages retain every component contract and store", () => {
	const catalog = buildPluginPackages(topology);
	assert.equal(catalog.plugins.filter((plugin) => plugin.kind === "business").length, 7);
	assert.equal(catalog.plugins.filter((plugin) => plugin.kind === "application").length, 0);
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
		mkdirSync(join(root, "scripts/config"), { recursive: true });
		const entries = join(root, "packages/plugins");
		mkdirSync(entries, { recursive: true });
		writeFileSync(
			join(root, "scripts/config/emdash-plugin-topology.json"),
			JSON.stringify(topology),
		);
		writeFileSync(
			join(root, "scripts/config/superboard-plugin-catalog.json"),
			JSON.stringify(catalog),
		);
		for (const { directory } of catalog.plugins) {
			mkdirSync(join(entries, directory, "src"), { recursive: true });
			writeFileSync(join(entries, directory, "src/index.ts"), "");
		}
		expectClean();
		mkdirSync(join(entries, "supbrd-plugmod-flows"));
		assert.equal(lintPluginPackageProject(root)[0].message, "PLUGIN_PACKAGE_ENTRYPOINTS_INVALID");
		rmSync(join(entries, "supbrd-plugmod-flows"), { recursive: true });
		catalog.plugins[0].manifest.commands.pop();
		writeFileSync(
			join(root, "scripts/config/superboard-plugin-catalog.json"),
			JSON.stringify(catalog),
		);
		assert.equal(lintPluginPackageProject(root)[0].message, "PLUGIN_PACKAGE_CATALOG_STALE");
		function expectClean() {
			assert.deepEqual(lintPluginPackageProject(root), []);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
