import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const packageJson = JSON.parse(
	await readFile(new URL("../../../../sdks/web/package.json", import.meta.url), "utf8"),
);
const forbiddenSupportPublication = [
	/\b(?:openchat|chatwoot)\b/iu,
	/\baction[ _-]?cable\b/iu,
	/\bactive[ _-]?storage\b/iu,
	/\/api\/v1\/accounts(?:\/|\b)/iu,
	/\/rails(?:\/|\b)/iu,
	/\/twilio(?:\/|\b)/iu,
];

test("the built package loads through both ESM import and CommonJS require", async () => {
	const esm = await import(
		new URL("../../../../sdks/web/" + packageJson.exports["."].import, import.meta.url)
	);
	const require = createRequire(new URL("../../../../sdks/web/package.json", import.meta.url));
	const commonJs = require(packageJson.name);

	assert.equal(typeof esm.default, "function");
	assert.equal(typeof commonJs, "function");
	assert.equal(typeof esm.default.prototype.start, "function");
	assert.equal(typeof commonJs.prototype.start, "function");
	assert.equal(typeof esm.SuperBoardClient, "function");
	assert.equal(typeof commonJs.SuperBoardClient, "function");
	assert.equal(typeof esm.SuperBoardSupportClient, "function");
	assert.equal(typeof esm.SuperBoardSupportException, "function");
	assert.equal(typeof esm.SuperBoardSupportWidget, "function");
	assert.equal(typeof commonJs.SuperBoardSupportClient, "function");
	assert.equal(typeof commonJs.SuperBoardSupportException, "function");
	assert.equal(typeof commonJs.SuperBoardSupportWidget, "function");
});

test("the Support subpath loads through both ESM import and CommonJS require", async () => {
	const esm = await import(
		new URL("../../../../sdks/web/" + packageJson.exports["./support"].import, import.meta.url)
	);
	const require = createRequire(new URL("../../../../sdks/web/package.json", import.meta.url));
	const commonJs = require(`${packageJson.name}/support`);

	for (const name of [
		"SuperBoardSupportClient",
		"SuperBoardSupportException",
		"SuperBoardSupportRealtime",
		"SuperBoardSupportWidget",
	]) {
		assert.equal(typeof esm[name], "function");
		assert.equal(typeof commonJs[name], "function");
	}
});

test("published Support bundles, declarations, and examples contain no inherited surface", async () => {
	const publications = await Promise.all(
		["../dist/support.js", "../dist/support.umd.cjs", "../dist/support.d.ts", "../README.md"].map(
			(path) =>
				readFile(
					new URL("../../../../sdks/web/" + path.replace(/^\.\.\//u, ""), import.meta.url),
					"utf8",
				),
		),
	);
	for (const source of publications) {
		for (const pattern of forbiddenSupportPublication) {
			assert.doesNotMatch(source, pattern);
		}
	}
});

for (const [subpath, entrypoint] of [
	["identity", "triggerLogin"],
	["flows", "startWorkflow"],
	["flows/react", "FlowsProvider"],
	["flows/components", "setupJsComponents"],
	["flows/react-components", "BasicsV2Card"],
]) {
	test(`the built ${subpath} module resolves its bundled dependencies`, async () => {
		const target = packageJson.exports[`./${subpath}`].import;
		const module = await import(new URL(`../../../../sdks/web/${target}`, import.meta.url));
		assert.equal(typeof module[entrypoint], "function");
	});
}

test("vanilla Web consumers do not need React; only React integrations load it", () => {
	execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
  import assert from 'node:assert/strict';
  import { registerHooks } from 'node:module';
  registerHooks({ resolve(specifier, context, nextResolve) {
   if (specifier === 'react' || specifier.startsWith('react/')) {
    const error = new Error('React is not installed');
    error.code = 'ERR_MODULE_NOT_FOUND';
    throw error;
   }
   return nextResolve(specifier, context);
  }});
  await import('@superboard/web');
  await import('@superboard/web/client');
  await import('@superboard/web/support');
  await import('@superboard/web/flows');
  await assert.rejects(import('@superboard/web/flows/react'), /React is not installed/);
 `,
		],
		{ cwd: new URL("../../../../sdks/web/", import.meta.url), stdio: "pipe" },
	);
});
