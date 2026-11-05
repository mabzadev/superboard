import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	createPathMapper,
	rewriteRelativeSpecifiers,
	syncUpstream,
} from "../../../scripts/emdash/upstream-sync.mjs";

const placeholder = ["$", "{name}"].join("");

const syncConfig = {
	ignored: ["^demos/"],
	relocated: [
		["^((?:.+/)?tests?/(?:.+/)?)fixtures/", "tests/fixtures/$1"],
		["^(.+?)/tests?/", "tests/checks/$1/"],
	],
};

function writeTree(root, files) {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

function commitUpstream(root, files) {
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
	git("rm", "-rq", "--cached", "--ignore-unmatch", ".");
	rmSync(join(root, "packages"), { recursive: true, force: true });
	rmSync(join(root, "demos"), { recursive: true, force: true });
	writeTree(root, files);
	git("add", "-A");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.test",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-qm",
		"upstream",
	);
	return git("rev-parse", "HEAD").trim();
}

test("paths follow the first matching relocation and ignored upstream paths are skipped", () => {
	const mapPath = createPathMapper(syncConfig);
	assert.equal(mapPath("demos/simple/src/index.ts"), null);
	assert.equal(
		mapPath("packages/core/tests/unit/a.test.ts"),
		"tests/checks/packages/core/unit/a.test.ts",
	);
	assert.equal(
		mapPath("packages/core/tests/integration/fixtures/data.json"),
		"tests/fixtures/packages/core/tests/integration/data.json",
	);
	assert.equal(mapPath("packages/core/src/fixtures/kept.ts"), "packages/core/src/fixtures/kept.ts");
});

test("relocated sources keep pointing at the same modules, folders and data files", () => {
	const mapPath = createPathMapper(syncConfig);
	const source = [
		'import { a } from "../../src/a.js";',
		'import { helper } from "../fixtures";',
		'vi.mock("../../src/b.js");',
		'const data = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/v1");',
		`const file = new URL(\`../../migrations/${placeholder}\`, import.meta.url);`,
		"",
	].join("\n");
	assert.equal(
		rewriteRelativeSpecifiers(
			source,
			"packages/core/tests/unit/a.test.ts",
			"tests/checks/packages/core/unit/a.test.ts",
			mapPath,
		),
		[
			'import { a } from "../../../../../packages/core/src/a.js";',
			'import { helper } from "../../../../fixtures/packages/core/tests";',
			'vi.mock("../../../../../packages/core/src/b.js");',
			'const data = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/core/data/v1");',
			`const file = new URL(\`../../../../../packages/core/migrations/${placeholder}\`, import.meta.url);`,
			"",
		].join("\n"),
	);
});

test("an upstream release merges into SuperBoard's copy and reports overlapping edits", async (context) => {
	const root = mkdtempSync(join(tmpdir(), "superboard-upstream-sync-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "-q"], { cwd: root });
	const base = commitUpstream(root, {
		"packages/core/src/a.ts": "// Explains a.\nexport const a = 1;\n\nexport const b = 1;\n",
		"packages/core/src/conflict.ts": "export const value = 1;\n",
		"packages/core/src/removed.ts": "export const removed = true;\n",
		"packages/core/tests/a.test.ts": 'import { a } from "../src/a.js";\n',
		"demos/simple/index.ts": "export const demo = 1;\n",
	});
	const target = commitUpstream(root, {
		"packages/core/src/a.ts": "// Explains a.\nexport const a = 2;\n\nexport const b = 1;\n",
		"packages/core/src/conflict.ts": "export const value = 2;\n",
		"packages/core/src/added.ts": "// Explains added.\nexport const added = true;\n",
		"packages/core/tests/a.test.ts": 'import { a } from "../src/a.js";\n\nexport { a };\n',
		"demos/simple/index.ts": "export const demo = 2;\n",
	});
	execFileSync("git", ["rm", "-rq", "--cached", "."], { cwd: root });
	rmSync(join(root, "packages"), { recursive: true, force: true });
	rmSync(join(root, "demos"), { recursive: true, force: true });
	writeTree(root, {
		"packages/core/src/a.ts": "// Explains a.\nexport const a = 1;\n\nexport const b = 3;\n",
		"packages/core/src/conflict.ts": "export const value = 3;\n",
		"packages/core/src/removed.ts": "export const removed = true;\n",
		"tests/checks/packages/core/a.test.ts":
			'import { a } from "../../../../packages/core/src/a.js";\n',
	});

	const report = await syncUpstream({ root, base, target, syncConfig });

	const read = (path) => readFileSync(join(root, path), "utf8");
	assert.equal(
		read("packages/core/src/a.ts"),
		"// Explains a.\nexport const a = 2;\n\nexport const b = 3;\n",
	);
	assert.equal(
		read("packages/core/src/added.ts"),
		"// Explains added.\nexport const added = true;\n",
	);
	assert.equal(existsSync(join(root, "packages/core/src/removed.ts")), false);
	assert.equal(
		read("tests/checks/packages/core/a.test.ts"),
		'import { a } from "../../../../packages/core/src/a.js";\n\nexport { a };\n',
	);
	assert.equal(existsSync(join(root, "demos")), false);
	assert.deepEqual(
		report.conflicts.map(({ path, kind }) => ({ path, kind })),
		[{ path: "packages/core/src/conflict.ts", kind: "content" }],
	);
	assert.match(
		read("packages/core/src/conflict.ts"),
		/<<<<<<< SuperBoard[\s\S]*value = 3[\s\S]*value = 2/u,
	);
});
