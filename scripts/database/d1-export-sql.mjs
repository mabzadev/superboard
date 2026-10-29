import { StringDecoder } from "node:string_decoder";

export const quoteSqlIdentifier = (name) => `"${name.replaceAll('"', '""')}"`;

async function* lines(input) {
	const decoder = new StringDecoder("utf8");
	let pending = "";
	for await (const chunk of input) {
		pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
		let end;
		while ((end = pending.indexOf("\n")) !== -1) {
			yield pending.slice(0, end);
			pending = pending.slice(end + 1);
		}
	}
	pending += decoder.end();
	if (pending) yield pending;
}

async function* statements(input) {
	let pending = "";
	let quote = null;
	let blockComment = false;
	for await (const line of lines(input)) {
		let start = 0;
		for (let index = 0; index < line.length; index++) {
			const char = line[index];
			const next = line[index + 1];
			if (blockComment) {
				if (char === "*" && next === "/") {
					blockComment = false;
					index++;
				}
			} else if (quote) {
				if (char === quote) {
					if (next === quote) index++;
					else quote = null;
				}
			} else if (char === "-" && next === "-") break;
			else if (char === "/" && next === "*") {
				blockComment = true;
				index++;
			} else if (char === "'" || char === '"' || char === "`") quote = char;
			else if (char === ";") {
				yield pending + line.slice(start, index + 1);
				pending = "";
				start = index + 1;
			}
		}
		pending += `${line.slice(start)}\n`;
	}
	if (quote || blockComment) throw new Error("D1_BACKUP_SQL_INCOMPLETE");
	if (pending.trim()) yield pending;
}

export async function* rewriteFtsExport(input, schema) {
	const shadows = new Set(
		schema.filter(({ table_type }) => table_type === "shadow").map(({ name }) => name),
	);
	const content = new Map();
	const configurations = new Map();
	const exportedColumns = new Map();
	for (const table of schema.filter(({ table_type }) => table_type === "virtual")) {
		const contentName = `${table.name}_content`;
		if (!shadows.has(contentName)) throw new Error("D1_BACKUP_CONTENTLESS_FTS_UNSUPPORTED");
		const columns = JSON.parse(table.columns);
		exportedColumns.set(contentName, ["id", ...columns.map((_, index) => `c${index}`)]);
		exportedColumns.set(`${table.name}_config`, ["k", "v"]);
		content.set(
			contentName,
			`${quoteSqlIdentifier(table.name)}(${["rowid", ...columns].map(quoteSqlIdentifier).join(",")})`,
		);
		configurations.set(
			`${table.name}_config`,
			`${quoteSqlIdentifier(table.name)}(${quoteSqlIdentifier(table.name)},"rank")`,
		);
	}
	let sequenceReset = false;
	for await (const statement of statements(input)) {
		const match = statement.match(
			/^(\s*(?:(?:--[^\n]*\n)\s*)*)INSERT\s+INTO\s+(?:"((?:[^"]|"")+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*/iu,
		);
		if (match) {
			const name = (match[2] ?? match[3]).replaceAll('""', '"');
			if (shadows.has(name)) {
				const destination = content.get(name) ?? configurations.get(name);
				if (destination) {
					let values = statement.slice(match[0].length);
					const columnList = values.match(/^\(([^)]+)\)\s*/u);
					if (columnList) {
						const columns = columnList[1]
							.split(",")
							.map((column) => column.trim().replace(/^"|"$/gu, ""));
						if (JSON.stringify(columns) !== JSON.stringify(exportedColumns.get(name)))
							throw new Error("D1_BACKUP_FTS_COLUMNS_INVALID");
						values = values.slice(columnList[0].length);
					}
					if (!/^VALUES\s*\(/iu.test(values)) throw new Error("D1_BACKUP_FTS_EXPORT_INVALID");
					if (configurations.has(name) && /^VALUES\s*\(\s*'version'\s*,/iu.test(values)) continue;
					yield `${match[1]}INSERT INTO ${destination} ${values}\n`;
				}
				continue;
			}
			if (name === "sqlite_sequence" && !sequenceReset) {
				yield "DELETE FROM sqlite_sequence;\n";
				sequenceReset = true;
			}
		}
		yield `${statement}\n`;
	}
}
