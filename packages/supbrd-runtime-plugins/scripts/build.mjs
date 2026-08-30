import { readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const entriesDirectory = resolve(root, "src/entries");
const outputDirectory = resolve(root, "dist");
const entryPoints = readdirSync(entriesDirectory)
	.filter((name) => name.endsWith(".ts"))
	.toSorted()
	.map((name) => resolve(entriesDirectory, name));

rmSync(outputDirectory, { recursive: true, force: true });
await build({
	entryPoints,
	outdir: outputDirectory,
	entryNames: "[name]",
	bundle: true,
	splitting: false,
	format: "esm",
	platform: "neutral",
	target: "es2024",
	minify: true,
	sourcemap: false,
	logLevel: "info",
});
