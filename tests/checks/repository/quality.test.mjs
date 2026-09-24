import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { resolve } from "node:path";
import test from "node:test";

import { ESLint } from "eslint";

import { selectChangedSources } from "../../lints/lint.mjs";
import { parseDartDiagnostics, parseSarif } from "../../lints/native.mjs";
import {
	applyBaseline,
	baselineKey,
	captureBaseline,
	lintMigrations,
	normalizeKnip,
	parseToolResult,
	qualitySources,
	testDependencyDeclared,
	lintBaselineChanges,
} from "../../lints/quality.mjs";
import { lintCommandPaths, lintConfigurationSource } from "../../lints/repository.mjs";

test("script validation catches relocated and empty test globs without executing commands", (context) => {
	const root = mkdtempSync(join(tmpdir(), "superboard-command-lint-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "tests/checks/database"), { recursive: true });
	writeFileSync(join(root, "tests/checks/database/d1-backup.test.mjs"), "");
	const check = (command) => lintCommandPaths(root, "package.json", { test: command });
	assert.equal(check("node --test scripts/database/d1-*.test.mjs").length, 1);
	assert.equal(check("node --test tests/checks/database/missing-*.test.mjs").length, 1);
	assert.deepEqual(check("node --test tests/checks/database/d1-*.test.mjs"), []);
	assert.deepEqual(check('node --test "tests/checks/database/d1-*.test.mjs"'), []);
});

test("configuration parsing preserves URLs and rejects duplicate keys", () => {
	assert.deepEqual(
		lintConfigurationSource(
			"wrangler.jsonc",
			'{ // comment\n "url": "https://example.com/a/*b", }',
		),
		[],
	);
	assert.equal(
		lintConfigurationSource("config.json", '{"enabled": true,"enabled": false}').length,
		1,
	);
	assert.equal(lintConfigurationSource("config.yaml", "enabled: true\nenabled: false\n").length, 1);
	assert.equal(lintConfigurationSource("config.json", '{"broken": }').length, 1);
});

const repository = resolve(import.meta.dirname, "../../..");
const eslint = new ESLint({
	cwd: repository,
	overrideConfigFile: resolve(repository, "tests/lints/quality.config.mjs"),
	allowInlineConfig: false,
});
const examples = [
	[
		"superboard/section-navigation-layout",
		"apps/site/src/components/NativeFrontApp.tsx",
		'export const View=()=> <main><nav className="native-front-local-navigation"/><section><h1>Title</h1></section></main>;',
		'export const View=()=> <main><section><h1>Title</h1><nav className="native-front-local-navigation"/></section></main>;',
	],
	[
		"superboard/local-dev-hosts",
		"apps/site/astro.config.mjs",
		"export default {server:{allowedHosts:true}};",
		'export default {server:{allowedHosts:["site.internal"]}};',
	],
	[
		"superboard/api-route-contract",
		"packages/core/src/astro/routes/api/content/new.ts",
		"export const POST=()=>new Response();",
		"export const prerender=false; export const POST=()=>new Response();",
	],
	[
		"superboard/checked-fetch-response",
		"packages/core/src/http.ts",
		"async function load(){ const response=await fetch(url); return response.json(); }",
		'async function load(){ const response=await fetch(url); if(!response.ok) throw new Error("Request failed"); return response.json(); }',
	],
	[
		"superboard/test-integrity",
		"tests/checks/repository/example.test.mjs",
		'import {test as scenario} from "node:test"; scenario("focused",{only:true},()=>{});',
		'import {test as scenario} from "node:test"; scenario("all",()=>{});',
	],
	[
		"superboard/test-integrity",
		"tests/e2e/site/example.spec.ts",
		'test.describe.only("focused",()=>{});',
		'test.describe("all",()=>{});',
	],
	[
		"superboard/runtime-i18n",
		"packages/supbrd-front-ui/src/locale.ts",
		'import { setupI18n as create } from "@lingui/core"; export const i18n=create({});',
		'import { createFrontI18n } from "./i18n.js"; export const i18n=createFrontI18n({});',
	],
	[
		"superboard/safe-sql",
		"packages/core/src/example.ts",
		"sql.raw(`SELECT * FROM ${table}`);",
		"sql`SELECT * FROM ${sql.ref(table)}`;",
	],
	[
		"superboard/secret-access",
		"apps/site/src/example.ts",
		"export const key=import.meta.env.API_SECRET;",
		"export const key=process.env.API_SECRET;",
	],
	[
		"superboard/secret-access",
		"apps/site/src/example.ts",
		"console.log(accessToken);",
		'console.log({ event: "authentication_failed" });',
	],
	[
		"superboard/package-boundaries",
		"packages/supbrd-core/src/example.ts",
		'import { x } from "../../../apps/site/src/internal.js";',
		'import { x } from "@superboard/contracts";',
	],
	[
		"superboard/package-boundaries",
		"packages/plugins/superboard-core/src/example.ts",
		'import { x } from "../../supbrd-plug-support/src/private.js";',
		'import { x } from "@superboard/plugin-support";',
	],
	[
		"superboard/worker-io",
		"packages/plugins/superboard-core/api/src/example.ts",
		"const response=await fetch(url,{signal});",
		"export async function handle(url,signal){return fetch(url,{signal});}",
	],
	[
		"superboard/worker-io",
		"packages/plugins/superboard-core/api/src/example.ts",
		"export async function handle(url){return fetch(url);}",
		"export async function handle(url,signal){return fetch(url,{signal});}",
	],
	[
		"superboard/test-integrity",
		"tests/checks/repository/example.test.mjs",
		'test.only("only me",()=>{});',
		'test("whole suite",()=>{});',
	],
	[
		"superboard/test-integrity",
		"tests/checks/repository/example.test.mjs",
		'test.skip("missing prerequisite",()=>{});',
		'// Requires the unavailable device simulator.\ntest.skip("device test",()=>{});',
	],
	[
		"superboard/documented-suppression",
		"scripts/example.mjs",
		"// eslint-disable\nexport const x=1;",
		"// eslint-disable-next-line no-console -- CLI output is the command result.\nconsole.log(1);",
	],
	[
		"superboard/localized-ui",
		"packages/supbrd-front-ui/src/Example.tsx",
		"export const View=()=> <span>Hello world</span>;",
		"export const View=()=> <Trans>Hello world</Trans>;",
	],
	[
		"superboard/localized-ui",
		"packages/supbrd-front-ui/src/Example.tsx",
		'export const View=()=> <div className="ml-4"/>;',
		'export const View=()=> <div className="ms-4"/>;',
	],
	[
		"jsx-a11y/label-has-associated-control",
		"packages/supbrd-front-ui/src/Example.tsx",
		"export const View=()=> <label>Name</label>;",
		'export const View=()=> <label htmlFor="name">Name<input id="name"/></label>;',
	],
	[
		"react-hooks/rules-of-hooks",
		"packages/supbrd-front-ui/src/Example.tsx",
		'import {useState} from "react"; export function View({enabled}){if(enabled)useState(0);return null;}',
		'import {useState} from "react"; export function View(){const [value]=useState(0);return <span>{value}</span>;}',
	],
];
for (const [rule, path, invalid, valid] of examples) {
	test(`${rule} distinguishes invalid and valid behavior in ${path}`, async () => {
		const run = async (source) =>
			(await eslint.lintText(source, { filePath: path })).flatMap((report) =>
				report.messages.filter((message) => message.ruleId === rule),
			);
		assert.ok((await run(invalid)).length > 0, invalid);
		assert.deepEqual(await run(valid), []);
	});
}

test("Astro templates are parsed and checked for accessible images", async () => {
	const check = async (source) =>
		(await eslint.lintText(source, { filePath: "apps/site/src/pages/lint-probe.astro" }))[0];
	const invalid = await check('---\nconst source="/image.png";\n---\n<img src={source} />');
	assert.ok(invalid.messages.some((message) => message.ruleId === "astro/jsx-a11y/alt-text"));
	const valid = await check('---\nconst source="/image.png";\n---\n<img src={source} alt="" />');
	assert.equal(valid.errorCount, 0);
});

test("Front code may import Lingui types without creating a runtime instance", async () => {
	for (const source of [
		'import type { I18n } from "@lingui/core"; export type Context = I18n;',
		'import { type I18n } from "@lingui/core"; export type Context = I18n;',
	]) {
		const reports = await eslint.lintText(source, {
			filePath: "packages/supbrd-front-ui/src/types.ts",
		});
		assert.equal(
			reports[0].messages.filter((message) => message.ruleId === "superboard/runtime-i18n").length,
			0,
		);
	}
});

test("checking a response in another scope does not authorize an unchecked response", async () => {
	const results = await eslint.lintText(
		'async function good(){ const response=await fetch(url); if(!response.ok) throw new Error("failed"); return response.json(); } async function bad(){ const response=await fetch(url); return response.json(); }',
		{ filePath: "apps/site/src/http.ts" },
	);
	assert.equal(
		results[0].messages.filter((message) => message.ruleId === "superboard/checked-fetch-response")
			.length,
		1,
	);
});

test("the real typed analyzer detects unhandled promises and accepts awaited operations", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "superboard-typed-lint-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	writeFileSync(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { strict: true, target: "ES2022", module: "preserve", noEmit: true },
			include: ["*.ts"],
		}),
	);
	const path = join(directory, "example.ts");
	function check(source) {
		writeFileSync(path, source);
		const result = spawnSync(
			resolve(repository, "node_modules/.bin/oxlint"),
			[
				"--config",
				resolve(repository, "tests/lints/quality.oxlintrc.json"),
				"--disable-nested-config",
				"--type-aware",
				"--format",
				"json",
				path,
			],
			{
				cwd: repository,
				encoding: "utf8",
				timeout: 30000,
				env: { ...process.env, GOMAXPROCS: "2" },
			},
		);
		return parseToolResult(result, "typed regression").diagnostics;
	}
	const declaration = "declare function send(): Promise<void>;\n";
	assert.ok(
		check(declaration + "export function broken(){ send(); }").some((item) =>
			item.code.includes("no-floating-promises"),
		),
	);
	assert.deepEqual(check(declaration + "export async function valid(){ await send(); }"), []);
});

