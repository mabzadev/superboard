import type { Kysely } from "kysely";
import { sql } from "kysely";

import { isSqlite, tableExists as dialectTableExists } from "../database/dialect-helpers.js";
import type { Database } from "../database/types.js";
import { validateIdentifier } from "../database/validate.js";
import { SEARCH_TOKENIZERS } from "./types.js";
import type { SearchConfig, SearchTokenizer } from "./types.js";

const DEFAULT_SEARCH_TOKENIZER: SearchTokenizer = "porter unicode61";

function isSearchTokenizer(value: unknown): value is SearchTokenizer {
	return SEARCH_TOKENIZERS.some((tokenizer) => tokenizer === value);
}

function resolveSearchTokenizer(tokenize?: SearchTokenizer): SearchTokenizer {
	if (tokenize === undefined) return DEFAULT_SEARCH_TOKENIZER;
	if (!isSearchTokenizer(tokenize)) {
		throw new Error(`Unsupported FTS5 tokenizer: "${String(tokenize)}"`);
	}
	return tokenize;
}

export class FTSManager {
	constructor(private db: Kysely<Database>) {}

	private validateInputs(collectionSlug: string, searchableFields?: string[]): void {
		validateIdentifier(collectionSlug, "collection slug");
		if (searchableFields) {
			for (const field of searchableFields) {
				validateIdentifier(field, "searchable field name");
			}
		}
	}

	getFtsTableName(collectionSlug: string): string {
		validateIdentifier(collectionSlug, "collection slug");
		return `_emdash_fts_${collectionSlug}`;
	}

	getContentTableName(collectionSlug: string): string {
		validateIdentifier(collectionSlug, "collection slug");
		return `ec_${collectionSlug}`;
	}

	async ftsTableExists(collectionSlug: string): Promise<boolean> {
		const ftsTable = this.getFtsTableName(collectionSlug);
		return dialectTableExists(this.db, ftsTable);
	}

	async createFtsTable(
		collectionSlug: string,
		searchableFields: string[],
		_weights?: Record<string, number>,
		tokenize?: SearchTokenizer,
	): Promise<void> {
		const tokenizer = resolveSearchTokenizer(tokenize);
		if (!isSqlite(this.db)) return;
		this.validateInputs(collectionSlug, searchableFields);
		const ftsTable = this.getFtsTableName(collectionSlug);

		const columns = ["id UNINDEXED", "locale UNINDEXED", ...searchableFields].join(", ");

		await sql
			.raw(`
			CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsTable}" USING fts5(
				${columns},
				tokenize='${tokenizer}'
			)
		`)
			.execute(this.db);

		await this.createTriggers(collectionSlug, searchableFields);
	}

	private searchValueExpr(ref: string, fieldType: string | undefined): string {
		if (fieldType !== "portableText") return ref;
		return (
			`CASE WHEN ${ref} IS NULL THEN NULL ` +
			`WHEN json_valid(${ref}) AND json_type(${ref}) IN ('array', 'object') THEN (` +
			`SELECT group_concat(j.value, ' ') FROM json_tree(${ref}) AS j ` +
			`WHERE j.key IN ('text', 'alt', 'caption', 'code') AND j.type = 'text') ` +
			`ELSE ${ref} END`
		);
	}

	private async getFieldTypes(collectionSlug: string): Promise<Map<string, string>> {
		const collection = await this.db
			.selectFrom("_emdash_collections")
			.select("id")
			.where("slug", "=", collectionSlug)
			.executeTakeFirst();
		if (!collection) return new Map();

		const rows = await this.db
			.selectFrom("_emdash_fields")
			.select(["slug", "type"])
			.where("collection_id", "=", collection.id)
			.execute();
		return new Map(rows.map((r) => [r.slug, r.type]));
	}

