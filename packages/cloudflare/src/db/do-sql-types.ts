export interface DurableObjectsConfig {
	binding: string;

	name?: string;

	session?: "disabled" | "auto";

	bookmarkCookie?: string;
}

export interface DOQueryStatement {
	sql: string;
	params?: unknown[];
}

export interface DOQueryResult {
	rows: Record<string, unknown>[];
	changes?: number;
	bookmark?: string;
}

export interface DOQueryOptions {
	bookmark?: string;
	primary?: boolean;
}

export interface EmDashDBStub {
	query(sql: string, params?: unknown[], opts?: DOQueryOptions): Promise<DOQueryResult>;
	batchQuery(statements: DOQueryStatement[], opts?: DOQueryOptions): Promise<DOQueryResult[]>;
	executeCollectionDeletionGuard(
		input: import("emdash").CollectionDeletionGuardInput,
	): Promise<import("emdash").CollectionDeletionGuardResult>;
}

const READ_STATEMENT_PATTERN = /^\s*(?:select|pragma|explain|with)\b/i;

const PRAGMA_STATEMENT_PATTERN = /^\s*pragma\b/i;

export function isReadStatement(sql: string): boolean {
	return READ_STATEMENT_PATTERN.test(sql);
}

export function isPragmaStatement(sql: string): boolean {
	return PRAGMA_STATEMENT_PATTERN.test(sql);
}