test("baseline allowances cannot absorb new copies or altered findings", () => {
	const item = {
		filename: "example.ts",
		code: "quality(example)",
		message: "unsafe operation",
		labels: [{ span: { line: 1 } }],
	};
	const key = baselineKey(item, "unsafe();");
	const baseline = { entries: { [key]: 1 } };
	assert.equal(applyBaseline([item], baseline, () => "unsafe();").existing, 1);
	assert.equal(applyBaseline([item, item], baseline, () => "unsafe();").diagnostics.length, 1);
	assert.equal(applyBaseline([item], baseline, () => "changed();").diagnostics.length, 1);
	assert.equal(
		applyBaseline([{ ...item, filename: "another.ts" }], baseline, () => "unsafe();").diagnostics
			.length,
		1,
	);
	assert.throws(
		() => captureBaseline([{ ...item, code: "quality(tool-failure)" }]),
		/before capturing/u,
	);
});

test("moving an unchanged finding does not create new debt through diagnostic code-frame positions", () => {
	const before = {
		filename: "src/Panel.tsx",
		code: "quality-eslint(react-hooks/set-state-in-effect)",
		message: "Avoid synchronous state changes\n\n/work/src/Panel.tsx:1:1\n> 1 | setValue(next);",
		labels: [{ span: { line: 1 } }],
	};
	const after = {
		...before,
		message: "Avoid synchronous state changes\n\n/other/src/Panel.tsx:3:1\n> 3 | setValue(next);",
		labels: [{ span: { line: 3 } }],
	};
	expectStable();
	function expectStable() {
		assert.equal(baselineKey(before, "setValue(next);"), baselineKey(after, "\n\nsetValue(next);"));
		assert.notEqual(
			baselineKey(before, "setValue(next);"),
			baselineKey(after, "\n\nsetValue(other);"),
		);
	}
});

