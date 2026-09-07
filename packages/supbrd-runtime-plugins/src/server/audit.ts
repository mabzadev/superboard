import type { PluginSqlStore } from "./sql-store.js";

interface Head {
	sequence: number;
	hash: string;
}
interface Entry {
	sequence: number;
	operation_id: string;
	payload_json: string;
	previous_hash: string;
	hash: string;
	created_at: string;
}
const rootHash = "0".repeat(64);

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.toSorted(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
async function hash(value: string): Promise<string> {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
		(byte) => byte.toString(16).padStart(2, "0"),
	).join("");
}
async function head(store: PluginSqlStore, instance: string): Promise<Head> {
	return (
		(
			await store.all<Head>(
				"SELECT sequence,hash FROM superboard_audit_heads WHERE instance_id=?",
				[instance],
			)
		)[0] ?? { sequence: 0, hash: rootHash }
	);
}

export async function appendAuditEntry(
	store: PluginSqlStore,
	instance: string,
	operation: string,
	payload: unknown,
): Promise<void> {
	const encoded = canonical(payload);
	if (encoded.length > 65536) throw new Error("AUDIT_RECEIPT_TOO_LARGE");
	await store.batch([
		{
			sql: "INSERT INTO superboard_audit_heads(instance_id,sequence,hash) VALUES (?,0,?) ON CONFLICT DO NOTHING",
			values: [instance, rootHash],
		},
	]);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const existing = (
			await store.all<Entry>(
				"SELECT * FROM superboard_audit_entries WHERE instance_id=? AND operation_id=?",
				[instance, operation],
			)
		)[0];
		if (existing) {
			if (existing.payload_json !== encoded) throw new Error("AUDIT_OPERATION_CONFLICT");
			return;
		}
		const previous = await head(store, instance);
		const sequence = previous.sequence + 1;
		const checksum = await hash(canonical([instance, sequence, operation, previous.hash, encoded]));
		await store.batch([
			{
				sql: "INSERT INTO superboard_audit_entries(instance_id,sequence,operation_id,payload_json,previous_hash,hash,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM superboard_audit_heads WHERE instance_id=? AND sequence=? AND hash=?)",
				values: [
					instance,
					sequence,
					operation,
					encoded,
					previous.hash,
					checksum,
					new Date().toISOString(),
					instance,
					previous.sequence,
					previous.hash,
				],
			},
			{
				sql: "UPDATE superboard_audit_heads SET sequence=?,hash=? WHERE instance_id=? AND sequence=? AND hash=?",
				values: [sequence, checksum, instance, previous.sequence, previous.hash],
			},
		]);
	}
	const committed = (
		await store.all<Entry>(
			"SELECT * FROM superboard_audit_entries WHERE instance_id=? AND operation_id=?",
			[instance, operation],
		)
	)[0];
	if (committed) {
		if (committed.payload_json !== encoded) throw new Error("AUDIT_OPERATION_CONFLICT");
		return;
	}
	throw new Error("AUDIT_LEDGER_BUSY");
}

export async function verifyAuditLedger(store: PluginSqlStore, instance: string) {
	const target = await head(store, instance);
	let sequence = 0;
	let previousHash = rootHash;
	while (sequence < target.sequence) {
		const rows = await store.all<Entry>(
			"SELECT * FROM superboard_audit_entries WHERE instance_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT 100",
			[instance, sequence, target.sequence],
		);
		if (!rows.length) return { verified: false, entries: sequence, broken_sequence: sequence + 1 };
		for (const row of rows) {
			const expected = await hash(
				canonical([instance, row.sequence, row.operation_id, previousHash, row.payload_json]),
			);
			if (
				row.sequence !== sequence + 1 ||
				row.previous_hash !== previousHash ||
				row.hash !== expected
			)
				return { verified: false, entries: sequence, broken_sequence: sequence + 1 };
			previousHash = row.hash;
			sequence = row.sequence;
		}
	}
	return previousHash === target.hash
		? { verified: true, entries: sequence, head_hash: previousHash }
		: { verified: false, entries: sequence, broken_sequence: sequence };
}

export async function listAuditEntries(
	store: PluginSqlStore,
	instance: string,
	after = 0,
	search = "",
) {
	if (!Number.isSafeInteger(after) || after < 0 || search.length > 200)
		throw new Error("AUDIT_QUERY_INVALID");
	const rows = await store.all<Entry>(
		"SELECT * FROM superboard_audit_entries WHERE instance_id=? AND sequence>? AND (?='' OR instr(payload_json,?)>0 OR instr(operation_id,?)>0) ORDER BY sequence LIMIT 101",
		[instance, after, search, search, search],
	);
	return {
		items: rows
			.slice(0, 100)
			.map(({ payload_json, ...row }) => ({
				...row,
				payload: JSON.parse(payload_json) as unknown,
			})),
		next_cursor: rows.length > 100 ? rows[99].sequence : null,
	};
}

export async function archiveAuditLedger(
	store: PluginSqlStore,
	instance: string,
	archiveId: string,
	from: number,
	to: number,
) {
	if (
		!Number.isSafeInteger(from) ||
		!Number.isSafeInteger(to) ||
		from < 1 ||
		to < from ||
		to - from >= 1000
	)
		throw new Error("AUDIT_ARCHIVE_RANGE_INVALID");
	const result = await verifyAuditLedger(store, instance);
	if (!result.verified || to > result.entries) throw new Error("AUDIT_LEDGER_VERIFICATION_FAILED");
	const entries = await store.all<Entry>(
		"SELECT * FROM superboard_audit_entries WHERE instance_id=? AND sequence>=? AND sequence<=? ORDER BY sequence",
		[instance, from, to],
	);
	const payload = canonical(entries);
	const checksum = await hash(payload);
	await store.batch([
		{
			sql: "INSERT INTO superboard_audit_archives(instance_id,archive_id,from_sequence,to_sequence,payload_json,checksum,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(instance_id,archive_id) DO NOTHING",
			values: [instance, archiveId, from, to, payload, checksum, new Date().toISOString()],
		},
	]);
	const saved = (
		await store.all<{
			archive_id: string;
			from_sequence: number;
			to_sequence: number;
			checksum: string;
		}>(
			"SELECT archive_id,from_sequence,to_sequence,checksum FROM superboard_audit_archives WHERE instance_id=? AND archive_id=?",
			[instance, archiveId],
		)
	)[0];
	if (!saved || saved.checksum !== checksum) throw new Error("AUDIT_ARCHIVE_CONFLICT");
	return saved;
}
