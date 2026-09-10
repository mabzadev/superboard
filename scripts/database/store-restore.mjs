import { createHash } from "node:crypto";

const SQLITE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;

export function createD1LogicalSnapshot(db, contract) {
	const tables = contract.tables.map(({ name, create_sql: createSql, order_by: orderBy }) => ({
		name,
		create_sql: createSql,
		rows: db.prepare(`SELECT * FROM "${identifier(name)}" ORDER BY ${orderBy.map((column) => `"${identifier(column)}"`).join(", ")}`).all(),
	}));
	const fts = contract.fts.map(({ name, create_sql: createSql, source_table: sourceTable, columns }) => ({
		name,
		create_sql: createSql,
		source_table: sourceTable,
		columns,
	}));
	const payload = { schema_version: 1, tables, fts };
	return { ...payload, checksum: checksum(payload) };
}

export function restoreD1LogicalSnapshot(db, snapshot, checkpoint = { completed_tables: [] }) {
	assertChecksum(snapshot);
	const completed = new Set(checkpoint.completed_tables);
	for (const table of snapshot.tables) {
		if (completed.has(table.name)) continue;
		db.exec(table.create_sql);
		for (const row of table.rows) upsertRow(db, table.name, row);
		completed.add(table.name);
		checkpoint.completed_tables = [...completed];
	}
	for (const definition of snapshot.fts) {
		db.exec(definition.create_sql);
		db.exec(`DELETE FROM "${identifier(definition.name)}"`);
		const columns = definition.columns.map((column) => `"${identifier(column)}"`).join(", ");
		db.exec(`INSERT INTO "${identifier(definition.name)}" (${columns}) SELECT ${columns} FROM "${identifier(definition.source_table)}"`);
	}
	return checkpoint;
}

export function snapshotObjectStores({ r2, kv }) {
	const payload = {
		schema_version: 1,
		r2: Array.from(r2.entries(), ([key, bytes]) => ({ key, value_base64: Buffer.from(bytes).toString("base64") })).toSorted((a, b) => a.key.localeCompare(b.key)),
		kv: Array.from(kv.entries(), ([key, value]) => ({ key, value })).toSorted((a, b) => a.key.localeCompare(b.key)),
	};
	return { ...payload, checksum: checksum(payload) };
}

export function restoreObjectStores(snapshot, targets) {
	assertChecksum(snapshot);
	for (const object of snapshot.r2) targets.r2.set(object.key, Buffer.from(object.value_base64, "base64"));
	for (const entry of snapshot.kv) targets.kv.set(entry.key, entry.value);
	return {
		r2_count: targets.r2.size,
		kv_count: targets.kv.size,
		r2_checksum: checksum(Array.from(targets.r2, ([key, value]) => ({ key, value_base64: Buffer.from(value).toString("base64") })).toSorted((a, b) => a.key.localeCompare(b.key))),
		kv_checksum: checksum(Array.from(targets.kv, ([key, value]) => ({ key, value })).toSorted((a, b) => a.key.localeCompare(b.key))),
	};
}

export function createIsolatedRestoreProof({ d1Snapshot, restoredDb, objectSnapshot, objectTargets, search }) {
	assertChecksum(d1Snapshot);
	const objectReceipt = restoreObjectStores(objectSnapshot, objectTargets);
	const counts = Object.fromEntries(d1Snapshot.tables.map(({ name }) => [name, Number(restoredDb.prepare(`SELECT COUNT(*) count FROM "${identifier(name)}"`).get().count)]));
	const ftsMatches = Number(restoredDb.prepare(`SELECT COUNT(*) count FROM "${identifier(search.table)}" WHERE "${identifier(search.table)}" MATCH ?`).get(search.query).count);
	const payload = {
		schema_version: 1,
		environment: "isolated_local_restore",
		d1_snapshot_checksum: d1Snapshot.checksum,
		object_snapshot_checksum: objectSnapshot.checksum,
		counts,
		fts_matches: ftsMatches,
		...objectReceipt,
		production_mutated: false,
	};
	return { ...payload, receipt_checksum: checksum(payload) };
}

function upsertRow(db, table, row) {
	const columns = Object.keys(row);
	const names = columns.map((column) => `"${identifier(column)}"`).join(", ");
	const placeholders = columns.map(() => "?").join(", ");
	db.prepare(`INSERT OR REPLACE INTO "${identifier(table)}" (${names}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
}

function assertChecksum(value) {
	const { checksum: expected, ...payload } = value;
	if (checksum(payload) !== expected) throw new Error("Snapshot checksum mismatch");
}

function identifier(value) {
	if (!SQLITE_IDENTIFIER_PATTERN.test(value)) throw new Error("Unsafe SQLite identifier");
	return value;
}

function checksum(value) {
	return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).toSorted().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}
