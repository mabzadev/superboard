import type { SubFieldDef, GridAxisDef } from "./types";

export function normalizeObject(value: unknown, fields: SubFieldDef[]): Record<string, unknown> {
	const source =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const obj: Record<string, unknown> = { ...source };
	for (const field of fields) {
		if (source[field.key] === undefined) {
			obj[field.key] = field.defaultValue ?? undefined;
		}
	}
	return obj;
}

export function normalizeArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function normalizeGrid(
	value: unknown,
	rows: GridAxisDef[],
	columns: GridAxisDef[],
): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {};
	for (const row of rows) {
		out[row.key] = {};
	}

	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return out;
	}

	const source = value as Record<string, unknown>;
	for (const row of rows) {
		const rowVal = source[row.key];
		const rowOut = out[row.key]!;
		if (Array.isArray(rowVal)) {
			for (const code of rowVal) {
				if (typeof code === "string") {
					rowOut[code] = true;
				}
			}
		} else if (rowVal && typeof rowVal === "object") {
			const rowObj = rowVal as Record<string, unknown>;
			Object.assign(rowOut, rowObj);
			for (const col of columns) {
				if (rowObj[col.key] !== undefined) {
					rowOut[col.key] = rowObj[col.key];
				}
			}
		}
	}

	return out;
}

export function normalizeTags(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

const MUSTACHE_PATTERN = /\{\{(\w+)\}\}/g;

export function renderSummary(template: string, item: Record<string, unknown>): string {
	return template.replace(MUSTACHE_PATTERN, (_match, key: string) => {
		const val = item[key];
		if (val === undefined || val === null) return "";
		if (typeof val === "string") return val;
		if (typeof val === "number" || typeof val === "boolean") return String(val);
		return "";
	});
}
