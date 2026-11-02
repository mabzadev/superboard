import { consola } from "consola";

interface OutputArgs {
	json?: boolean;
}

export function configureOutputMode(args: OutputArgs): void {
	if (args.json || !process.stdout.isTTY) {
		consola.options.stdout = process.stderr;
		consola.options.stderr = process.stderr;
	}
}

export function output(data: unknown, args: OutputArgs): void {
	const useJson = args.json || !process.stdout.isTTY;

	if (useJson) {
		process.stdout.write(JSON.stringify(data, null, 2) + "\n");
	} else {
		prettyPrint(data);
	}
}

function prettyPrint(data: unknown, indent: number = 0): void {
	if (data === null || data === undefined) {
		consola.log("(empty)");
		return;
	}

	if (Array.isArray(data)) {
		if (data.length === 0) {
			consola.log("(no items)");
			return;
		}
		for (const item of data) {
			prettyPrint(item, indent);
			if (indent === 0) consola.log("---");
		}
		return;
	}

	if (typeof data === "object") {
		const obj = Object(data) as Record<string, unknown>;

		if ("items" in obj && Array.isArray(obj.items)) {
			prettyPrint(obj.items, indent);
			if (typeof obj.nextCursor === "string") {
				consola.log(`\nNext cursor: ${obj.nextCursor}`);
			}
			return;
		}

		const prefix = "  ".repeat(indent);
		for (const [key, value] of Object.entries(obj)) {
			if (value === null || value === undefined) continue;
			if (typeof value === "object" && !Array.isArray(value)) {
				consola.log(`${prefix}${key}:`);
				prettyPrint(value, indent + 1);
			} else if (Array.isArray(value)) {
				consola.log(`${prefix}${key}: [${value.length} items]`);
			} else {
				const str = typeof value === "string" ? value : JSON.stringify(value);
				const display = str.length > 80 ? str.slice(0, 77) + "..." : str;
				consola.log(`${prefix}${key}: ${display}`);
			}
		}
		return;
	}

	consola.log(typeof data === "string" ? data : JSON.stringify(data));
}
