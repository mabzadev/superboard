import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ESLint } from "eslint";

import { classifyLintSources, normalizeEslintDiagnostics } from "./superboard-lint.mjs";

test("new executable sources receive a linter without a manually maintained allowlist", () => {
	const paths = [
		"workers/new-module/src/index.ts",
		"packages/new-package/src/test.ts",
		"scripts/new-script.mjs",
		"apps/site/src/new-view.tsx",
		"packages/supbrd-front-ui/src/new-page.tsx",
		"apps/site/e2e/new-page.spec.ts",
		"workers/support/runtime-tests/new.runtime.test.ts",
	];
	const { groups, excluded } = classifyLintSources(paths, new Set());
	assert.deepEqual(excluded, []);
	assert.deepEqual(groups.get("native"), paths.slice(0, 3));
	assert.deepEqual(groups.get("emdash"), [paths[3], paths[5]]);
	assert.deepEqual(groups.get("frontend"), [paths[4]]);
	assert.deepEqual(groups.get("eslint:workers/support"), [paths[6]]);
	assert.deepEqual([...groups.values()].flat().toSorted(), paths.toSorted());
});

test("reference snippets stay outside executable lint while imported SDK runtime remains checked", () => {
	const executable = "sdks/flows/upstream/packages/react/src/lib/api.ts";
	const reference = "sdks/flows/upstream/reference/product-examples/modal/src/app/page.tsx";
	const productReference = "sdks/flows/upstream/product/ui/src/button.tsx";
	const { groups, excluded } = classifyLintSources(
		[executable, reference, productReference],
		new Set(),
	);
	assert.deepEqual(groups.get("flows"), [executable]);
	assert.deepEqual(
		excluded,
		[reference, productReference].map((path) => ({ path, reason: "imported-reference" })),
	);
});

test("plugin-owned client components retain the frontend lint contract after migration", () => {
	const paths = [
		"packages/supbrd-front-ui/src/button.tsx",
		"packages/supbrd-runtime-plugins/src/front/client/plugins/products/Offering.tsx",
		"packages/supbrd-runtime-plugins/src/front/plugins/products.ts",
	];
	const { groups } = classifyLintSources(paths, new Set());
	assert.deepEqual(groups.get("frontend"), paths.slice(0, 2));
	assert.deepEqual(groups.get("emdash"), [paths[2]]);
});

test("new upstream tests retain EmDash rules and generated outputs are reported separately", () => {
	const upstream = "packages/core/tests/unit/example.test.ts";
	const newUpstream = "packages/plugin-cli/src/new-command.ts";
	const generated = "workers/flows/worker-configuration.d.ts";
	const { groups, excluded } = classifyLintSources(
		[upstream, newUpstream, generated],
		new Set([upstream, "packages/plugin-cli/src/index.ts"]),
	);
	assert.deepEqual(groups.get("emdash"), [upstream, newUpstream]);
	assert.deepEqual(excluded, [{ path: generated, reason: "generated-types" }]);
});

test("eslint fatal parse failures cannot become a successful empty diagnostic report", () => {
	const diagnostics = normalizeEslintDiagnostics([
		{
			filePath: "/work/src/broken.ts",
			messages: [{ fatal: true, severity: 2, message: "Unexpected token", line: 3, column: 2 }],
		},
	]);
	assert.deepEqual(diagnostics, [
		{
			filename: "/work/src/broken.ts",
			message: "Unexpected token",
			severity: "error",
			code: "eslint(parse-error)",
			labels: [{ span: { line: 3, column: 2 } }],
		},
	]);
});

test("standalone Front lint keeps TypeScript, hooks and accessibility checks without the retired application", async (context) => {
	const repository = resolve(import.meta.dirname, "..");
	const fixture = mkdtempSync(join(tmpdir(), "superboard-front-lint-"));
	context.after(() => rmSync(fixture, { recursive: true, force: true }));
	mkdirSync(join(fixture, "config"));
	mkdirSync(join(fixture, "packages"));
	symlinkSync(
		join(repository, "packages/supbrd-front-ui"),
		join(fixture, "packages/supbrd-front-ui"),
		"dir",
	);
	symlinkSync(join(repository, "node_modules"), join(fixture, "node_modules"), "dir");
	copyFileSync(
		join(repository, "config/superboard-front-eslint.config.mjs"),
		join(fixture, "config/superboard-front-eslint.config.mjs"),
	);
	const lint = new ESLint({
		cwd: fixture,
		overrideConfigFile: join(fixture, "config/superboard-front-eslint.config.mjs"),
	});
	const invalid = await lint.lintText(
		'import { useState } from "react"; export function Invalid(value: any) { if (value) useState(0); return <img src="/image.png" />; }',
		{ filePath: "packages/supbrd-front-ui/src/Regression.tsx" },
	);
	const rules = new Set(
		invalid.flatMap((result) => result.messages.map((message) => message.ruleId)),
	);
	for (const rule of [
		"@typescript-eslint/no-explicit-any",
		"react-hooks/rules-of-hooks",
		"jsx-a11y/alt-text",
	])
		assert.ok(rules.has(rule), rule);
	const valid = await lint.lintText(
		"export function Valid({ name }: { name: string }) { return <span>{name}</span>; }",
		{ filePath: "packages/supbrd-front-ui/src/Valid.tsx" },
	);
	assert.equal(valid[0].errorCount, 0);
	assert.equal(valid[0].warningCount, 0);
});