	private async createTriggers(collectionSlug: string, searchableFields: string[]): Promise<void> {
		this.validateInputs(collectionSlug, searchableFields);
		if (searchableFields.length === 0) {
			throw new Error(
				`Cannot create FTS triggers for collection "${collectionSlug}": no searchable fields. ` +
					`Mark at least one field as searchable before enabling search.`,
			);
		}
		const ftsTable = this.getFtsTableName(collectionSlug);
		const contentTable = this.getContentTableName(collectionSlug);
		const fieldTypes = await this.getFieldTypes(collectionSlug);
		const fieldList = searchableFields.join(", ");
		const newValueList = searchableFields
			.map((f) => this.searchValueExpr(`NEW.${f}`, fieldTypes.get(f)))
			.join(", ");

		await sql
			.raw(`
			CREATE TRIGGER IF NOT EXISTS "${ftsTable}_insert"
			AFTER INSERT ON "${contentTable}"
			WHEN NEW.deleted_at IS NULL
			BEGIN
				INSERT OR REPLACE INTO "${ftsTable}"(rowid, id, locale, ${fieldList})
				VALUES (NEW.rowid, NEW.id, NEW.locale, ${newValueList});
			END
		`)
			.execute(this.db);

		const changedCondition = ["deleted_at", "locale", ...searchableFields]
			.map((f) => `OLD.${f} IS NOT NEW.${f}`)
			.join(" OR ");
		await sql
			.raw(`
			CREATE TRIGGER IF NOT EXISTS "${ftsTable}_update"
			AFTER UPDATE ON "${contentTable}"
			WHEN ${changedCondition}
			BEGIN
				DELETE FROM "${ftsTable}" WHERE rowid = OLD.rowid;
				INSERT INTO "${ftsTable}"(rowid, id, locale, ${fieldList})
				SELECT NEW.rowid, NEW.id, NEW.locale, ${newValueList}
				WHERE NEW.deleted_at IS NULL;
			END
		`)
			.execute(this.db);

		await sql
			.raw(`
			CREATE TRIGGER IF NOT EXISTS "${ftsTable}_delete"
			AFTER DELETE ON "${contentTable}"
			BEGIN
				DELETE FROM "${ftsTable}" WHERE rowid = OLD.rowid;
			END
		`)
			.execute(this.db);
	}

	private async dropTriggers(collectionSlug: string): Promise<void> {
		this.validateInputs(collectionSlug);
		const ftsTable = this.getFtsTableName(collectionSlug);

		await sql.raw(`DROP TRIGGER IF EXISTS "${ftsTable}_insert"`).execute(this.db);
		await sql.raw(`DROP TRIGGER IF EXISTS "${ftsTable}_update"`).execute(this.db);
		await sql.raw(`DROP TRIGGER IF EXISTS "${ftsTable}_delete"`).execute(this.db);
	}

	async dropFtsTable(collectionSlug: string): Promise<void> {
		if (!isSqlite(this.db)) return;
		this.validateInputs(collectionSlug);
		const ftsTable = this.getFtsTableName(collectionSlug);

		await this.dropTriggers(collectionSlug);

		await sql.raw(`DROP TABLE IF EXISTS "${ftsTable}"`).execute(this.db);
	}

	async rebuildIndex(
		collectionSlug: string,
		searchableFields: string[],
		weights?: Record<string, number>,
		tokenize?: SearchTokenizer,
	): Promise<void> {
		resolveSearchTokenizer(tokenize);
		if (!isSqlite(this.db)) return;
		await this.dropFtsTable(collectionSlug);

		await this.createFtsTable(collectionSlug, searchableFields, weights, tokenize);

		await this.populateFromContent(collectionSlug, searchableFields);
	}

