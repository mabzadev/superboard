import { resolve } from "node:path";

import { build } from "esbuild";
await build({
	entryPoints: [resolve("src/index.ts")],
	outfile: resolve("dist/index.js"),
	bundle: true,
	format: "esm",
	platform: "browser",
	mainFields: ["module", "main"],
	target: "es2024",
	minify: true,
	sourcemap: false,
	logLevel: "info",
});
