import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("central test discovery excludes tests in linked dependencies", (context) => {
	const repository = mkdtempSync(join(tmpdir(), "superboard-test-discovery-"));
	context.after(() => rmSync(repository, { recursive: true, force: true }));
	const project = join(repository, "packages/example");
	const suite = join(repository, "tests/checks/packages/example");
	mkdirSync(join(project, "node_modules/dependency"), { recursive: true });
	mkdirSync(suite, { recursive: true });
	writeFileSync(join(project, "package.json"), '{"name":"test-project","type":"module"}');
	for (const name of ["vitest", "vite"]) symlinkSync(dirname(require.resolve(`${name}/package.json`)), join(project, "node_modules", name), "junction");
	copyFileSync(new URL("../project-config.mjs", import.meta.url), join(repository, "tests/checks/project-config.mjs"));
	writeFileSync(join(project, "vitest.config.mjs"), `import { centralTests } from "../../tests/checks/project-config.mjs";
export default centralTests(import.meta.url, { test: { include: ["../../tests/checks/packages/example/**/*.test.mjs"] } });`);
	writeFileSync(join(suite, "owned.test.mjs"), 'import { test } from "vitest"; test("owned behavior", () => {});');
	writeFileSync(join(project, "node_modules/dependency/foreign.test.mjs"), 'throw new Error("DEPENDENCY_TEST_EXECUTED");');
	const result = spawnSync(process.execPath, [join(dirname(require.resolve("vitest/package.json")), "vitest.mjs"), "list", "--config", join(project, "vitest.config.mjs")], {
		cwd: project,
		encoding: "utf8",
		timeout: 30000,
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /owned behavior/u);
	assert.doesNotMatch(result.stdout + result.stderr, /DEPENDENCY_TEST_EXECUTED/u);
});
