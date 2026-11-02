import type { Kysely } from "kysely";
import { sql } from "kysely";

import type { Database } from "../../database/types.js";

export async function verifyPreviewSignature(
	source: string,
	exp: number,
	sig: string,
	secret: string,
): Promise<boolean> {
	if (exp < Date.now() / 1000) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);

	const sigBytes = new Uint8Array(sig.length / 2);
	for (let i = 0; i < sig.length; i += 2) {
		sigBytes[i / 2] = parseInt(sig.substring(i, i + 2), 16);
	}

	return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${source}:${exp}`));
}

export function parsePreviewSignatureHeader(
	header: string,
): { source: string; exp: number; sig: string } | null {
	const lastColon = header.lastIndexOf(":");
	if (lastColon <= 0) return null;

	const sig = header.substring(lastColon + 1);
	if (sig.length !== 64) return null;

	const rest = header.substring(0, lastColon);
	const secondLastColon = rest.lastIndexOf(":");
	if (secondLastColon <= 0) return null;

	const source = rest.substring(0, secondLastColon);
	const exp = parseInt(rest.substring(secondLastColon + 1), 10);

	if (isNaN(exp) || source.length === 0) return null;

	return { source, exp, sig };
}

const MEDIA_FILE_PREFIX = "/_emdash/api/media/file/";

function injectMediaSrc(jsonStr: string, origin: string): string {
	try {
		const obj = JSON.parse(jsonStr);
		if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return jsonStr;
		if (injectMediaSrcInto(obj, origin)) {
			return JSON.stringify(obj);
		}
		return jsonStr;
	} catch {
		return jsonStr;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function injectMediaSrcInto(obj: Record<string, unknown>, origin: string): boolean {
	let modified = false;

	if ((obj.provider === "local" || (!obj.provider && obj.id && obj.meta)) && !obj.src) {
		const meta = isRecord(obj.meta) ? obj.meta : undefined;
		const storageKey = meta?.storageKey ?? obj.id;
		if (typeof storageKey === "string" && storageKey) {
			obj.src = `${origin}${MEDIA_FILE_PREFIX}${storageKey}`;
			modified = true;
		}
	}

	for (const value of Object.values(obj)) {
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isRecord(item)) {
					if (injectMediaSrcInto(item, origin)) {
						modified = true;
					}
				}
			}
		} else if (isRecord(value)) {
			if (injectMediaSrcInto(value, origin)) {
				modified = true;
			}
		}
	}

	return modified;
}

const SAFE_TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

export interface Snapshot {
	tables: Record<string, Record<string, unknown>[]>;
	schema: Record<
		string,
		{
			columns: string[];
			types?: Record<string, string>;
		}
	>;
	generatedAt: string;
}

const SYSTEM_TABLES = [
	"_emdash_collections",
	"_emdash_fields",
	"_emdash_taxonomy_defs",
	"_emdash_menus",
	"_emdash_menu_items",
	"_emdash_sections",
	"_emdash_widget_areas",
	"_emdash_widgets",
	"_emdash_seo",
	"_emdash_migrations",
	"taxonomies",
	"content_taxonomies",
	"media",
	"options",
	"revisions",
];

const EXCLUDED_PREFIXES = [
	"_emdash_api_tokens",
	"_emdash_oauth_tokens",
	"_emdash_authorization_codes",
	"_emdash_device_codes",
	"_emdash_migrations_lock",
	"_plugin_",
	"users",
	"sessions",
	"credentials",
	"challenges",
];

const SAFE_OPTIONS_PREFIXES = ["site:"];

function isExcluded(tableName: string): boolean {
	return EXCLUDED_PREFIXES.some((prefix) => tableName.startsWith(prefix));
}

interface ColumnInfo {
	name: string;
	type: string;
}

export interface GenerateSnapshotOptions {
	includeDrafts?: boolean;
	includeTrashed?: boolean;
	origin?: string;
	optionPrefixes?: string[];
}

export async function generateSnapshot(
	db: Kysely<Database>,
	options?: GenerateSnapshotOptions,
): Promise<Snapshot> {
	const includeDrafts = options?.includeDrafts ?? false;
	const includeTrashed = options?.includeTrashed ?? false;
	const optionPrefixes = options?.optionPrefixes ?? SAFE_OPTIONS_PREFIXES;

	const tableResult = await sql<{ name: string }>`
		SELECT name FROM sqlite_master
		WHERE type = 'table'
		AND name LIKE 'ec_%'
		ORDER BY name
	`.execute(db);

	const contentTables = tableResult.rows.map((r) => r.name);

	const allTables = [...contentTables, ...SYSTEM_TABLES];

	const tables: Record<string, Record<string, unknown>[]> = {};
	const schema: Record<string, { columns: string[]; types?: Record<string, string> }> = {};

	for (const tableName of allTables) {
		if (isExcluded(tableName)) continue;

		if (!SAFE_TABLE_NAME.test(tableName)) continue;

		try {
			const pragmaResult = await sql<ColumnInfo>`
				PRAGMA table_info(${sql.raw(`"${tableName}"`)})
			`.execute(db);

			if (pragmaResult.rows.length === 0) continue;

			const columns = pragmaResult.rows.map((r) => r.name);
			const types: Record<string, string> = {};
			for (const row of pragmaResult.rows) {
				types[row.name] = row.type || "TEXT";
			}

			schema[tableName] = { columns, types };

			let rows: Record<string, unknown>[];

			if (tableName.startsWith("ec_")) {
				if (includeTrashed) {
					rows = (
						await sql<Record<string, unknown>>`
						SELECT * FROM ${sql.raw(`"${tableName}"`)}
					`.execute(db)
					).rows;
				} else if (includeDrafts) {
					rows = (
						await sql<Record<string, unknown>>`
						SELECT * FROM ${sql.raw(`"${tableName}"`)}
						WHERE deleted_at IS NULL
					`.execute(db)
					).rows;
				} else {
					rows = (
						await sql<Record<string, unknown>>`
						SELECT * FROM ${sql.raw(`"${tableName}"`)}
						WHERE deleted_at IS NULL
						AND status = 'published'
					`.execute(db)
					).rows;
				}
			} else if (tableName === "options") {
				rows = (
					await sql<Record<string, unknown>>`
					SELECT * FROM ${sql.raw(`"${tableName}"`)}
				`.execute(db)
				).rows.filter((row) => {
					const name = typeof row.name === "string" ? row.name : "";
					return optionPrefixes.some((prefix) => name.startsWith(prefix));
				});
			} else {
				rows = (
					await sql<Record<string, unknown>>`
					SELECT * FROM ${sql.raw(`"${tableName}"`)}
				`.execute(db)
				).rows;
			}

			if (rows.length > 0) {
				tables[tableName] = rows;
			}
		} catch {}
	}

	if (options?.origin) {
		const origin = options.origin;
		for (const [tableName, rows] of Object.entries(tables)) {
			if (!tableName.startsWith("ec_")) continue;
			for (const row of rows) {
				for (const [col, value] of Object.entries(row)) {
					if (typeof value !== "string" || !value.startsWith("{")) continue;
					row[col] = injectMediaSrc(value, origin);
				}
			}
		}
	}

	return {
		tables,
		schema,
		generatedAt: new Date().toISOString(),
	};
}
