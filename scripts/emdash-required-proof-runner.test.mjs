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
