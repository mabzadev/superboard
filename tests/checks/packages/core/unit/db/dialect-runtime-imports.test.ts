import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("dialect runtime modules", () => {
	const dialectFiles = [
		fileURLToPath(new URL("../../../../../../packages/core/src/db/sqlite.ts", import.meta.url)),
		fileURLToPath(new URL("../../../../../../packages/core/src/db/libsql.ts", import.meta.url)),
		fileURLToPath(new URL("../../../../../../packages/core/src/db/postgres.ts", import.meta.url)),
	];

	for (const file of dialectFiles) {
		it(`${file.split("/db/")[1]} does not use require() to load externals`, () => {
			const source = readFileSync(file, "utf-8");
			const codeOnly = source
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/(^|[^:])\/\/.*$/gm, "$1")
				.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
			expect(codeOnly).not.toMatch(/(?<![.\w])require\s*\(/);
		});
	}
});
