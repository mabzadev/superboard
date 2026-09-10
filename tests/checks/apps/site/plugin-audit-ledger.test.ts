import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { expect, test } from "vitest";

import {
	appendAuditEntry,
	archiveAuditLedger,
	verifyAuditLedger,
} from "../../../../packages/plugins/supbrd-core/src/audit.js";
import type { PluginSqlStore } from "../../../../packages/supbrd-core/src/plugin-sql-store.js";

test("Audit verifies persisted receipts, preserves history in archives, and detects corruption", async () => {
	const db = new DatabaseSync(":memory:");
	db.exec(
		readFileSync(
			new URL("../../../../apps/site/migrations/0023_plugin_audit_ledger.sql", import.meta.url),
			"utf8",
		),
	);
	const store: PluginSqlStore = {
		all: async <T>(sql: string, values: readonly (string | number | null)[]) =>
			db.prepare(sql).all(...values) as T[],
		batch: async (statements) => {
			db.exec("BEGIN");
			try {
				for (const { sql, values } of statements) db.prepare(sql).run(...values);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
	};
	try {
		await appendAuditEntry(store, "instance-a", "operation-a", {
			status: "completed",
			response_checksum: "receipt-a",
		});
		await appendAuditEntry(store, "instance-a", "operation-b", {
			status: "failed",
			response_checksum: "receipt-b",
		});
		await appendAuditEntry(store, "instance-a", "operation-a", {
			status: "completed",
			response_checksum: "receipt-a",
		});
		expect(await verifyAuditLedger(store, "instance-a")).toMatchObject({
			verified: true,
			entries: 2,
		});
		expect(await verifyAuditLedger(store, "instance-b")).toMatchObject({
			verified: true,
			entries: 0,
		});
		const archive = await archiveAuditLedger(store, "instance-a", "archive-a", 1, 2);
		expect(archive).toMatchObject({ from_sequence: 1, to_sequence: 2 });
		expect(await archiveAuditLedger(store, "instance-a", "archive-a", 1, 2)).toEqual(archive);
		expect(
			db.prepare("SELECT COUNT(*) AS total FROM superboard_audit_entries").get(),
		).toMatchObject({ total: 2 });
		expect(() => db.exec("DELETE FROM superboard_audit_entries")).toThrow("immutable");
		db.exec("DROP TRIGGER superboard_audit_entries_immutable_update");
		db.prepare("UPDATE superboard_audit_entries SET payload_json=? WHERE sequence=1").run(
			'{"status":"forged"}',
		);
		expect(await verifyAuditLedger(store, "instance-a")).toMatchObject({
			verified: false,
			broken_sequence: 1,
		});
	} finally {
		db.close();
	}
});

test("Audit reports success when a competing writer wins the first seven attempts", async () => {
	const db = new DatabaseSync(":memory:");
	db.exec(
		readFileSync(
			new URL("../../../../apps/site/migrations/0023_plugin_audit_ledger.sql", import.meta.url),
			"utf8",
		),
	);
	const store: PluginSqlStore = {
		all: async <T>(sql: string, values: readonly (string | number | null)[]) =>
			db.prepare(sql).all(...values) as T[],
		batch: async (statements) => {
			db.exec("BEGIN");
			try {
				for (const statement of statements) db.prepare(statement.sql).run(...statement.values);
				db.exec("COMMIT");
			} catch (error) {
				db.exec("ROLLBACK");
				throw error;
			}
		},
	};
	let competingWrites = 0;
	const concurrent: PluginSqlStore = {
		...store,
		batch: async (statements) => {
			if (
				statements[0]?.sql.startsWith("INSERT INTO superboard_audit_entries") &&
				competingWrites < 7
			)
				await appendAuditEntry(store, "concurrent-instance", `competing-${competingWrites++}`, {
					source: "other writer",
				});
			await store.batch(statements);
		},
	};
	try {
		await expect(
			appendAuditEntry(concurrent, "concurrent-instance", "requested-receipt", {
				status: "completed",
			}),
		).resolves.toBeUndefined();
		expect(await verifyAuditLedger(store, "concurrent-instance")).toMatchObject({
			verified: true,
			entries: 8,
		});
		expect(
			db
				.prepare(
					"SELECT COUNT(*) AS count FROM superboard_audit_entries WHERE operation_id='requested-receipt'",
				)
				.get(),
		).toMatchObject({ count: 1 });
	} finally {
		db.close();
	}
});
