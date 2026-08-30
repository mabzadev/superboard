import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMigrationRehearsalProof } from "./emdash-migration-rehearsal-proof.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;

test("every declared Store has deterministic source/target and non-destructive evidence", async () => {
	const proof = await buildMigrationRehearsalProof();
	assert.ok(proof.stores.length > 0);
	assert.equal(proof.store_count, proof.stores.length);
	for (const store of proof.stores) {
		assert.deepEqual(store.fixture_source, store.fixture_target);
		assert.match(store.fixture_source.checksum, CHECKSUM_PATTERN);
		assert.match(store.schema_proof.checksum, CHECKSUM_PATTERN);
		assert.match(store.runtime_proof.checksum, CHECKSUM_PATTERN);
		if (store.migration_kind === "source_to_target") {
			assert.ok(store.entity_ids.length > 0);
			assert.ok(store.fixture_source.count > 0);
			assert.notEqual(store.deterministic_sample, null);
			assert.match(store.sample_checksum, CHECKSUM_PATTERN);
			assert.equal(store.double_import, "passed");
			assert.equal(store.checkpoint_resume, "passed");
			assert.equal(store.shadow_read, "passed");
			assert.equal(store.reverse_delta, "replayable_without_deletes");
		} else {
			assert.equal(store.migration_kind, "new_empty_store");
		}
		assert.equal(store.rollback, "non_destructive");
	}
	assert.equal(proof.public_cutover, false);
	assert.match(proof.receipt_checksum, CHECKSUM_PATTERN);
});
