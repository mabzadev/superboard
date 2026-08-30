import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { buildIsolatedStoreRestoreProof } from "./emdash-store-restore-proof.mjs";
import {
	createD1LogicalSnapshot,
	createIsolatedRestoreProof,
	restoreD1LogicalSnapshot,
	snapshotObjectStores,
} from "./emdash-store-restore.mjs";

const CHECKSUM_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CHECKSUM_MISMATCH_PATTERN = /checksum mismatch/u;

const contract = {
	tables: [
		{
			name: "documents",
			create_sql: "CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
			order_by: ["id"],
		},
	],
	fts: [
		{
			name: "documents_fts",
			create_sql: "CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(id UNINDEXED, body)",
			source_table: "documents",
			columns: ["id", "body"],
		},
	],
};

test("restores D1 with FTS5 and R2/KV into isolated stores", () => {
	const source = new DatabaseSync(":memory:");
	source.exec(
		`${contract.tables[0].create_sql}; INSERT INTO documents VALUES ('a','alpha migration'),('b','beta'); ${contract.fts[0].create_sql}; INSERT INTO documents_fts SELECT * FROM documents;`,
	);
	const d1Snapshot = createD1LogicalSnapshot(source, contract);
	const objectSnapshot = snapshotObjectStores({
		r2: new Map([["attachments/a.txt", Buffer.from("attachment")]]),
		kv: new Map([["release:pointer", "release-1"]]),
	});
	const restored = new DatabaseSync(":memory:");
	const checkpoint = restoreD1LogicalSnapshot(restored, d1Snapshot);
	assert.deepEqual(checkpoint.completed_tables, ["documents"]);
	restoreD1LogicalSnapshot(restored, d1Snapshot, checkpoint);
	const proof = createIsolatedRestoreProof({
		d1Snapshot,
		restoredDb: restored,
		objectSnapshot,
		objectTargets: { r2: new Map(), kv: new Map() },
		search: { table: "documents_fts", query: "alpha" },
	});
	assert.deepEqual(proof.counts, { documents: 2 });
	assert.equal(proof.fts_matches, 1);
	assert.equal(proof.r2_count, 1);
	assert.equal(proof.kv_count, 1);
	assert.equal(proof.production_mutated, false);
	assert.match(proof.receipt_checksum, CHECKSUM_PATTERN);
});

test("fails closed when an immutable snapshot is changed", () => {
	const source = new DatabaseSync(":memory:");
	source.exec(`${contract.tables[0].create_sql}; INSERT INTO documents VALUES ('a','alpha');`);
	const snapshot = createD1LogicalSnapshot(source, contract);
	snapshot.tables[0].rows[0].body = "tampered";
	assert.throws(
		() => restoreD1LogicalSnapshot(new DatabaseSync(":memory:"), snapshot),
		CHECKSUM_MISMATCH_PATTERN,
	);
});

test("the isolated restore proof is deterministic", () => {
	assert.deepEqual(buildIsolatedStoreRestoreProof(), buildIsolatedStoreRestoreProof());
});
