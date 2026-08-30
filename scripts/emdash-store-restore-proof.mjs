import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
	createD1LogicalSnapshot,
	createIsolatedRestoreProof,
	restoreD1LogicalSnapshot,
	snapshotObjectStores,
} from "./emdash-store-restore.mjs";

export function buildIsolatedStoreRestoreProof() {
	const source = new DatabaseSync(":memory:");
	source.exec(`
		CREATE TABLE documents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
		INSERT INTO documents VALUES ('doc-a','alpha migration'),('doc-b','beta restore');
		CREATE VIRTUAL TABLE documents_fts USING fts5(id UNINDEXED, body);
		INSERT INTO documents_fts SELECT * FROM documents;
	`);
	const d1Snapshot = createD1LogicalSnapshot(source, {
		tables: [
			{
				name: "documents",
				create_sql:
					"CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL)",
				order_by: ["id"],
			},
		],
		fts: [
			{
				name: "documents_fts",
				create_sql:
					"CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(id UNINDEXED, body)",
				source_table: "documents",
				columns: ["id", "body"],
			},
		],
	});
	const objectSnapshot = snapshotObjectStores({
		r2: new Map([["attachments/doc-a.txt", Buffer.from("attachment")]]),
		kv: new Map([["release:pointer", "release-1"]]),
	});
	const restored = new DatabaseSync(":memory:");
	restoreD1LogicalSnapshot(restored, d1Snapshot);
	return createIsolatedRestoreProof({
		d1Snapshot,
		restoredDb: restored,
		objectSnapshot,
		objectTargets: { r2: new Map(), kv: new Map() },
		search: { table: "documents_fts", query: "alpha" },
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const proof = buildIsolatedStoreRestoreProof();
	if (process.argv.includes("--write")) {
		const path = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../docs/evidence/issue-54/isolated-store-restore.receipt.json",
		);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
	}
	console.log(JSON.stringify(proof));
}
