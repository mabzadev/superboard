import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const siteBuild = join(root, "apps/site/dist");
const EXECUTABLE_ARTIFACT_PATTERN = /\.(?:html|js|mjs)$/u;
const historicalDashboardRuntime = [
	/https?:\/\/(?:grow\.vocostar\.com|board\.mbza\.dev|localhost:3001)(?:[/'"`]|$)/u,
	/from[\s]+["']next\//u,
	/import\(["']next\//u,
	/apps\/dashboard\/(?:\.next|out)\//u,
];

void test("the built Site has no runtime dependency on the historical Dashboard", () => {
	assert.equal(
		existsSync(siteBuild),
		true,
		"build apps/site before running the runtime boundary gate",
	);
	const files = walk(siteBuild).filter((path) => EXECUTABLE_ARTIFACT_PATTERN.test(path));
	assert.ok(files.length > 0, "the Site build contains no executable artifact");
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		for (const pattern of historicalDashboardRuntime) {
			assert.doesNotMatch(source, pattern, relative(root, path));
		}
	}
});

function walk(directory) {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}
