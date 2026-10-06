import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadTarget, root } from "../../../scripts/cloudflare/target.mjs";
import {
	assertProtectedBackupDirectory,
	backupPaths,
	createD1Backup,
	executeWranglerExport,
} from "../../../scripts/database/d1-backup.mjs";
import { d1Descriptor } from "../../../scripts/database/d1-registry.mjs";
import { targetWithoutResourceIds } from "../../fixtures/cloudflare/factories.mjs";

test("D1 backups restore FTS indexes and triggers without changing the source database", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-d1-fts-"));
	const source = new DatabaseSync(":memory:");
	const restored = new DatabaseSync(":memory:");
	try {
		source.exec(`CREATE TABLE documents(id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);
		CREATE VIRTUAL TABLE search USING fts5(body);
		CREATE TRIGGER documents_insert AFTER INSERT ON documents BEGIN
		INSERT INTO search(rowid,body) VALUES(new.id,new.body); END;
		INSERT INTO documents(body) VALUES('alpha text'),('beta text');
		UPDATE sqlite_sequence SET seq=100 WHERE name='documents';
		INSERT INTO search(search,rank) VALUES('rank','bm25(3.0)');
		CREATE TABLE payloads(id INTEGER, body TEXT, bytes BLOB);
		INSERT INTO payloads VALUES(9223372036854775806,'semi; quote '' and\r\nnewline',X'00ff80');
		CREATE TABLE parents(id TEXT);
		CREATE UNIQUE INDEX parents_id ON parents(id);
		CREATE TABLE children(parent TEXT REFERENCES parents(id));
		INSERT INTO parents VALUES('parent');
		INSERT INTO children VALUES('parent');`);
		const run = (_command, args) => {
			if (args.includes("execute")) {
				const sql = args[args.indexOf("--command") + 1];
				assert.match(sql, /^SELECT /u);
				return { status: 0, stdout: JSON.stringify([{ results: source.prepare(sql).all() }]) };
			}
			const tables = args.flatMap((arg, index) => (arg === "--table" ? [args[index + 1]] : []));
			if (!tables.length)
				return {
					status: 1,
					stderr: "D1 Export error: cannot export databases with virtual tables (like FTS5)",
				};
			const statements = [];
			for (const name of tables) {
				assert.notEqual(name, "search");
				const columns = source
					.prepare(`PRAGMA table_info("${name}")`)
					.all()
					.map(({ name: column }) => column);
				const values = source
					.prepare(
						`SELECT ${columns.map((column) => `quote("${column}") AS "${column}"`).join(",")} FROM "${name}"`,
					)
					.all();
				for (const row of values)
					statements.push(
						`INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES\n(${columns.map((column) => row[column]).join(",")});`,
					);
			}
			writeFileSync(args[args.indexOf("--output") + 1], statements.join("\n"));
			return { status: 0, stdout: "Download https://storage.example/?X-Amz-Signature=private" };
		};
		const result = await createD1Backup({
			descriptor: {
				target: "fixture",
				environment: "production",
				service: "site",
				databaseName: "site",
				databaseId: "fixture-id",
			},
			outputDirectory: directory,
			env: {},
			execute: (input) => executeWranglerExport(input, run),
		});
		restored.exec(await readFile(result.paths.sql, "utf8"));
		assert.equal(
			restored.prepare("SELECT count(*) AS count FROM search WHERE search MATCH 'alpha'").get()
				.count,
			1,
		);
		restored.exec("INSERT INTO documents(body) VALUES('gamma')");
		assert.equal(restored.prepare("SELECT id FROM documents WHERE body='gamma'").get().id, 101);
		assert.equal(
			restored.prepare("SELECT v FROM search_config WHERE k='rank'").get().v,
			"bm25(3.0)",
		);
		assert.deepEqual(
			restored.prepare("SELECT quote(id) AS id,body,hex(bytes) AS bytes FROM payloads").get(),
			source.prepare("SELECT quote(id) AS id,body,hex(bytes) AS bytes FROM payloads").get(),
		);
		assert.equal(
			restored.prepare("SELECT count(*) AS count FROM search WHERE search MATCH 'gamma'").get()
				.count,
			1,
		);
		assert.equal(source.prepare("SELECT count(*) AS count FROM documents").get().count, 2);
		assert.equal(
			source.prepare("SELECT count(*) AS count FROM search WHERE search MATCH 'alpha'").get().count,
			1,
		);
	} finally {
		source.close();
		restored.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test("D1 backups are protected, hashed and carry database ownership evidence", async () => {
	const directory = await mkdtemp(join(tmpdir(), "superboard-d1-backup-"));
	try {
		const { target: source } = await loadTarget("reference-production");
		const target = structuredClone(source);
		target.environments.production.moduleD1.support.id = "13171470-dfb5-46ce-b047-c9b151c34ae2";
		const descriptor = d1Descriptor(target, "reference-production", "production", "support");
		const now = new Date("2026-08-08T10:20:30.000Z");
		const result = await createD1Backup({
			descriptor,
			outputDirectory: directory,
			env: {},
			now,
			execute: async ({ output }) => writeFile(output, "-- D1 export\nSELECT 1;\n"),
		});
		assert.equal(result.receipt.service, "support");
		assert.equal(result.receipt.database.name, "superboard-support-v2-db");
		assert.equal(result.receipt.artifact.bytes, 23);
		assert.match(result.receipt.artifact.sha256, /^[a-f0-9]{64}$/u);
		assert.deepEqual(JSON.parse(await readFile(result.paths.receipt, "utf8")), result.receipt);
		assert.match(
			backupPaths(directory, descriptor, now).sql,
			/reference-production\/production\/support/u,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("D1 backups refuse repository paths and unprovisioned resources", async () => {
	assert.throws(
		() => assertProtectedBackupDirectory(resolve(root, "backups")),
		/inside the Git repository/u,
	);
	const { target: source } = await loadTarget("mbza-development");
	const target = targetWithoutResourceIds(source, "development");
	const descriptor = d1Descriptor(target, "mbza-development", "development", "identity");
	await assert.rejects(
		() =>
			createD1Backup({
				descriptor,
				outputDirectory: tmpdir(),
				env: {},
				execute: async () => {},
			}),
		/not provisioned/u,
	);
});