test("failed or malformed analyzer processes never report success", () => {
	for (const result of [
		{ status: 2, stdout: "{}", stderr: "bad configuration" },
		{ status: null, signal: "SIGTERM", stdout: "{}" },
		{ status: 0, stdout: "not json" },
	])
		assert.throws(() => parseToolResult(result, "analyzer"));
	assert.throws(() => normalizeKnip({ files: [] }), /invalid report/u);
});

test("Knip ownership metadata is not an unused symbol and enum members remain checked", () => {
	const results = normalizeKnip({
		files: [],
		issues: [
			{
				file: "src/index.ts",
				owners: [{ name: "maintainer" }],
				exports: [{ name: "unused" }],
				enumMembers: { Mode: [{ name: "old" }] },
			},
		],
	});
	assert.equal(results.length, 2);
	assert.ok(results.some((item) => item.message.includes("Mode.old")));
});

test("central tests use their owner's dependencies without allowing undeclared imports", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "superboard-test-owner-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	mkdirSync(join(directory, "packages/plugins/example/worker"), { recursive: true });
	writeFileSync(
		join(directory, "packages/plugins/example/package.json"),
		JSON.stringify({ name: "@example/plugin", dependencies: { react: "1" } }),
	);
	writeFileSync(
		join(directory, "packages/plugins/example/worker/package.json"),
		JSON.stringify({ name: "@example/worker", devDependencies: { vitest: "1" } }),
	);
	assert.equal(
		testDependencyDeclared(
			"tests/checks/plugins/example/worker/unit/sample.test.ts",
			"vitest",
			directory,
		),
		true,
	);
	assert.equal(
		testDependencyDeclared(
			"tests/checks/plugins/example/worker/unit/sample.test.ts",
			"react",
			directory,
		),
		false,
	);
	assert.equal(
		testDependencyDeclared(
			"tests/checks/plugins/example/front/sample.test.tsx",
			"react",
			directory,
		),
		true,
	);
	assert.equal(
		testDependencyDeclared(
			"tests/checks/plugins/example/front/sample.test.tsx",
			"undeclared",
			directory,
		),
		false,
	);
});

