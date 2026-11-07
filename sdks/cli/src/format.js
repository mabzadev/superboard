export function table(rows, columns, empty = "Nothing to show.") {
	if (rows.length === 0) return empty;
	const cells = rows.map((row) => columns.map(([, value]) => String(value(row) ?? "")));
	const widths = columns.map(([header], index) =>
		Math.max(header.length, ...cells.map((line) => line[index].length)),
	);
	const render = (line) =>
		line
			.map((cell, index) => (index === line.length - 1 ? cell : cell.padEnd(widths[index])))
			.join("  ")
			.trimEnd();
	return [render(columns.map(([header]) => header)), ...cells.map(render)].join("\n");
}

export function bytes(value) {
	if (!Number.isFinite(value)) return "";
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return unit === 0 ? `${size} B` : `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function truncate(value, length = 60) {
	const text = String(value ?? "").replace(/\s+/gu, " ");
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const SYMBOLS = {
	create_table: "+",
	add_column: "+",
	update_table: "~",
	update_column: "~",
	drop_table: "-",
	drop_column: "-",
};

export function schemaPlan(changes) {
	if (!changes?.length) return "No changes.";
	return changes
		.map((change) => {
			const target = change.column ? `${change.table}.${change.column}` : change.table;
			return `  ${SYMBOLS[change.action] ?? "?"} ${change.action} ${target}${change.destructive ? "  (destructive)" : ""}`;
		})
		.join("\n");
}
