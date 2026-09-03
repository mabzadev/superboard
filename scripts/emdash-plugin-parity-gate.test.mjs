import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const release = JSON.parse(
	readFileSync(new URL("../config/superboard-parity-release.json", import.meta.url), "utf8"),
);
const matrix = JSON.parse(
	readFileSync(new URL("../config/emdash-parity-matrix.json", import.meta.url), "utf8"),
);

void test("the parity matrix is bound to the exact active Front Release", () => {
	const activePluginIds = release.release.payload.plugin_lock
		.filter(({ plugin_id: pluginId }) => pluginId !== "supbrd-core")
		.map(({ plugin_id: pluginId }) => pluginId)
		.toSorted();

	assert.equal(matrix.release.content_checksum, release.release.content_checksum);
	assert.deepEqual(matrix.release.signature, release.release.signature);
	assert.equal(matrix.release.validation_set_checksum, release.release.validation_set_checksum);
	assert.deepEqual(
		matrix.release.validation_receipt_checksums,
		release.release.validation_receipts.map(({ receipt_checksum: checksum }) => checksum),
	);
	assert.equal(matrix.release.verification_status, "verified");
	assert.ok(release.release.validation_receipts.length > 0);
	assert.equal(matrix.release.release_id, release.release.payload.release_id);
	assert.equal(matrix.release.target_artifact_checksum, release.target_artifact_checksum);
	assert.deepEqual(matrix.release.active_plugin_ids, activePluginIds);
	assert.deepEqual(release.active_plugin_ids, activePluginIds);
});

void test("every active plugin surface has an executable release-derived parity row", () => {
	const releaseRows = matrix.rows.filter(
		({ release_id: releaseId }) => releaseId === release.release.payload.release_id,
	);
	const kinds = new Set(releaseRows.map(({ kind }) => kind));

	assert.deepEqual(
		kinds,
		new Set([
			"action",
			"api",
			"data_source",
			"dependency",
			"failure_state",
			"page",
			"renderer",
			"store",
			"submenu",
			"worker_health",
		]),
	);
	for (const pluginId of release.active_plugin_ids) {
		const pluginRows = releaseRows.filter(({ target }) => target === pluginId);
		assert.ok(pluginRows.length > 0, `missing release rows for ${pluginId}`);
		assert.ok(
			pluginRows.every(({ test: proof, proof_sha256: checksum }) => proof && checksum),
			`non-executable release row for ${pluginId}`,
		);
	}
});

void test("the release graph contains no route or submenu outside the generated matrix", () => {
	const pageRows = matrix.rows.filter(
		({ kind, release_id: releaseId }) =>
			kind === "page" && releaseId === release.release.payload.release_id,
	);
	const submenuRows = matrix.rows.filter(
		({ kind, release_id: releaseId }) =>
			kind === "submenu" && releaseId === release.release.payload.release_id,
	);
	const apiRows = matrix.rows.filter(
		({ kind, release_id: releaseId }) =>
			kind === "api" && releaseId === release.release.payload.release_id,
	);

	assert.deepEqual(
		pageRows.map(({ route_id: routeId }) => routeId).toSorted(),
		release.release.payload.front_route_manifest.routes
			.map(({ route_id: routeId }) => routeId)
			.toSorted(),
	);
	assert.deepEqual(
		submenuRows.map(({ route_id: routeId }) => routeId).toSorted(),
		release.release.payload.presentation.navigation
			.flatMap(({ items }) => items.map(({ route_id: routeId }) => routeId))
			.toSorted(),
	);
	assert.deepEqual(
		apiRows.map(({ gateway_route_id: routeId }) => routeId).toSorted(),
		release.release.payload.gateway_manifest.routes
			.map(({ route_id: routeId }) => routeId)
			.toSorted(),
	);
	const activePlugins = new Set(release.active_plugin_ids);
	const releasePaths = new Set(
		release.release.payload.front_route_manifest.routes.map(({ path_pattern: path }) => path),
	);
	const activeDashboardPaths = matrix.rows
		.filter(({ kind, target }) => kind === "dashboard" && activePlugins.has(target))
		.map(({ id }) =>
			id
				.slice("dashboard:".length)
				.replaceAll("[lang]", ":lang")
				.replaceAll("[id]", ":id")
				.replaceAll("[authId]", ":authId"),
		);
	assert.deepEqual(
		activeDashboardPaths.filter((path) => !releasePaths.has(path)),
		[],
		"an active Dashboard route is coded outside the Front Route Manifest",
	);
});
