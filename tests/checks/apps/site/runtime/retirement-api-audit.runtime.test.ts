import { env } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	apiCommand,
	apiRead,
	jsonResult,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plug-audit";
const file = "retirement-api-audit.runtime.test.ts";

test("canonical Audit APIs import technical facts, verify their chain and retain a readable archive", async () => {
	await prepareApiPlugin(plugin);
	const verified = await jsonResult<{
		data: { verified: boolean; entries: number; imported: number };
	}>(
		await apiCommand(plugin, "verify_ledger", {
			method: "POST",
			path: "/_emdash/api/superboard/audit/verify",
			body: {},
		}),
	);
	expect(verified.data.verified).toBe(true);
	expect(verified.data.entries).toBeGreaterThan(0);
	expect(verified.data.imported).toBeGreaterThan(0);
	const ledger = await jsonResult<{
		data: {
			items: Array<{
				sequence: number;
				operation_id: string;
				hash: string;
				payload: { plugin_id: string };
			}>;
		};
	}>(
		await apiRead(plugin, "ledger", {
			method: "GET",
			path: "/_emdash/api/superboard/audit/ledger",
		}),
	);
	expect(ledger.data.items.length).toBeGreaterThan(0);
	const entry = ledger.data.items[0]!;
	const persisted = await env.DB.prepare(
		"SELECT operation_id,hash FROM superboard_audit_entries WHERE instance_id=? AND sequence=?",
	)
		.bind(env.SUPERBOARD_INSTANCE_ID, entry.sequence)
		.first();
	expect(persisted).toEqual({ operation_id: entry.operation_id, hash: entry.hash });
	proveApi(plugin, "verify_ledger", "mutation", file, [entry.operation_id]);
	proveApi(plugin, "ledger", "read", file, [entry.operation_id]);
	const found = await jsonResult<{ data: { items: Array<{ operation_id: string }> } }>(
		await apiRead(plugin, "ledger_search", {
			method: "GET",
			path: `/_emdash/api/superboard/audit/ledger/search?search=${encodeURIComponent(entry.operation_id)}`,
		}),
	);
	expect(found.data.items.map((row) => row.operation_id)).toContain(entry.operation_id);
	proveApi(plugin, "ledger_search", "read", file, [entry.operation_id]);
	const archived = await jsonResult<{ data: { archive_id: string; checksum: string } }>(
		await apiCommand(plugin, "archive_ledger", {
			method: "POST",
			path: "/_emdash/api/superboard/audit/archives",
			body: { from_sequence: entry.sequence, to_sequence: entry.sequence },
		}),
		201,
	);
	const row = await env.DB.prepare(
		"SELECT archive_id,checksum,from_sequence,to_sequence FROM superboard_audit_archives WHERE archive_id=?",
	)
		.bind(archived.data.archive_id)
		.first();
	expect(row).toEqual({
		archive_id: archived.data.archive_id,
		checksum: archived.data.checksum,
		from_sequence: entry.sequence,
		to_sequence: entry.sequence,
	});
	proveApi(plugin, "archive_ledger", "mutation", file, [archived.data.archive_id]);
	const archives = await jsonResult<{
		data: { items: Array<{ archive_id: string; checksum: string }> };
	}>(
		await apiRead(plugin, "archives", {
			method: "GET",
			path: "/_emdash/api/superboard/audit/archives",
		}),
	);
	expect(archives.data.items).toContainEqual(expect.objectContaining(archived.data));
	proveApi(plugin, "archives", "read", file, [archived.data.archive_id]);
});
