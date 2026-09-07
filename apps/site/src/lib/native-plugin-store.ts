import type { PluginSqlStore } from "../../../../packages/supbrd-runtime-plugins/src/server/sql-store.js";

export function nativePluginStore(db: D1Database): PluginSqlStore {
	return {
		all: async <T>(sql: string, values: readonly (string | number | null)[]) =>
			(
				await db
					.prepare(sql)
					.bind(...values)
					.all<T>()
			).results,
		batch: async (statements) => {
			await db.batch(statements.map(({ sql, values }) => db.prepare(sql).bind(...values)));
		},
	};
}
