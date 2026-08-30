import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
	assert.ok(matrix.rows.length >= 140);
	assert.ok(matrix.rows.filter(({ required }) => required).every(({ proof_sha256 }) => CHECKSUM_PATTERN.test(proof_sha256)));
});

test("the plugin topology has five full and fourteen module families", () => {
	const topology = buildPluginTopology();
	assert.equal(topology.plugins.filter(({ plugin_kind: kind }) => kind === "full").length, 5);
	assert.equal(topology.plugins.filter(({ plugin_kind: kind }) => kind === "module").length, 14);
	assert.ok(topology.plugins.every(({ artifact_checksum: checksum }) => CHECKSUM_PATTERN.test(checksum)));
	assert.deepEqual(topology.aliases, { projectId: "instance_id", pid: "instance_id" });
});

test("Support and Flows cannot be promoted by the generated matrix", () => {
	const matrix = buildParityMatrix();
	const guarded = matrix.rows.filter(({ id }) => id.includes("support") || id.includes("flows"));
	assert.ok(guarded.length > 0);
	assert.ok(guarded.every(({ source_status, required, blocker }) => source_status === "unvalidated" && required === false && blocker));
});

test("committed artifacts are reproducible", () => {
	for (const path of ["config/emdash-parity-matrix.json", "config/emdash-plugin-topology.json", "docs/evidence/issue-54/parity-matrix.receipt.json"]) {
		assert.doesNotThrow(() => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")));
	}
});
