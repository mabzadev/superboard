import {
	type CompiledQuery,
	type DatabaseConnection,
	type DatabaseIntrospector,
	type Dialect,
	type Driver,
	type Kysely,
	type QueryResult,
	SqliteAdapter,
	SqliteQueryCompiler,
} from "kysely";

import { D1Introspector } from "./d1-introspector.js";
import type { DOSqlDialectConfig } from "./do-sql-dialect.js";
import type { DOQueryOptions, EmDashDBStub } from "./do-sql-types.js";
import { isReadStatement } from "./do-sql-types.js";

const SELECT_PATTERN = /^select\b/i;

interface PendingQuery {
	sql: string;
	params: unknown[];
	resolve: (result: QueryResult<any>) => void;
	reject: (error: unknown) => void;
}

class CoalescingDOSqlConnection implements DatabaseConnection {
	readonly #stub: EmDashDBStub;
	readonly #config: DOSqlDialectConfig;
	#buffer: PendingQuery[] = [];
	#flushScheduled = false;
	#flushDeadline = 0;
	static readonly #FLUSH_RECLAIM_MS = 1_000;
	#opChain: Promise<unknown> = Promise.resolve();

	constructor(stub: EmDashDBStub, config: DOSqlDialectConfig) {
		this.#stub = stub;
		this.#config = config;
	}

	#effectiveBookmark(): string | undefined {
		return this.#config.bookmarkSink?.latest ?? this.#config.readBookmark;
	}

	#readOptions(): DOQueryOptions | undefined {
		const bookmark = this.#effectiveBookmark();
		if (!bookmark && !this.#config.forcePrimary) return undefined;
		return {
			...(bookmark ? { bookmark } : {}),
			...(this.#config.forcePrimary ? { primary: true } : {}),
		};
	}

	#enqueue<T>(op: () => Promise<T>): Promise<T> {
		const run = this.#opChain.then(op, op);
		this.#opChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	async #single<R>(sql: string, params: unknown[]): Promise<QueryResult<R>> {
		const opts = isReadStatement(sql) ? this.#readOptions() : undefined;
		this.#config.onRpc?.();
		const result = await this.#stub.query(sql, params, opts);
		if (result.bookmark && this.#config.bookmarkSink) {
			this.#config.bookmarkSink.latest = result.bookmark;
		}
		return {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- caller's row type; we trust the DB returned matching rows
			rows: result.rows as R[],
			numAffectedRows: result.changes !== undefined ? BigInt(result.changes) : undefined,
		};
	}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- CompiledQuery.parameters is ReadonlyArray<unknown>
		const params = compiledQuery.parameters as unknown[];

		if (!SELECT_PATTERN.test(compiledQuery.sql.trimStart())) {
			return this.#enqueue(() => this.#single<R>(compiledQuery.sql, params));
		}

		return new Promise<QueryResult<R>>((resolve, reject) => {
			this.#buffer.push({ sql: compiledQuery.sql, params, resolve, reject });
			this.#scheduleFlush();
		});
	}

	#scheduleFlush(): void {
		if (this.#flushScheduled) {
			this.#reclaimStrandedFlush();
			if (this.#flushScheduled) return;
		}
		this.#flushScheduled = true;
		this.#flushDeadline = Date.now() + CoalescingDOSqlConnection.#FLUSH_RECLAIM_MS;
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
					first.resolve(await this.#single(first.sql, first.params));
				} catch (error) {
					first.reject(error);
				}
				return;
			}

			const opts = this.#readOptions();
			let results;
			try {
				this.#config.onRpc?.();
				results = await this.#stub.batchQuery(
					pending.map((p) => ({ sql: p.sql, params: p.params })),
					opts,
				);
			} catch {
				for (const p of pending) {
					try {
						p.resolve(await this.#single(p.sql, p.params));
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
					entry.resolve({
						// eslint-disable-next-line typescript/no-unsafe-type-assertion -- caller's row type
						rows: result.rows as unknown[],
						numAffectedRows: undefined,
					});
				} else {
					entry.reject(
						new Error(`DO batchQuery returned no result for statement ${i}: ${entry.sql}`),
					);
				}
			}
		});
	}

	// eslint-disable-next-line require-yield -- DO RPC doesn't stream
	async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
		throw new Error("DO SQL dialect does not support streaming");
	}
}

class CoalescingDOSqlDriver implements Driver {
	readonly #config: DOSqlDialectConfig;
	#connection: CoalescingDOSqlConnection | undefined;

	constructor(config: DOSqlDialectConfig) {
		this.#config = config;
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		this.#connection ??= new CoalescingDOSqlConnection(this.#config.resolveStub(), this.#config);
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

class CoalescingDOSqlAdapter extends SqliteAdapter {
	override get supportsMultipleConnections(): boolean {
		return true;
	}
}

export class CoalescingDOSqlDialect implements Dialect {
	readonly #config: DOSqlDialectConfig;

	constructor(config: DOSqlDialectConfig) {
		this.#config = config;
	}

	createAdapter(): SqliteAdapter {
		return new CoalescingDOSqlAdapter();
	}

	createDriver(): Driver {
		return new CoalescingDOSqlDriver(this.#config);
	}

	createQueryCompiler(): SqliteQueryCompiler {
		return new SqliteQueryCompiler();
	}

	createIntrospector(db: Kysely<any>): DatabaseIntrospector {
		return new D1Introspector(db);
	}
}
