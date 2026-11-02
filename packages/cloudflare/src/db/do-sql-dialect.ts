import type {
	CompiledQuery,
	DatabaseConnection,
	DatabaseIntrospector,
	Dialect,
	Driver,
	Kysely,
	QueryResult,
} from "kysely";
import { SqliteAdapter, SqliteQueryCompiler } from "kysely";

import { D1Introspector } from "./d1-introspector.js";
import type { DOQueryOptions, EmDashDBStub } from "./do-sql-types.js";
import { isReadStatement } from "./do-sql-types.js";

export interface BookmarkSink {
	latest?: string;
}

export interface DOSqlDialectConfig {
	resolveStub: () => EmDashDBStub;
	readBookmark?: string;
	bookmarkSink?: BookmarkSink;
	onRpc?: () => void;
	forcePrimary?: boolean;
}

export class DOSqlDialect implements Dialect {
	readonly #config: DOSqlDialectConfig;

	constructor(config: DOSqlDialectConfig) {
		this.#config = config;
	}

	createAdapter(): SqliteAdapter {
		return new SqliteAdapter();
	}

	createDriver(): Driver {
		return new DOSqlDriver(this.#config);
	}

	createQueryCompiler(): SqliteQueryCompiler {
		return new SqliteQueryCompiler();
	}

	createIntrospector(db: Kysely<any>): DatabaseIntrospector {
		return new D1Introspector(db);
	}
}

class DOSqlDriver implements Driver {
	readonly #config: DOSqlDialectConfig;

	constructor(config: DOSqlDialectConfig) {
		this.#config = config;
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return new DOSqlConnection(this.#config.resolveStub(), this.#config);
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

class DOSqlConnection implements DatabaseConnection {
	readonly #stub: EmDashDBStub;
	readonly #config: DOSqlDialectConfig;

	constructor(stub: EmDashDBStub, config: DOSqlDialectConfig) {
		this.#stub = stub;
		this.#config = config;
	}

	async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
		const sqlText = compiledQuery.sql;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- CompiledQuery.parameters is ReadonlyArray<unknown>, stub expects unknown[]
		const params = compiledQuery.parameters as unknown[];

		let opts: DOQueryOptions | undefined;
		if (isReadStatement(sqlText)) {
			const bookmark = this.#config.bookmarkSink?.latest ?? this.#config.readBookmark;
			if (bookmark || this.#config.forcePrimary) {
				opts = {};
				if (bookmark) opts.bookmark = bookmark;
				if (this.#config.forcePrimary) opts.primary = true;
			}
		}

		this.#config.onRpc?.();
		const result = await this.#stub.query(sqlText, params, opts);

		if (result.bookmark && this.#config.bookmarkSink) {
			this.#config.bookmarkSink.latest = result.bookmark;
		}

		return {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely generic O is the caller's row type; we trust the DB returned matching rows
			rows: result.rows as O[],
			numAffectedRows: result.changes !== undefined ? BigInt(result.changes) : undefined,
		};
	}

	// eslint-disable-next-line require-yield -- interface requires AsyncIterableIterator but DO RPC doesn't stream
	async *streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
		throw new Error("DO SQL dialect does not support streaming");
	}
}