test("Cloudflare's virtual test module requires its test runtime and is not a bare npm import", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "cloudflare-test-module-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const owner = join(directory, "packages/plugins/example/worker");
	const filename = "tests/checks/plugins/example/worker/runtime/settings.test.ts";
	mkdirSync(owner, { recursive: true });
	mkdirSync(dirname(join(directory, filename)), { recursive: true });
	writeFileSync(
		join(owner, "package.json"),
		JSON.stringify({ devDependencies: { "@cloudflare/vitest-pool-workers": "1" } }),
	);
	writeFileSync(
		join(directory, filename),
		'import { env } from "cloudflare:test";\nimport cloudflare from "cloudflare";\n',
	);
	assert.equal(testDependencyDeclared(filename, "cloudflare", directory, 1), true);
	assert.equal(testDependencyDeclared(filename, "cloudflare", directory, 2), false);
	writeFileSync(join(owner, "package.json"), JSON.stringify({ devDependencies: { vitest: "1" } }));
	assert.equal(testDependencyDeclared(filename, "cloudflare", directory, 1), false);
});

test("handwritten declarations and Astro receive coverage while vendor bundles do not", () => {
	const paths = [
		"sdks/web/src/index.d.ts",
		"apps/site/src/pages/index.astro",
		"sdks/react-native/.yarn/releases/yarn.cjs",
		"packages/core/worker-configuration.d.ts",
	];
	assert.deepEqual(qualitySources(paths), paths.slice(0, 2));
	assert.deepEqual(selectChangedSources(paths, [paths[0]]), [paths[0]]);
	assert.deepEqual(selectChangedSources(paths, ["tests/lints/quality.config.mjs"]), paths);
});

test("native reports preserve errors and reject malformed reports", () => {
	assert.equal(
		parseDartDiagnostics(
			"ERROR|COMPILE_TIME_ERROR|INVALID_ASSIGNMENT|/tmp/example.dart|4|2|3|Invalid assignment",
		)[0].labels[0].span.line,
		4,
	);
	assert.throws(() => parseDartDiagnostics("analyzer unavailable"));
	assert.throws(() => parseSarif({}));
	assert.equal(
		parseSarif({
			runs: [
				{
					results: [
						{
							ruleId: "UnsafeCall",
							message: { text: "unsafe" },
							locations: [
								{
									physicalLocation: {
										artifactLocation: { uri: "sdks/example.kt" },
										region: { startLine: 8 },
									},
								},
							],
						},
					],
				},
			],
		})[0].labels[0].span.line,
		8,
	);
});

