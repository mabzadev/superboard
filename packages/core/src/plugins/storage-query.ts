import type { Kysely } from "kysely";

import { pluginDataExtractExpr, pluginDataOrderExpr } from "../database/dialect-helpers.js";
import type { WhereClause, WhereValue, RangeFilter, InFilter, StartsWithFilter } from "./types.js";

export class StorageQueryError extends Error {
	constructor(
		message: string,
		public field?: string,
		public suggestion?: string,
	) {
		super(message);
		this.name = "StorageQueryError";
	}
}

export function isRangeFilter(value: WhereValue): value is RangeFilter {
	if (typeof value !== "object" || value === null) return false;
	return "gt" in value || "gte" in value || "lt" in value || "lte" in value;
}

export function isInFilter(value: WhereValue): value is InFilter {
	if (typeof value !== "object" || value === null) return false;
	return "in" in value && Array.isArray(value.in);
}

export function isStartsWithFilter(value: WhereValue): value is StartsWithFilter {
	if (typeof value !== "object" || value === null) return false;
	return "startsWith" in value && typeof value.startsWith === "string";
}

export function escapeLikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function getIndexedFields(indexes: Array<string | string[]>): Set<string> {
	const fields = new Set<string>();
	for (const index of indexes) {
		if (Array.isArray(index)) {
			for (const field of index) {
				fields.add(field);
			}
		} else {
			fields.add(index);
		}
	}
	return fields;
}

export function validateWhereClause(
	where: WhereClause,
	indexedFields: Set<string>,
	pluginId: string,
	collection: string,
): void {
	for (const field of Object.keys(where)) {
		if (!indexedFields.has(field)) {
			throw new StorageQueryError(
				`Cannot query on non-indexed field '${field}'.`,
				field,
				`Add '${field}' to storage.${collection}.indexes in plugin '${pluginId}' to enable this query.`,
			);
		}
	}
}

export function validateOrderByClause(
	orderBy: Record<string, "asc" | "desc">,
	indexedFields: Set<string>,
	pluginId: string,
	collection: string,
): void {
	for (const field of Object.keys(orderBy)) {
		if (!indexedFields.has(field)) {
			throw new StorageQueryError(
				`Cannot order by non-indexed field '${field}'.`,
				field,
				`Add '${field}' to storage.${collection}.indexes in plugin '${pluginId}' to enable ordering by this field.`,
			);
		}
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function jsonExtract(
	db: Kysely<any>,
	field: string,
	options?: { numeric?: boolean },
): string {
	return pluginDataExtractExpr(db, field, options);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function jsonOrderExtract(db: Kysely<any>, field: string): string {
	return pluginDataOrderExpr(db, field);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function buildCondition(
	db: Kysely<any>,
	field: string,
	value: WhereValue,
): { sql: string; params: unknown[] } {
	const extractFor = (numeric: boolean): string => jsonExtract(db, field, { numeric });

	if (value === null) {
		return { sql: `${extractFor(false)} IS NULL`, params: [] };
	}

	if (typeof value === "number") {
		return { sql: `${extractFor(true)} = ?`, params: [value] };
	}

	if (typeof value === "string") {
		return { sql: `${extractFor(false)} = ?`, params: [value] };
	}

	if (typeof value === "boolean") {
		return { sql: `${extractFor(false)} = ?`, params: [value] };
	}

	if (isInFilter(value)) {
		const numeric = value.in.length > 0 && value.in.every((v) => typeof v === "number");
		const placeholders = value.in.map(() => "?").join(", ");
		return {
			sql: `${extractFor(numeric)} IN (${placeholders})`,
			params: value.in,
		};
	}

	if (isStartsWithFilter(value)) {
		return {
			sql: `${extractFor(false)} LIKE ? ESCAPE '\\'`,
			params: [`${escapeLikePattern(value.startsWith)}%`],
		};
	}

	if (isRangeFilter(value)) {
		const conditions: string[] = [];
		const params: unknown[] = [];

		const pushBound = (op: string, bound: string | number): void => {
			conditions.push(`${extractFor(typeof bound === "number")} ${op} ?`);
			params.push(bound);
		};

		if (value.gt !== undefined) pushBound(">", value.gt);
		if (value.gte !== undefined) pushBound(">=", value.gte);
		if (value.lt !== undefined) pushBound("<", value.lt);
		if (value.lte !== undefined) pushBound("<=", value.lte);

		return {
			sql: conditions.join(" AND "),
			params,
		};
	}

	throw new StorageQueryError(`Unknown filter type for field '${field}'`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function buildWhereClause(
	db: Kysely<any>,
	where: WhereClause,
): {
	sql: string;
	params: unknown[];
} {
	const conditions: string[] = [];
	const params: unknown[] = [];

	for (const [field, value] of Object.entries(where)) {
		const condition = buildCondition(db, field, value);
		conditions.push(condition.sql);
		params.push(...condition.params);
	}

	if (conditions.length === 0) {
		return { sql: "", params: [] };
	}

	return {
		sql: conditions.join(" AND "),
		params,
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any Kysely instance
export function buildOrderByClause(
	db: Kysely<any>,
	orderBy: Record<string, "asc" | "desc">,
): string {
	const clauses: string[] = [];

	for (const [field, direction] of Object.entries(orderBy)) {
		clauses.push(`${jsonOrderExtract(db, field)} ${direction.toUpperCase()}`);
	}

	if (clauses.length === 0) {
		return "";
	}

	return `ORDER BY ${clauses.join(", ")}`;
}
