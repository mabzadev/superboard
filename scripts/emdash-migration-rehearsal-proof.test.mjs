import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMigrationRehearsalProof } from "./emdash-migration-rehearsal-proof.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("the isolated Store migration rehearsal is deterministic and non-destructive", async () => {
	const proof = await buildMigrationRehearsalProof();
	assert.equal(proof.source.count, 2);
	assert.deepEqual(proof.source, proof.target);
	assert.equal(proof.double_import_upsert_calls, 1);
	assert.equal(proof.resumed_without_write, true);
	assert.equal(proof.reverse_delta_replayable, true);
	assert.equal(proof.rollback_blocked, false);
	assert.deepEqual(proof.deletes, []);
	assert.equal(JSON.stringify(proof.shadow_metric).includes("payload_json"), false);
	assert.match(proof.receipt_checksum, CHECKSUM_PATTERN);
});
