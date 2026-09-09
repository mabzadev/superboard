import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const entriesDirectory = resolve(root, "src/entries");
const outputDirectory = resolve(root, "dist");
const catalog = JSON.parse(
	readFileSync(resolve(root, "../../config/superboard-plugin-catalog.json"), "utf8"),
);
const entryPoints = ["front-catalog", ...catalog.plugins.map(({ manifest }) => manifest.plugin_id)]
	.toSorted((left, right) => left.localeCompare(right))
	.map((name) => resolve(entriesDirectory, `${name}.ts`));

rmSync(outputDirectory, { recursive: true, force: true });
await build({
	entryPoints,
	outdir: outputDirectory,
	entryNames: "[name]",
	bundle: true,
	splitting: false,
	format: "esm",
	platform: "browser",
	mainFields: ["module", "main"],
	target: "es2024",
	minify: true,
	sourcemap: false,
	logLevel: "info",
});
