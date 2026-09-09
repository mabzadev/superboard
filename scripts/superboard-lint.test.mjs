import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ESLint } from "eslint";

import { lintFrontMenuSource, lintFrontMenuProject } from "./superboard-front-menu-lint.mjs";
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

test("front menu lint rejects hardcoded destinations and label overrides", () => {
	const path = "apps/site/src/lib/product-navigation.ts";
	for (const source of [
		'const items = [{label:"Sales",href:"/products"}];',
		'page("/analytics", "statistics", ["Statistics", "Statistiques"]);',
		'function replace(input) { return [{group_id:"stats",label:"Statistics",items:input}]; }',
	])
		assert.ok(lintFrontMenuSource(path, source).length > 0, source);
	assert.deepEqual(
		lintFrontMenuSource(
			path,
			"export const present = input => input.map(group => ({...group,items:group.items}));",
		),
		[],
	);
});

test("front menu lint requires the native menu and the selected locale", () => {
	const path = "apps/site/src/components/FrontPage.astro";
	assert.ok(
		lintFrontMenuSource(path, "---\nconst menu = [];\n---").some(({ code }) =>
			code.includes("front-menu-source"),
		),
	);
	assert.ok(
		lintFrontMenuSource(path, '---\nconst menu = getMenu("superboard-admin");\n---').some(
			({ code }) => code.includes("front-menu-locale"),
		),
	);
	assert.deepEqual(
		lintFrontMenuSource(
			path,
			'---\nconst locale = resolveUserFrontRequestLocale(Astro.request); const menu = getMenu("superboard-admin", {locale});\n---',
		),
		[],
	);
});

test("front menu lint blocks restoring deleted editorial items from a release", () => {
	const path = "apps/site/src/lib/native-front-presentation.ts";
	assert.ok(
		lintFrontMenuSource(
			path,
			"function projectEditorialNavigation(editorial, release) { return [...editorial,...release.flatMap(group=>group.items)]; }",
		).some(({ code }) => code.includes("no-release-menu-append")),
	);
	assert.deepEqual(
		lintFrontMenuSource(
			path,
			"function projectEditorialNavigation(editorial, release) { const allowed=release.map(group=>group.items); return editorial.filter(group=>allowed.includes(group)); }",
		),
		[],
	);
});

test("front menu lint detects calculated destinations in arbitrarily named helpers", () => {
	for (const source of [
		'const section="reports"; export const entries=[{label:`Reports`,href:`/analytics/${section}`}];',
		'function destination(id) { return "/analytics/" + id; } export const entries=[{label:"Reports",href:destination("reports")}];',
		"export const entries=[{'label':'Sales','items':[]}];",
	])
		assert.ok(lintFrontMenuSource("apps/site/src/lib/helpers.ts", source).length > 0, source);
});

test("front menu lint rejects fixed or unrelated locales despite a locale property", () => {
	for (const choice of ['"en"', '"ar"', "browserLocale"]) {
		const source = `---\nconst selected = resolveUserFrontRequestLocale(Astro.request); const menu = getMenu("superboard-admin", {locale:${choice}});\n---`;
		assert.ok(
			lintFrontMenuSource("apps/site/src/components/FrontPage.astro", source).some((item) =>
				item.code.includes("front-menu-locale"),
			),
			choice,
		);
	}
});

test("front menu lint detects release aliases after a helper is renamed", () => {
	const source =
		"function combine(editorial, release) { const extra = release.flatMap(group => group.items); return [...editorial,...extra]; }";
	assert.ok(
		lintFrontMenuSource("apps/site/src/lib/helpers.ts", source).some((item) =>
			item.code.includes("no-release-menu-append"),
		),
	);
});

test("Astro template links and imported helpers are checked without filename conventions", async () => {
	const files = new Map([
		[
			"apps/site/src/pages/example.astro",
			'---\nimport { destination as target } from "../helpers/anything.js";\n---\n<nav><a href={target("reports")}>Reports</a></nav>',
		],
		[
			"apps/site/src/helpers/anything.ts",
			"export function destination(id) { return `/analytics/${id}`; }",
		],
	]);
	const diagnostics = await lintFrontMenuProject(resolve(import.meta.dirname, ".."), files);
	assert.ok(
		diagnostics.some(
			(item) =>
				item.filename.endsWith("example.astro") && item.code.includes("no-hardcoded-front-menu"),
		),
	);
});

test("aliased native menu and request-locale imports are accepted", () => {
	const source =
		'---\nimport {getMenu as read} from "emdash"; import {resolveUserFrontRequestLocale as choose} from "../lib/user-front-i18n.js"; const selected=choose(Astro.request); const choice=selected; const options={locale:choice}; const menu=read("superboard-admin",options);\n---';
	assert.deepEqual(lintFrontMenuSource("apps/site/src/components/FrontPage.astro", source), []);
});

test("front language restrictions do not disable Arabic in native EmDash", () => {
	assert.ok(
		lintFrontMenuSource(
			"apps/site/src/lib/user-front-catalogs.ts",
			"export const messages={en:{},fr:{},ar:{}};",
		).some((item) => item.code.includes("front-languages")),
	);
	assert.deepEqual(
		lintFrontMenuSource(
			"packages/admin/src/locales/locales.ts",
			'export const locales=[{code:"ar",enabled:true}];',
		),
		[],
	);
});

test("an unused native lookup cannot authorize a separate rendered menu", () => {
	const source =
		'---\nconst locale=resolveUserFrontRequestLocale(Astro.request); const menu=getMenu("superboard-admin",{locale}); const configuration={navigation:[]}; const projection=projectNativeFrontPresentation(model,locale,configuration);\n---';
	assert.ok(
		lintFrontMenuSource("apps/site/src/components/FrontPage.astro", source).some((item) =>
			item.code.includes("front-menu-source"),
		),
	);
});
