import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function fixture(context, source) {
	const root = mkdtempSync(join(tmpdir(), "superboard-copy-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, "packages/plugins/supbrd-plug-support/src/front/Page.tsx");
	mkdirSync(resolve(path, ".."), { recursive: true });
	writeFileSync(path, source);
	return () =>
		spawnSync(
			process.execPath,
			[resolve(import.meta.dirname, "../../lints/product-copy.mjs"), "--root", root],
			{ encoding: "utf8" },
		);
}
test("product copy catches deployment branding in the plugin Front without a retired application", (context) => {
	const run = fixture(context, 'export const title="VocoStar";');
	const result = run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /deployment-specific branding/u);
});

test("product copy accepts the platform brand and generic application descriptions", (context) => {
	for (const title of ["SuperBoard", "Reference application"]) {
		const result = fixture(context, `export const title="${title}";`)();
		assert.equal(result.status, 0, result.stderr);
	}
});
test("product copy allows translated catalog entries while checking unlocalized French", (context) => {
	const clean = fixture(
		context,
		'const messages={en:{title:"Settings"},fr:{title:"Paramètres"}}; export const title=messages.en.title;',
	)();
	assert.equal(clean.status, 0, clean.stderr);
	const invalid = fixture(context, 'export const title="Paramètres";')();
	assert.equal(invalid.status, 1);
	assert.match(invalid.stderr, /non-English product copy/u);
});

test("product copy recognizes explicit French catalogs, locale branches and language-tagged documents", (context) => {
	for (const source of [
		'const en={title:"Settings"}; const fr={title:"Paramètres"}; const frCopy={Settings:"Paramètres"};',
		'const locale="fr"; const fr=locale==="fr"; export const label=fr?"Paramètres":"Settings";',
		'export const page=`<html lang="fr"><h1>Paramètres</h1></html>`;',
	]) {
		const result = fixture(context, source)();
		assert.equal(result.status, 0, result.stderr);
	}
});