	async populateFromContent(collectionSlug: string, searchableFields: string[]): Promise<void> {
		if (!isSqlite(this.db)) return;
		this.validateInputs(collectionSlug, searchableFields);
		const ftsTable = this.getFtsTableName(collectionSlug);
		const contentTable = this.getContentTableName(collectionSlug);
		const fieldTypes = await this.getFieldTypes(collectionSlug);
		const fieldList = searchableFields.join(", ");
		const valueList = searchableFields
			.map((f) => this.searchValueExpr(`"${contentTable}"."${f}"`, fieldTypes.get(f)))
			.join(", ");

		await sql
			.raw(`
			INSERT OR REPLACE INTO "${ftsTable}"(rowid, id, locale, ${fieldList})
			SELECT rowid, id, locale, ${valueList} FROM "${contentTable}"
			WHERE deleted_at IS NULL
		`)
			.execute(this.db);
	}

	async getSearchConfig(collectionSlug: string): Promise<SearchConfig | null> {
		const result = await this.db
			.selectFrom("_emdash_collections")
			.select(["search_config", "title_field"])
			.where("slug", "=", collectionSlug)
			.executeTakeFirst();

		if (!result?.search_config) {
			return null;
		}

		try {
			const parsed: unknown = JSON.parse(result.search_config);
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				!("enabled" in parsed) ||
				typeof parsed.enabled !== "boolean"
			) {
				return null;
			}
			const config: SearchConfig = { enabled: parsed.enabled };
			if (result.title_field) config.titleField = result.title_field;
			if ("weights" in parsed && typeof parsed.weights === "object" && parsed.weights !== null) {
				const weights: Record<string, number> = {};
				for (const [k, v] of Object.entries(parsed.weights)) {
					if (typeof v === "number") {
						weights[k] = v;
					}
				}
				config.weights = weights;
			}
			if ("tokenize" in parsed) {
				if (!isSearchTokenizer(parsed.tokenize)) {
					return null;
				}
				config.tokenize = parsed.tokenize;
			}
			return config;
		} catch {
			return null;
		}
	}

	async setSearchConfig(collectionSlug: string, config: SearchConfig): Promise<void> {
		if (config.tokenize !== undefined) {
			resolveSearchTokenizer(config.tokenize);
		}
		await this.db
			.updateTable("_emdash_collections")
			.set({ search_config: JSON.stringify(config) })
			.where("slug", "=", collectionSlug)
			.execute();
	}

	async getSearchableFields(collectionSlug: string): Promise<string[]> {
		const collection = await this.db
			.selectFrom("_emdash_collections")
			.select("id")
			.where("slug", "=", collectionSlug)
			.executeTakeFirst();

		if (!collection) {
			return [];
		}

		const fields = await this.db
			.selectFrom("_emdash_fields")
			.select("slug")
			.where("collection_id", "=", collection.id)
			.where("searchable", "=", 1)
			.execute();

		return fields.map((f) => f.slug);
	}

	async hasTitleColumn(collectionSlug: string): Promise<boolean> {
		const withTitle = await this.getCollectionsWithTitleColumn([collectionSlug]);
		return withTitle.has(collectionSlug);
	}

	async getCollectionsWithTitleColumn(collectionSlugs: string[]): Promise<Set<string>> {
		if (collectionSlugs.length === 0) return new Set();

		const rows = await this.db
			.selectFrom("_emdash_fields as f")
			.innerJoin("_emdash_collections as c", "c.id", "f.collection_id")
			.select(["c.slug as collection_slug"])
			.where("f.slug", "=", "title")
			.execute();

		const withTitle = new Set(rows.map((r) => r.collection_slug));
		return new Set(collectionSlugs.filter((slug) => withTitle.has(slug)));
	}

	async enableSearch(
		collectionSlug: string,
		options?: { weights?: Record<string, number>; tokenize?: SearchTokenizer },
	): Promise<void> {
		if (options?.tokenize !== undefined) {
			resolveSearchTokenizer(options.tokenize);
		}
		if (!isSqlite(this.db)) {
			throw new Error("Full-text search is only available with SQLite databases");
		}
		const searchableFields = await this.getSearchableFields(collectionSlug);

		if (searchableFields.length === 0) {
			throw new Error(
				`No searchable fields defined for collection "${collectionSlug}". ` +
					`Mark at least one field as searchable before enabling search.`,
			);
		}

		const existing = await this.getSearchConfig(collectionSlug);
		const weights = options?.weights ?? existing?.weights;
		const tokenize = options?.tokenize ?? existing?.tokenize;

		await this.rebuildIndex(collectionSlug, searchableFields, weights, tokenize);

		await this.setSearchConfig(collectionSlug, {
			enabled: true,
			weights,
			tokenize,
		});
	}

	async disableSearch(collectionSlug: string): Promise<void> {
		if (!isSqlite(this.db)) return;
		await this.dropFtsTable(collectionSlug);
		const existing = await this.getSearchConfig(collectionSlug);
		await this.setSearchConfig(collectionSlug, {
			enabled: false,
			weights: existing?.weights,
			tokenize: existing?.tokenize,
		});
	}

	async getIndexStats(
		collectionSlug: string,
	): Promise<{ indexed: number; lastRebuilt?: string } | null> {
		if (!isSqlite(this.db)) return null;
		this.validateInputs(collectionSlug);
		const ftsTable = this.getFtsTableName(collectionSlug);
		const ftsDocsizeTable = `${ftsTable}_docsize`;

		if (!(await this.ftsTableExists(collectionSlug))) {
			return null;
		}

		const result = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM "${sql.raw(ftsDocsizeTable)}"
		`.execute(this.db);

		return {
			indexed: result.rows[0]?.count ?? 0,
		};
	}

	async verifyAndRepairIndex(collectionSlug: string): Promise<boolean> {
		if (!isSqlite(this.db)) return false;
		this.validateInputs(collectionSlug);
		const ftsTable = this.getFtsTableName(collectionSlug);
		const ftsDocsizeTable = `${ftsTable}_docsize`;
		const contentTable = this.getContentTableName(collectionSlug);
		const fields = await this.getSearchableFields(collectionSlug);
		const config = await this.getSearchConfig(collectionSlug);

		if (!(await this.ftsTableExists(collectionSlug))) {
			if (!config?.enabled || fields.length === 0) {
				return false;
			}

			console.warn(`FTS index for "${collectionSlug}" is missing. Rebuilding.`);
			await this.rebuildIndex(collectionSlug, fields, config.weights, config.tokenize);
			return true;
		}

		const contentCount = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM ${sql.ref(contentTable)}
			WHERE deleted_at IS NULL
		`.execute(this.db);

		const ftsCount = await sql<{ count: number }>`
			SELECT COUNT(*) as count FROM "${sql.raw(ftsDocsizeTable)}"
		`.execute(this.db);

		const contentRows = contentCount.rows[0]?.count ?? 0;
		const ftsRows = ftsCount.rows[0]?.count ?? 0;

		if (contentRows !== ftsRows) {
			console.warn(
				`FTS index for "${collectionSlug}" has ${ftsRows} rows but content table has ${contentRows}. Rebuilding.`,
			);
			if (fields.length > 0) {
				await this.rebuildIndex(collectionSlug, fields, config?.weights, config?.tokenize);
			}
			return true;
		}

		return false;
	}

	async verifyAndRepairAll(): Promise<number> {
		if (!isSqlite(this.db)) return 0;

		const collections = await this.db
			.selectFrom("_emdash_collections")
			.select("slug")
			.where("search_config", "is not", null)
			.execute();

		let repaired = 0;
		for (const { slug } of collections) {
			const config = await this.getSearchConfig(slug);
			if (!config?.enabled) continue;

			try {
				const wasRepaired = await this.verifyAndRepairIndex(slug);
				if (wasRepaired) repaired++;
			} catch (error) {
				console.error(`Failed to verify/repair FTS index for "${slug}":`, error);
			}
		}

		return repaired;
	}
}
