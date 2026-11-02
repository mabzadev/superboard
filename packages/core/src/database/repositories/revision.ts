import { sql, type Kysely } from "kysely";
import { monotonicFactory } from "ulidx";

import type { Database, RevisionTable } from "../types.js";
import { validateIdentifier } from "../validate.js";

const monotonic = monotonicFactory();

export interface Revision {
	id: string;
	collection: string;
	entryId: string;
	data: Record<string, unknown>;
	authorId: string | null;
	createdAt: string;
}

export interface CreateRevisionInput {
	collection: string;
	entryId: string;
	data: Record<string, unknown>;
	authorId?: string;
}

export class RevisionRepository {
	constructor(private db: Kysely<Database>) {}

	async create(input: CreateRevisionInput): Promise<Revision> {
		const id = monotonic();

		const row: Omit<RevisionTable, "created_at"> = {
			id,
			collection: input.collection,
			entry_id: input.entryId,
			data: JSON.stringify(input.data),
			author_id: input.authorId ?? null,
		};

		await this.db.insertInto("revisions").values(row).execute();

		const revision = await this.findById(id);
		if (!revision) {
			throw new Error("Failed to create revision");
		}

		try {
			await this.db
				.insertInto("_emdash_revision_prune_queue")
				.values({
					collection: input.collection,
					entry_id: input.entryId,
					revision_id: id,
				})
				.onConflict((conflict) =>
					conflict.columns(["collection", "entry_id"]).doUpdateSet({ revision_id: id }),
				)
				.execute();
		} catch (error) {
			console.error(
				`[revisions] Failed to queue revision pruning for ${input.collection}/${input.entryId}:`,
				error,
			);
		}

		return revision;
	}

	async findById(id: string): Promise<Revision | null> {
		const row = await this.db
			.selectFrom("revisions")
			.selectAll()
			.where("id", "=", id)
			.executeTakeFirst();

		return row ? this.rowToRevision(row) : null;
	}

	async findByEntry(
		collection: string,
		entryId: string,
		options: { limit?: number } = {},
	): Promise<Revision[]> {
		let query = this.db
			.selectFrom("revisions")
			.selectAll()
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.orderBy("id", "desc");

		if (options.limit) {
			query = query.limit(options.limit);
		}

		const rows = await query.execute();
		return rows.map((row) => this.rowToRevision(row));
	}

	async findLatest(collection: string, entryId: string): Promise<Revision | null> {
		const row = await this.db
			.selectFrom("revisions")
			.selectAll()
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.orderBy("id", "desc")
			.limit(1)
			.executeTakeFirst();

		return row ? this.rowToRevision(row) : null;
	}

	async countByEntry(collection: string, entryId: string): Promise<number> {
		const result = await this.db
			.selectFrom("revisions")
			.select((eb) => eb.fn.count("id").as("count"))
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.executeTakeFirst();

		return Number(result?.count || 0);
	}

	async deleteByEntry(collection: string, entryId: string): Promise<number> {
		const result = await this.db
			.deleteFrom("revisions")
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.executeTakeFirst();

		try {
			await this.db
				.deleteFrom("_emdash_revision_prune_queue")
				.where("collection", "=", collection)
				.where("entry_id", "=", entryId)
				.execute();
		} catch (error) {
			console.error(
				`[revisions] Failed to clear queued revision pruning for ${collection}/${entryId}:`,
				error,
			);
		}

		return Number(result.numDeletedRows ?? 0);
	}

	async pruneOldRevisions(
		collection: string,
		entryId: string,
		keepCount: number,
		throughRevisionId?: string,
	): Promise<number> {
		validateIdentifier(collection, "collection");
		const tableName = `ec_${collection}`;
		let keepQuery = this.db
			.selectFrom("revisions")
			.select("id")
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(keepCount);

		if (throughRevisionId) {
			keepQuery = keepQuery.where("id", "<=", throughRevisionId);
		}

		const keep = await keepQuery.execute();

		const keepIds = keep.map((r) => r.id);

		if (keepIds.length === 0) return 0;
		const revisionBoundary = throughRevisionId ? sql`AND id <= ${throughRevisionId}` : sql``;

		const result = await sql`
			DELETE FROM revisions
			WHERE collection = ${collection}
			AND entry_id = ${entryId}
			${revisionBoundary}
			AND id NOT IN (${sql.join(keepIds.map((id) => sql`${id}`))})
			AND NOT EXISTS (
				SELECT 1 FROM ${sql.ref(tableName)} AS content
				WHERE content.live_revision_id = revisions.id
				OR content.draft_revision_id = revisions.id
			)
		`.execute(this.db);

		return Number(result.numAffectedRows ?? 0);
	}

	async pruneQueuedEntry(
		collection: string,
		entryId: string,
		queuedRevisionId: string,
		keepCount: number,
	): Promise<number> {
		const pruned = await this.pruneOldRevisions(collection, entryId, keepCount, queuedRevisionId);
		await this.db
			.deleteFrom("_emdash_revision_prune_queue")
			.where("collection", "=", collection)
			.where("entry_id", "=", entryId)
			.where("revision_id", "=", queuedRevisionId)
			.execute();
		return pruned;
	}

	async deleteIfUnreferenced(
		collection: string,
		entryId: string,
		revisionId: string,
	): Promise<boolean> {
		validateIdentifier(collection, "collection");
		const tableName = `ec_${collection}`;
		const result = await sql`
			DELETE FROM revisions
			WHERE id = ${revisionId}
			AND collection = ${collection}
			AND entry_id = ${entryId}
			AND NOT EXISTS (
				SELECT 1 FROM ${sql.ref(tableName)} AS content
				WHERE content.live_revision_id = revisions.id
				OR content.draft_revision_id = revisions.id
			)
		`.execute(this.db);
		return (result.numAffectedRows ?? 0n) > 0n;
	}

	private rowToRevision(row: {
		id: string;
		collection: string;
		entry_id: string;
		data: string;
		author_id: string | null;
		created_at: string;
	}): Revision {
		return {
			id: row.id,
			collection: row.collection,
			entryId: row.entry_id,
			data: JSON.parse(row.data),
			authorId: row.author_id,
			createdAt: row.created_at,
		};
	}
}
