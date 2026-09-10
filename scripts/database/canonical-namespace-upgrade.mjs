import { statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const renamedMigrations = new Map([
	["0010", "0010_superboard_identity.sql"],
	["0011", "0011_superboard_billing_audit.sql"],
]);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function planCanonicalNamespaceUpgrade(database) {
	const tables = new Set(
		database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map(({ name }) => name),
	);
	const statements = [];
	if (!tables.has("d1_migrations")) return statements;
	const applied = database
		.prepare("SELECT name FROM d1_migrations")
		.all()
		.map(({ name }) => name);
	for (const [sequence, canonical] of renamedMigrations) {
		const previous = applied.filter(
			(name) => name.startsWith(`${sequence}_`) && name !== canonical,
		);
		if (previous.length > 1 || (previous.length && applied.includes(canonical)))
			throw new Error(`Ambiguous migration history at ${sequence}`);
		if (!previous.length) continue;
		if (sequence === "0011" && tables.has("billing_mirror_comparisons")) {
			const columns = database
				.prepare("PRAGMA table_info(billing_mirror_comparisons)")
				.all()
				.map(({ name }) => name);
			const canonicalColumn = "superboard_active_entitlements";
			const previousPrefix = previous[0].slice("0011_".length, -"_billing_audit.sql".length);
			const candidates = columns.filter((name) => name === `${previousPrefix}_active_entitlements`);
			if (!columns.includes(canonicalColumn)) {
				if (candidates.length !== 1) throw new Error("Ambiguous billing comparison schema");
				statements.push(
					`ALTER TABLE billing_mirror_comparisons RENAME COLUMN ${identifier(candidates[0])} TO ${identifier(canonicalColumn)};`,
				);
			}
		}
		statements.push(
			`UPDATE d1_migrations SET name = ${quote(canonical)} WHERE name = ${quote(previous[0])};`,
		);
	}
	if (tables.has("billing_webhook_endpoints")) {
		const columns = database.prepare("PRAGMA table_info(billing_webhook_endpoints)").all();
		if (columns.some(({ name }) => name === "signing_secret_encrypted")) {
			statements.push(
				"UPDATE billing_webhook_endpoints SET signing_secret_encrypted = 'env:SUPERBOARD_ENTITLEMENT_WEBHOOK_SECRET' WHERE signing_secret_encrypted LIKE 'env:%ENTITLEMENT_WEBHOOK_SECRET' AND signing_secret_encrypted <> 'env:SUPERBOARD_ENTITLEMENT_WEBHOOK_SECRET';",
			);
		}
	}
	return statements;
}

export function applyCanonicalNamespaceUpgrade(database) {
	database.exec("BEGIN IMMEDIATE");
	try {
		const statements = planCanonicalNamespaceUpgrade(database);
		for (const statement of statements) database.exec(statement);
		database.exec("COMMIT");
		return statements;
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const position = process.argv.indexOf("--database");
	const path = position < 0 ? undefined : process.argv[position + 1];
	if (!path || path.startsWith("--"))
		throw new Error("Pass --database <existing SQLite backup>; add --apply to update that file");
	if (!statSync(resolve(path)).isFile())
		throw new Error("The database must be an existing SQLite file");
	const apply = process.argv.includes("--apply");
	const database = new DatabaseSync(resolve(path), { readOnly: !apply });
	try {
		const statements = apply
			? applyCanonicalNamespaceUpgrade(database)
			: planCanonicalNamespaceUpgrade(database);
		console.log(statements.join("\n") || "No namespace upgrade required.");
	} finally {
		database.close();
	}
}
