export function parseContactCsv(source: string): Array<Record<string, unknown>> {
	if (source.length > 2_000_000) throw new Error("CSV_TOO_LARGE");
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const first = source.split(/\r?\n/)[0] ?? "";
	const separator = first.includes(";") && !first.includes(",") ? ";" : ",";
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
	const headers =
		rows.shift()?.map((value) =>
			value
				.replace(/^\uFEFF/, "")
				.trim()
				.toLowerCase(),
		) ?? [];
	if (!headers.includes("email") || rows.length > 1000 || !rows.length)
		throw new Error("CSV_INVALID");
	return rows.map((values) => {
		if (values.length !== headers.length) throw new Error("CSV_INVALID");
		const entry = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
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
