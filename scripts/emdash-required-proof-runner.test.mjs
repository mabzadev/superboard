import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildRequiredProofPlan } from "./emdash-required-proof-runner.mjs";

const matrix = JSON.parse(
	readFileSync(new URL("../config/emdash-parity-matrix.json", import.meta.url), "utf8"),
);

void test("every required matrix proof belongs to an executable gate step", () => {
	const required = new Set(
		matrix.rows.filter(({ required: isRequired }) => isRequired).map(({ test: proof }) => proof),
	);
	const planned = buildRequiredProofPlan(matrix).flatMap(({ proofs }) => proofs);

	assert.deepEqual(new Set(planned), required);
	assert.equal(planned.length, required.size);
});

void test("Worker health proofs complete before the Site Instance consumes their receipts", () => {
	const plan = buildRequiredProofPlan(matrix);
	const siteIndex = plan.findIndex(({ name }) => name === "Site runtime Instance");
	assert.ok(siteIndex > 0);
	const workerProofs = matrix.rows
		.filter(
			({ kind, required, test: proof }) =>
				kind === "worker_health" &&
				required &&
				proof !== "apps/site/runtime-tests/plugin-parity-instance.runtime.test.ts",
		)
		.map(({ test: proof }) => proof);
	for (const proof of workerProofs) {
		const proofIndex = plan.findIndex(({ proofs }) => proofs.includes(proof));
		assert.ok(proofIndex >= 0 && proofIndex < siteIndex, proof);
	}
	assert.equal(
		matrix.rows.find(({ id }) => id === "release:worker-health:supbrd-plugmod-billing")?.test,
		"workers/billing/runtime-tests/billing-authority.runtime.test.ts",
	);
});
