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
import type { QueryResult as DOQueryResult } from "./do-class.js";

export interface PreviewDBStub {
	query(sql: string, params?: unknown[]): Promise<DOQueryResult>;
}

export interface PreviewDODialectConfig {
	getStub: () => PreviewDBStub;
}

export class PreviewDODialect implements Dialect {
	readonly #config: PreviewDODialectConfig;

	constructor(config: PreviewDODialectConfig) {
		this.#config = config;
	}

	createAdapter(): SqliteAdapter {
		return new SqliteAdapter();
	}

	createDriver(): Driver {
		return new PreviewDODriver(this.#config);
	}

	createQueryCompiler(): SqliteQueryCompiler {
		return new SqliteQueryCompiler();
	}

	createIntrospector(db: Kysely<any>): DatabaseIntrospector {
		return new D1Introspector(db);
	}
}

class PreviewDODriver implements Driver {
	readonly #config: PreviewDODialectConfig;

	constructor(config: PreviewDODialectConfig) {
		this.#config = config;
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return new PreviewDOConnection(this.#config.getStub());
	}

	async beginTransaction(): Promise<void> {}

	async commitTransaction(): Promise<void> {}

	async rollbackTransaction(): Promise<void> {}

	async releaseConnection(): Promise<void> {}

	async destroy(): Promise<void> {}
}

class PreviewDOConnection implements DatabaseConnection {
	readonly #stub: PreviewDBStub;

	constructor(stub: PreviewDBStub) {
		this.#stub = stub;
	}

	async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
		const sqlText = compiledQuery.sql;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- CompiledQuery.parameters is ReadonlyArray<unknown>, stub expects unknown[]
		const params = compiledQuery.parameters as unknown[];

		const result = await this.#stub.query(sqlText, params);

		return {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Kysely generic O is the caller's row type; we trust the DB returned matching rows
			rows: result.rows as O[],
			numAffectedRows: result.changes !== undefined ? BigInt(result.changes) : undefined,
		};
	}

	// eslint-disable-next-line require-yield -- interface requires AsyncIterableIterator but DO doesn't support streaming
	async *streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
		throw new Error("Preview DO dialect does not support streaming");
	}
}
