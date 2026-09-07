export interface SqlStatement {
	sql: string;
	values: readonly (string | number | null)[];
}
export interface PluginSqlStore {
	all<T>(sql: string, values: readonly (string | number | null)[]): Promise<T[]>;
	batch(statements: readonly SqlStatement[]): Promise<void>;
}
