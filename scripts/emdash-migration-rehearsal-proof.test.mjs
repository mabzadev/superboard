import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMigrationRehearsalProof } from "./emdash-migration-rehearsal-proof.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("every declared Store has deterministic source/target and non-destructive evidence", () => {
	const proof = buildMigrationRehearsalProof();
	assert.ok(proof.stores.length > 0);
	assert.equal(proof.store_count, proof.stores.length);
	for (const store of proof.stores) {
		assert.deepEqual(store.source, store.target);
		assert.equal(store.source.count, 1);
		assert.match(store.source.checksum, CHECKSUM_PATTERN);
		assert.match(store.sample_checksum, CHECKSUM_PATTERN);
		assert.equal(store.reverse_delta, "replayable_without_deletes");
		assert.equal(store.rollback, "non_destructive");
	}
	assert.equal(proof.public_cutover, false);
	assert.match(proof.receipt_checksum, CHECKSUM_PATTERN);
});
