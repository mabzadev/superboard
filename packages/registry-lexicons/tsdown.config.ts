import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));

function collectGeneratedEntries(): string[] {
	const root = join(here, "src", "generated", "types");
	const entries: string[] = [];
	function walk(dir: string): void {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) {
				walk(path);
			} else if (path.endsWith(".ts")) {
				entries.push(`./${relative(here, path)}`);
			}
		}
	}
	try {
		walk(root);
	} catch {}
	return entries;
}

export default defineConfig({
	entry: ["src/index.ts", ...collectGeneratedEntries()],
	format: ["esm"],
	dts: true,
	clean: true,
	platform: "neutral",
	target: "es2023",
	external: ["@atcute/atproto", "@atcute/lexicons"],
});
