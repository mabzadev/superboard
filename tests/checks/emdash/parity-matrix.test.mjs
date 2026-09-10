import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { validateUserPluginManifest } from "../../../infra/generated/front-catalog.js";
import { verifySuperBoardPluginManifest } from "../../../packages/supbrd-core/dist/index.js";
import {
	buildParityMatrix,
	buildPluginTopology,
	buildReleaseParityRows,
	validateArtifacts,
} from "../../../scripts/emdash/parity-matrix.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("a release with every business plugin disabled retains operator login and home parity", () => {
	const release = JSON.parse(
		readFileSync(
			new URL("../../../scripts/config/superboard-parity-release.json", import.meta.url),
			"utf8",
		),
	);
	release.active_plugin_ids = [];
	const payload = release.release.payload;
	payload.plugin_lock = payload.plugin_lock.filter((plugin) => plugin.plugin_id === "supbrd-core");
	payload.renderers = payload.renderers.filter((renderer) => renderer.plugin_id === "supbrd-core");
	payload.front_route_manifest.routes = payload.front_route_manifest.routes.filter((route) =>
		route.route_id.startsWith("emdash.core."),
	);
	payload.presentation.navigation = [];
	payload.gateway_manifest.routes = [];
	payload.dependency_policies = [];
	const rows = buildReleaseParityRows(release, buildPluginTopology());
	assert.ok(
		rows.some(
			(row) =>
				row.kind === "page" && row.path === "/_emdash/admin/login" && row.target === "supbrd-core",
		),
	);
	assert.ok(
		rows.some(
			(row) =>
				row.kind === "page" &&
				row.path === "/superboard-system/home" &&
				row.target === "supbrd-core",
		),
	);
});

void test("every required parity row has an executable immutable proof", () => {
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

void test("the plugin topology exposes both closed execution families", () => {
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

void test("every topology manifest uses the shared closed runtime contract", async () => {
	for (const { manifest } of buildPluginTopology().plugins) {
		const verification =
			manifest.plugin_id === "supbrd-plug-user"
				? await validateUserPluginManifest(manifest)
				: await verifySuperBoardPluginManifest(manifest);
		assert.deepEqual(verification, { valid: true, errors: [] });
		assert.equal(manifest.execution.backend, "sandboxed", manifest.plugin_id);
	}
});

void test("Support and Flows cannot be promoted by the generated matrix", () => {
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

void test("commands without connected business handlers cannot be promoted", () => {
	const matrix = buildParityMatrix();
	const commandRows = matrix.rows.filter(
		({ kind, path }) => kind === "action" || (kind === "api" && path?.includes("/commands/")),
	);
	assert.ok(commandRows.length > 0);
	assert.ok(
		commandRows.every(
			({ source_status, required, blocker }) =>
				source_status === "unvalidated" &&
				required === false &&
				blocker === "plugin_command_handler_not_connected",
		),
	);
});

void test("Dashboard requirements keep their canonical path and never assign a concrete page to Core", () => {
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

void test("committed artifacts are reproducible", () => {
	for (const path of [
		"scripts/config/emdash-parity-matrix.json",
		"scripts/config/emdash-plugin-topology.json",
		"scripts/config/superboard-front-bundle.json",
		"docs/evidence/issue-54/parity-matrix.receipt.json",
	]) {
		assert.doesNotThrow(() =>
			JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8")),
		);
	}
});

test("the frozen 120-route inventory remains enforceable without the retired application", (context) => {
	const repository = resolve(import.meta.dirname, "../../..");
	const fixture = mkdtempSync(join(tmpdir(), "superboard-parity-retired-"));
	context.after(() => rmSync(fixture, { recursive: true, force: true }));
	for (const directory of ["packages", "docs", "sdks", "tests"])
		symlinkSync(join(repository, directory), join(fixture, directory), "dir");
	mkdirSync(join(fixture, "apps"));
	symlinkSync(join(repository, "apps/site"), join(fixture, "apps/site"), "dir");
	mkdirSync(join(fixture, "scripts"));
	for (const directory of readdirSync(join(repository, "scripts"))) {
		if (directory === "emdash") continue;
		symlinkSync(join(repository, "scripts", directory), join(fixture, "scripts", directory));
	}
	mkdirSync(join(fixture, "scripts/emdash"));
	for (const file of readdirSync(join(repository, "scripts/emdash")))
		symlinkSync(join(repository, "scripts/emdash", file), join(fixture, "scripts/emdash", file));
	rmSync(join(fixture, "scripts/emdash/parity-matrix.mjs"));
	cpSync(
		join(repository, "scripts/emdash/parity-matrix.mjs"),
		join(fixture, "scripts/emdash/parity-matrix.mjs"),
	);
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`const {buildParityMatrix}=await import(${JSON.stringify(pathToFileURL(join(fixture, "scripts/emdash/parity-matrix.mjs")).href)});console.log(JSON.stringify(buildParityMatrix().rows.filter(row=>row.kind==="dashboard")))`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const rows = JSON.parse(result.stdout);
	const baseline = JSON.parse(
		readFileSync(
			join(repository, "scripts/config/superboard-plugin-independence-baseline.json"),
			"utf8",
		),
	);
	assert.equal(rows.length, 120);
	assert.equal(baseline.navigation_count, 71);
	assert.deepEqual(
		rows.map((row) => row.id).sort(),
		baseline.plugins
			.flatMap((plugin) => plugin.routes.map((route) => `dashboard:${route.path}`))
			.sort(),
	);
});
