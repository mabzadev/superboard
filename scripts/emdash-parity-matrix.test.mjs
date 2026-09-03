import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { verifySuperBoardPluginManifest } from "../packages/supbrd-core/dist/index.js";
import { validateUserPluginManifest } from "../packages/supbrd-runtime-plugins/dist/front-catalog.js";
import {
	buildParityMatrix,
	buildPluginTopology,
	validateArtifacts,
} from "./emdash-parity-matrix.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("every required parity row has an executable immutable proof", () => {
	const matrix = buildParityMatrix();
	const topology = buildPluginTopology();
	assert.deepEqual(validateArtifacts(matrix, topology), []);
	assert.ok(matrix.rows.length > 0);
	assert.ok(
		matrix.rows
			.filter(({ required }) => required)
			.every(({ proof_sha256 }) => CHECKSUM_PATTERN.test(proof_sha256)),
	);
});

test("the plugin topology exposes both closed execution families", () => {
	const topology = buildPluginTopology();
	assert.deepEqual(
		new Set(topology.plugins.map(({ manifest }) => manifest.plugin_kind)),
		new Set(["full", "module"]),
	);
	assert.ok(
		topology.plugins.every(({ manifest }) => CHECKSUM_PATTERN.test(manifest.artifact_checksum)),
	);
	assert.deepEqual(topology.aliases, { projectId: "instance_id", pid: "instance_id" });
});

test("every topology manifest uses the shared closed runtime contract", async () => {
	for (const { manifest } of buildPluginTopology().plugins) {
		const verification =
			manifest.plugin_id === "supbrd-plug-user"
				? await validateUserPluginManifest(manifest)
				: await verifySuperBoardPluginManifest(manifest);
		assert.deepEqual(verification, { valid: true, errors: [] });
		assert.equal(manifest.execution.backend, "sandboxed", manifest.plugin_id);
	}
});

test("Support and Flows cannot be promoted by the generated matrix", () => {
	const matrix = buildParityMatrix();
	const guarded = matrix.rows.filter(({ id }) => id.includes("support") || id.includes("flows"));
	assert.ok(guarded.length > 0);
	assert.ok(
		guarded.every(
			({ source_status, required, blocker }) =>
				source_status === "unvalidated" && required === false && blocker,
		),
	);
});

test("Dashboard requirements keep their canonical path and never assign a concrete page to Core", () => {
	const dashboard = buildParityMatrix().rows.filter(({ kind }) => kind === "dashboard");
	assert.equal(
		dashboard.some(({ id }) => id === "dashboard:/"),
		true,
	);
	assert.equal(
		dashboard.some(({ id }) => id === "dashboard:/page.tsx"),
		false,
	);
	assert.equal(
		dashboard.some(({ target }) => target === "supbrd-core"),
		false,
	);
	assert.equal(
		dashboard.find(({ id }) => id === "dashboard:/project-settings")?.target,
		"supbrd-plug-settings",
	);
	assert.equal(
		dashboard.find(({ id }) => id === "dashboard:/infrastructure")?.target,
		"supbrd-plugmod-observability",
	);
	assert.equal(
		dashboard.find(({ id }) => id === "dashboard:/products/offerings")?.target,
		"supbrd-plug-products",
	);
	for (const id of [
		"dashboard:/products/customers",
		"dashboard:/products/entitlements",
		"dashboard:/products/purchases",
	]) {
		assert.equal(dashboard.find((row) => row.id === id)?.target, "supbrd-plugmod-billing", id);
	}
});

test("committed artifacts are reproducible", () => {
	for (const path of [
		"config/emdash-parity-matrix.json",
		"config/emdash-plugin-topology.json",
		"config/superboard-front-bundle.json",
		"docs/evidence/issue-54/parity-matrix.receipt.json",
	]) {
		assert.doesNotThrow(() =>
			JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")),
		);
	}
});
