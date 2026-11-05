import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { filesRequiringFormatting } from "../../../scripts/emdash/format-staged.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const hook = join(repositoryRoot, "scripts/emdash/format-staged.mjs");

test("a commit whose only staged files are ignored by the formatter passes unchanged", () => {
	const directory = mkdtempSync(join(repositoryRoot, ".format-staged-fixture-"));
	try {
		const manifest = join(directory, "package.json");
		const content = '{ "name": "fixture",\n      "private": true }\n';
		writeFileSync(manifest, content);
		const result = spawnSync(process.execPath, [hook, "code", manifest], {
			cwd: repositoryRoot,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(readFileSync(manifest, "utf8"), content);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("moving unchanged code preserves its bytes while edited and new files still require formatting", () => {
	const root = mkdtempSync(join(tmpdir(), "superboard-staged-format-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	try {
		git("init");
		writeFileSync(join(root, "original.ts"), "export const answer = 42;\n");
		writeFileSync(join(root, "edited.ts"), "export const label = 'before';\n");
		git("add", ".");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.test",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-m",
			"fixture",
		);
		renameSync(join(root, "original.ts"), join(root, "moved.ts"));
		renameSync(join(root, "edited.ts"), join(root, "moved-edited.ts"));
		writeFileSync(join(root, "moved-edited.ts"), "export const label = 'after';\n");
		writeFileSync(join(root, "added.ts"), "export const enabled=true;\n");
		git("add", "-A");
		const input = ["moved.ts", "moved-edited.ts", "added.ts"].map((name) => join(root, name));
		assert.deepEqual(filesRequiringFormatting(root, input), input.slice(1));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("formatting leaves generator-owned outputs intact while formatting authored documentation", () => {
	const root = mkdtempSync(join(tmpdir(), "superboard-generated-format-"));
	const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
	try {
		git("init");
		writeFileSync(join(root, "README.md"), "# Generated\n\n|A|B|\n|-|-|\n");
		writeFileSync(join(root, "guide.md"), "# Authored\n\n|A|B|\n|-|-|\n");
		mkdirSync(join(root, "apps/site/seed"), { recursive: true });
		writeFileSync(
			join(root, "apps/site/seed/seed.json"),
			JSON.stringify({ generated: true }, null, "\t"),
		);
		git("add", ".");
		assert.deepEqual(
			filesRequiringFormatting(root, [
				join(root, "README.md"),
				join(root, "guide.md"),
				join(root, "apps/site/seed/seed.json"),
			]),
			[join(root, "guide.md")],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
