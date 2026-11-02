import { DurableObject } from "cloudflare:workers";
import type { CollectionDeletionGuardInput, CollectionDeletionGuardResult } from "emdash";

import type {
	DOQueryOptions,
	DOQueryResult,
	DOQueryStatement,
	EmDashDBStub,
} from "./do-sql-types.js";
import { isPragmaStatement, isReadStatement } from "./do-sql-types.js";

interface ReplicationStorage {
	primary?: EmDashDBStub;
	enableReplicas?: () => void;
	getCurrentBookmark?: () => Promise<string>;
	waitForBookmark?: (bookmark: string) => Promise<void>;
}

const READONLY_ERROR_PATTERN = /readonly database/i;
const COLLECTION_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;

const WAIT_FOR_BOOKMARK_TIMEOUT_MS = 250;

function isReadonlyError(error: unknown): boolean {
	return error instanceof Error && READONLY_ERROR_PATTERN.test(error.message);
}

export class EmDashDB extends DurableObject {
	#replicationConfigured = false;

	get #replication(): ReplicationStorage {
		return this.ctx.storage;
	}

	get #primaryStub(): EmDashDBStub | undefined {
		return this.#replication.primary;
	}

	get #isReplica(): boolean {
		return this.#primaryStub !== undefined;
	}

	#ensureReplication(): void {
		if (this.#replicationConfigured || this.#isReplica) return;
		this.#replication.enableReplicas?.();
		this.#replicationConfigured = true;
	}

	async #currentBookmark(): Promise<string | undefined> {
		return this.#replication.getCurrentBookmark?.();
	}

	async #waitForBookmarkBounded(bookmark: string): Promise<void> {
		const replication = this.#replication;
		if (!replication.waitForBookmark) return;
		try {
			await Promise.race([
				replication.waitForBookmark(bookmark),
				new Promise<void>((resolve) => setTimeout(resolve, WAIT_FOR_BOOKMARK_TIMEOUT_MS)),
			]);
		} catch (error) {
			console.error("[emdash:do] waitForBookmark failed; serving possibly-stale read:", error);
		}
	}

	async query(sql: string, params?: unknown[], opts?: DOQueryOptions): Promise<DOQueryResult> {
		this.#ensureReplication();
		const isRead = isReadStatement(sql);
		if (opts?.primary && this.#isReplica) {
			return this.#primaryStub!.query(sql, params, opts);
		}

		if (!isRead && this.#isReplica) {
			return this.#primaryStub!.query(sql, params);
		}

		if (isRead && opts?.bookmark && this.#isReplica) {
			await this.#waitForBookmarkBounded(opts.bookmark);
		}

		let cursor;
		try {
			cursor = params?.length
				? this.ctx.storage.sql.exec(sql, ...params)
				: this.ctx.storage.sql.exec(sql);
		} catch (error) {
			if (this.#isReplica && isReadonlyError(error)) {
				return this.#primaryStub!.query(sql, params);
			}
			throw error;
		}

		const rows: Record<string, unknown>[] = [];
		for (const row of cursor) {
			rows.push(row);
		}

		const wrote = !isRead || cursor.rowsWritten > 0 || isPragmaStatement(sql);
		if (!wrote) {
			return { rows };
		}
		return { rows, changes: cursor.rowsWritten, bookmark: await this.#currentBookmark() };
	}

	async executeCollectionDeletionGuard(
		input: CollectionDeletionGuardInput,
	): Promise<CollectionDeletionGuardResult> {
		this.#ensureReplication();
		if (this.#isReplica) {
			return this.#primaryStub!.executeCollectionDeletionGuard(input);
		}
		assertCollectionDeletionInput(input);
		return this.ctx.storage.transactionSync(() => {
			const phase = input.action === "fence" ? "fence" : "table";
			const guard = this.ctx.storage.sql.exec(
				`SELECT collection_id
				 FROM _emdash_media_usage_collection_deletions
				 WHERE collection_id = ?
				   AND collection_slug = ?
				   AND state = 'leased'
				   AND phase = ?
				   AND lease_token = ?
				   AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
				input.collectionId,
				input.collectionSlug,
				phase,
				input.leaseToken,
			);
			if (guard.toArray().length !== 1) return { outcome: "stale" };

			const contentTable = `ec_${input.collectionSlug}`;
			if (input.action === "fence") {
				if (!input.forceDelete) {
					const content = this.ctx.storage.sql.exec(
						`SELECT 1 AS present FROM "${contentTable}" WHERE deleted_at IS NULL LIMIT 1`,
					);
					if (content.toArray().length > 0) return { outcome: "has_content" };
				}
				const updated = this.ctx.storage.sql.exec(
					`UPDATE _emdash_media_usage_index_status
					 SET capture_state = 'deleting',
					     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
					 WHERE adapter_id = 'content-media'
					   AND scope_type = 'collection'
					   AND scope_key = ?
					   AND collection_id = ?
					   AND capture_state = 'active'
					   AND EXISTS (
					       SELECT 1 FROM _emdash_collections
					       WHERE id = ? AND slug = ?
					   )`,
					input.collectionSlug,
					input.collectionId,
					input.collectionId,
					input.collectionSlug,
				);
				return updated.rowsWritten === 1 ? { outcome: "fenced" } : { outcome: "stale" };
			}

			const ftsTable = `_emdash_fts_${input.collectionSlug}`;
			this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_insert"`);
			this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_update"`);
			this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS "${ftsTable}_delete"`);
			this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${ftsTable}"`);
			this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${contentTable}"`);
			return { outcome: "dropped" };
		});
	}

	async batchQuery(
		statements: DOQueryStatement[],
		opts?: DOQueryOptions,
	): Promise<DOQueryResult[]> {
		this.#ensureReplication();
		if (opts?.primary && this.#isReplica) {
			return this.#primaryStub!.batchQuery(statements, opts);
		}

		if (opts?.bookmark && this.#isReplica) {
			await this.#waitForBookmarkBounded(opts.bookmark);
		}

		return statements.map((statement) => {
			const cursor = statement.params?.length
				? this.ctx.storage.sql.exec(statement.sql, ...statement.params)
				: this.ctx.storage.sql.exec(statement.sql);
			const rows: Record<string, unknown>[] = [];
			for (const row of cursor) {
				rows.push(row);
			}
			return { rows };
		});
	}
}

function assertCollectionDeletionInput(input: CollectionDeletionGuardInput): void {
	if (!input.collectionId || !input.leaseToken) {
		throw new Error("Collection deletion guard requires a collection ID and lease token");
	}
	if (!COLLECTION_SLUG_PATTERN.test(input.collectionSlug) || input.collectionSlug.length > 63) {
		throw new Error("Collection deletion guard requires a valid collection slug");
	}
}
