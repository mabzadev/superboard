import { fileURLToPath } from "node:url";

import { build } from "esbuild";
await build({
	entryPoints: [fileURLToPath(new URL("../src/lib/plugin-front-catalog.ts", import.meta.url))],
	outfile: fileURLToPath(new URL("../../../infra/generated/front-catalog.js", import.meta.url)),
	bundle: true,
	format: "esm",
	platform: "browser",
	mainFields: ["module", "main"],
	target: "es2024",
	minify: true,
	sourcemap: false,
});
