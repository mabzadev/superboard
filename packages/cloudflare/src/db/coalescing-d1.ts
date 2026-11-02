import {
	type CompiledQuery,
	type DatabaseConnection,
	type Driver,
	type QueryResult,
	SqliteAdapter,
} from "kysely";

import { D1Adapter, EmDashD1Dialect } from "./d1-dialect.js";

const SELECT_PATTERN = /^select\b/i;

interface PendingQuery {
	statement: D1PreparedStatement;
	resolve: (result: QueryResult<any>) => void;
	reject: (error: unknown) => void;
	sql: string;
}

function mapD1Result<R>(result: D1Result<R>): QueryResult<R> {
	if (result.error) {
		throw new Error(result.error);
	}
	const numAffectedRows = result.meta.changes > 0 ? BigInt(result.meta.changes) : undefined;
	return {
		insertId:
			result.meta.last_row_id === undefined || result.meta.last_row_id === null
				? undefined
				: BigInt(result.meta.last_row_id),
		rows: result.results ?? [],
		numAffectedRows,
	};
}

export class CoalescingD1Connection implements DatabaseConnection {
	#database: D1Database;
	#buffer: PendingQuery[] = [];
	#flushScheduled = false;
	#flushDeadline = 0;
	static readonly #FLUSH_RECLAIM_MS = 1_000;
	#opChain: Promise<unknown> = Promise.resolve();

	constructor(database: D1Database) {
		this.#database = database;
	}

	#enqueue<T>(op: () => Promise<T>): Promise<T> {
		const run = this.#opChain.then(op, op);
		this.#opChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		if (!SELECT_PATTERN.test(compiledQuery.sql.trim())) {
			const statement = this.#database.prepare(compiledQuery.sql).bind(...compiledQuery.parameters);
			const result = await this.#enqueue(() => statement.all<R>());
			return mapD1Result(result);
		}

		const statement = this.#database.prepare(compiledQuery.sql).bind(...compiledQuery.parameters);

		return new Promise<QueryResult<R>>((resolve, reject) => {
			this.#buffer.push({ statement, resolve, reject, sql: compiledQuery.sql });
			this.#scheduleFlush();
		});
	}

	#scheduleFlush(): void {
		if (this.#flushScheduled) {
			this.#reclaimStrandedFlush();
			if (this.#flushScheduled) return;
		}
		this.#flushScheduled = true;
		this.#flushDeadline = Date.now() + CoalescingD1Connection.#FLUSH_RECLAIM_MS;
		setTimeout(() => {
			void this.#flush();
		}, 0);
	}

	#reclaimStrandedFlush(): void {
		if (this.#flushScheduled && Date.now() > this.#flushDeadline) {
			this.#flushScheduled = false;
		}
	}

	async #flush(): Promise<void> {
		this.#flushScheduled = false;
		const pending = this.#buffer.splice(0, this.#buffer.length);
		if (pending.length === 0) return;

		await this.#enqueue(async () => {
			const first = pending[0];
			if (pending.length === 1 && first) {
				try {
					first.resolve(mapD1Result(await first.statement.all()));
				} catch (error) {
					first.reject(error);
				}
				return;
			}

			let results: D1Result[];
			try {
				results = await this.#database.batch(pending.map((p) => p.statement));
			} catch {
				for (const p of pending) {
					try {
						p.resolve(mapD1Result(await p.statement.all()));
					} catch (error) {
						p.reject(error);
					}
				}
				return;
			}

			for (let i = 0; i < pending.length; i++) {
				const entry = pending[i];
				if (!entry) continue;
				const result = results[i];
				if (result) {
					try {
						entry.resolve(mapD1Result(result));
					} catch (error) {
						entry.reject(error);
					}
				} else {
					entry.reject(new Error(`D1 batch() returned no result for statement ${i}: ${entry.sql}`));
				}
			}
		});
	}

	// eslint-disable-next-line require-yield -- D1 doesn't support streaming (same as kysely-d1)
	async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
		throw new Error("D1 Driver does not support streaming");
	}
}

export class CoalescingD1Driver implements Driver {
	#connection: CoalescingD1Connection;

	constructor(database: D1Database) {
		this.#connection = new CoalescingD1Connection(database);
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return this.#connection;
	}

	async beginTransaction(): Promise<void> {
		throw new Error("Transactions are not supported");
	}

	async commitTransaction(): Promise<void> {
		throw new Error("Transactions are not supported");
	}

	async rollbackTransaction(): Promise<void> {
		throw new Error("Transactions are not supported");
	}

	async releaseConnection(): Promise<void> {}

	async destroy(): Promise<void> {}
}

class CoalescingD1Adapter extends D1Adapter {
	override get supportsMultipleConnections(): boolean {
		return true;
	}
}

export class CoalescingD1Dialect extends EmDashD1Dialect {
	#database: D1Database;

	constructor(config: { database: D1Database }) {
		super(config);
		this.#database = config.database;
	}

	override createAdapter(): SqliteAdapter {
		return new CoalescingD1Adapter();
	}

	override createDriver(): Driver {
		return new CoalescingD1Driver(this.#database);
	}
}