test("existing migrations cannot change or disappear but forward additions remain allowed", (context) => {
	const directory = mkdtempSync(join(tmpdir(), "superboard-migration-lint-"));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	const git = (...args) => {
		const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	};
	git("init", "-q");
	mkdirSync(join(directory, "tests/lints"), { recursive: true });
	const baseline = join(directory, "tests/lints/baseline.json");
	writeFileSync(baseline, JSON.stringify({ entries: { existing: 1 } }));
	mkdirSync(join(directory, "packages/example/migrations"), { recursive: true });
	const migration = join(directory, "packages/example/migrations/0001_initial.sql");
	writeFileSync(migration, "CREATE TABLE example (id TEXT);\n");
	git("add", ".");
	git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"initial",
	);
	assert.deepEqual(lintBaselineChanges("HEAD", directory), []);
	writeFileSync(baseline, JSON.stringify({ entries: { existing: 1, extra: 1 } }));
	assert.equal(lintBaselineChanges("HEAD", directory).length, 1);
	writeFileSync(baseline, JSON.stringify({ entries: {} }));
	assert.deepEqual(lintBaselineChanges("HEAD", directory), []);
	writeFileSync(
		join(directory, "packages/example/migrations/0002_next.sql"),
		"CREATE TABLE next (id TEXT);\n",
	);
	assert.deepEqual(lintMigrations("HEAD", directory), []);
	writeFileSync(migration, "DROP TABLE example;\n");
	assert.equal(lintMigrations("HEAD", directory).length, 1);
	rmSync(migration);
	assert.equal(lintMigrations("HEAD", directory).length, 1);
});

test("directory-level diagnostics remain visible without trying to read a directory as source", () => {
	const item = {
		filename: "packages/core",
		code: "quality(knip-unresolved)",
		message: "unresolved dependency",
	};
	const result = applyBaseline([item], { entries: {} });
	assert.deepEqual(result.diagnostics, [item]);
	assert.equal(result.existing, 0);
	assert.equal(result.total, 1);
	const baseline = captureBaseline([item]);
	assert.equal(baseline.entries[baselineKey(item)], 1);
});

test("source relocations preserve existing findings but never suppress changed code", () => {
	const before = {
		filename: "packages/plugins/supbrd-plug-commerce/paywalls/src/example.ts",
		code: "quality-example",
		message: "Existing finding",
		labels: [{ span: { line: 1 } }],
	};
	const after = {
		...before,
		filename: "packages/plugins/superboard-acquisition/paywalls/src/example.ts",
	};
	const baseline = { entries: { [baselineKey(before, "existing();")]: 1 } };
	assert.equal(applyBaseline([after], baseline, () => "existing();").diagnostics.length, 0);
	assert.equal(applyBaseline([after], baseline, () => "changed();").diagnostics.length, 1);
	assert.equal(applyBaseline([after, after], baseline, () => "existing();").diagnostics.length, 1);
});

test("a relocated migration must retain its exact bytes", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "migration-relocation-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const git = (...args) => {
		const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	};
	const oldPath = "packages/plugins/supbrd-plug-commerce/paywalls/migrations/0001_initial.sql";
	const newPath = "packages/plugins/superboard-acquisition/paywalls/migrations/0001_initial.sql";
	for (const path of [oldPath, newPath])
		mkdirSync(dirname(join(directory, path)), { recursive: true });
	writeFileSync(join(directory, oldPath), "CREATE TABLE example (id TEXT);\n");
	git("init", "-q");
	git("add", ".");
	git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.invalid",
		"-c",
		"core.hooksPath=/dev/null",
		"commit",
		"-qm",
		"initial",
	);
	writeFileSync(join(directory, newPath), readFileSync(join(directory, oldPath)));
	rmSync(join(directory, oldPath));
	assert.deepEqual(lintMigrations("HEAD", directory), []);
	writeFileSync(join(directory, newPath), "DROP TABLE example;\n");
	assert.equal(lintMigrations("HEAD", directory).length, 1);
	rmSync(join(directory, newPath));
	assert.equal(lintMigrations("HEAD", directory).length, 1);
});
