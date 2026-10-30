import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export function sqliteD1(sqlite: DatabaseSync) {
	class Statement {
		values: SQLInputValue[] = [];
		constructor(readonly query: string) {}
		bind(...values: SQLInputValue[]) {
			this.values = values;
			return this;
		}
		async first() {
			return sqlite.prepare(this.query).get(...this.values) ?? null;
		}
		async all() {
			return { results: sqlite.prepare(this.query).all(...this.values) };
		}
		async run() {
			return { meta: sqlite.prepare(this.query).run(...this.values) };
		}
	}
	return {
		prepare: (query: string) => new Statement(query),
		batch: async (statements: Statement[]) => {
			sqlite.exec("BEGIN");
			try {
				const results = [];
				for (const statement of statements) results.push(await statement.run());
				sqlite.exec("COMMIT");
				return results;
			} catch (error) {
				sqlite.exec("ROLLBACK");
				throw error;
			}
		},
	};
}
