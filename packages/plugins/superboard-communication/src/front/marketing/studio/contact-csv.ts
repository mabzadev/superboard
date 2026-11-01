export const MAX_IMPORT_ROWS = 10_000;

/** Parses CSV text (comma or semicolon separated, quoted cells) into headers and rows. */
export function parseCsvTable(
	source: string,
	maxRows = MAX_IMPORT_ROWS,
): { headers: string[]; rows: string[][] } {
	if (source.length > 20_000_000) throw new Error("CSV_TOO_LARGE");
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const first = source.split(/\r?\n/)[0] ?? "";
	const separator =
		first.split(";").length > first.split(",").length
			? ";"
			: first.includes("\t") && !first.includes(",")
				? "\t"
				: ",";
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (character === '"') {
			if (quoted && source[index + 1] === '"') {
				cell += '"';
				index++;
			} else quoted = !quoted;
		} else if (character === separator && !quoted) {
			row.push(cell);
			cell = "";
		} else if ((character === "\n" || character === "\r") && !quoted) {
			if (character === "\r" && source[index + 1] === "\n") index++;
			row.push(cell);
			if (row.some((value) => value.trim())) rows.push(row);
			row = [];
			cell = "";
		} else cell += character;
	}
	if (quoted) throw new Error("CSV_INVALID");
	row.push(cell);
	if (row.some((value) => value.trim())) rows.push(row);
	const headers = rows.shift()?.map((value) => value.replace(/^﻿/, "").trim()) ?? [];
	if (!headers.length || !rows.length) throw new Error("CSV_INVALID");
	if (rows.length > maxRows) throw new Error("CSV_TOO_MANY_ROWS");
	return { headers, rows };
}

export type ColumnTarget =
	| "ignore"
	| "email"
	| "name"
	| "locale"
	| "tags"
	| "consent"
	| `field:${string}`;

const aliases: Record<string, ColumnTarget> = {
	email: "email",
	"e-mail": "email",
	mail: "email",
	courriel: "email",
	"email address": "email",
	name: "name",
	nom: "name",
	"full name": "name",
	"nom complet": "name",
	locale: "locale",
	language: "locale",
	langue: "locale",
	lang: "locale",
	tags: "tags",
	tag: "tags",
	"\u00e9tiquettes": "tags",
	consent: "consent",
	consentement: "consent",
	"opt-in": "consent",
	optin: "consent",
};

/** Suggests a target for each column from its header and the project's fields. */
export function guessColumnMapping(headers: string[], fieldKeys: string[]): ColumnTarget[] {
	const used = new Set<string>();
	return headers.map((header) => {
		const normalized = header.trim().toLowerCase();
		const guess: ColumnTarget =
			aliases[normalized] ??
			(fieldKeys.find((key) => key === normalized.replace(/[\s-]+/g, "_"))
				? `field:${normalized.replace(/[\s-]+/g, "_")}`
				: "ignore");
		if (guess === "ignore" || used.has(guess)) return "ignore";
		used.add(guess);
		return guess;
	});
}

/** Turns parsed rows into import records using the chosen column mapping. */
export function mapCsvRows(rows: string[][], mapping: ColumnTarget[]) {
	return rows.map((values, index) => {
		const record: {
			line: number;
			email: string;
			name?: string;
			locale?: string;
			tags?: string;
			consent?: string;
			attributes?: Record<string, string>;
		} = { line: index + 2, email: "" };
		mapping.forEach((target, column) => {
			const value = (values[column] ?? "").trim();
			if (target === "ignore" || !value) return;
			if (target.startsWith("field:")) {
				record.attributes = { ...record.attributes, [target.slice(6)]: value };
				return;
			}
			if (
				target === "email" ||
				target === "name" ||
				target === "locale" ||
				target === "tags" ||
				target === "consent"
			)
				record[target] = value;
		});
		return record;
	});
}

/** Legacy helper kept for the simple email/name/locale/attributes_json format. */
export function parseContactCsv(source: string): Array<Record<string, unknown>> {
	const { headers, rows } = parseCsvTable(source, 1000);
	const keys = headers.map((header) => header.toLowerCase());
	if (!keys.includes("email")) throw new Error("CSV_INVALID");
	return rows.map((values) => {
		if (values.length !== keys.length) throw new Error("CSV_INVALID");
		const entry = Object.fromEntries(keys.map((header, index) => [header, values[index] ?? ""]));
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email ?? "")) throw new Error("CSV_INVALID");
		let attributes: Record<string, unknown> = {};
		if (entry.attributes_json) {
			const raw: unknown = JSON.parse(entry.attributes_json);
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CSV_INVALID");
			attributes = raw as Record<string, unknown>;
		}
		if (entry.locale) attributes.locale = entry.locale;
		return { email: entry.email, name: entry.name, attributes };
	});
}
