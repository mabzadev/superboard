import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const dashboard = join(root, "apps/dashboard");
const TYPESCRIPT_EXTENSION_PATTERN = /\.tsx$/u;

test("every Dashboard page compiles into the executable Next route manifest", () => {
	const result = spawnSync("pnpm", ["run", "build:support"], {
		cwd: dashboard,
		encoding: "utf8",
		env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const manifestPath = join(dashboard, ".next/server/app-paths-manifest.json");
	assert.equal(existsSync(manifestPath), true);
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const pages = walk(join(dashboard, "src/app"));
	for (const page of pages) {
		const key = `/${relative(join(dashboard, "src/app"), page)
			.replaceAll(sep, "/")
			.replace(TYPESCRIPT_EXTENSION_PATTERN, "")}`;
		assert.ok(manifest[key], `compiled route missing: ${key}`);
	}
});

function walk(directory) {
	const pages = [];
	for (const name of readdirSync(directory).toSorted()) {
		const path = join(directory, name);
		if (statSync(path).isDirectory()) pages.push(...walk(path));
		else if (name === "page.tsx") pages.push(path);
	}
	return pages;
}
