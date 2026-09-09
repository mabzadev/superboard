import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkSuperBoardBrand, validateSuperBoardBrand } from "./superboard-brand.mjs";

test("canonical SuperBoard brand contract is strict and valid", async () => {
	const manifest = await checkSuperBoardBrand();
	assert.equal(manifest.brand.name, "SuperBoard");
	assert.equal(manifest.repositories.canonical, "mabzadev/superboard");
	assert.deepEqual(manifest.repositories.layout, {
		platform: ".",
		reference: "apps/reference",
	});
	assert.equal(manifest.developmentDomains.dashboard, "board.mbza.dev");
	assert.equal(manifest.developmentDomains.shortLinks, "in.mbza.dev");
	assert.deepEqual(manifest.sdkStrategy.active, ["flutter", "flutterflow"]);
});

test("schema rejects an unreviewed product name", async () => {
	const fixture = await mkdtemp(join(tmpdir(), "superboard-brand-"));
	await mkdir(join(fixture, "config"), { recursive: true });
	await mkdir(join(fixture, "schemas"), { recursive: true });
	const schema = await readFile(
		new URL("../schemas/superboard-brand.schema.json", import.meta.url),
		"utf8",
	);
	const manifest = JSON.parse(
		await readFile(new URL("../config/superboard-brand.json", import.meta.url), "utf8"),
	);
	manifest.brand.name = "OpenGrow";
	await writeFile(join(fixture, "schemas/superboard-brand.schema.json"), schema);
	await writeFile(
		join(fixture, "config/superboard-brand.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	await assert.rejects(
		validateSuperBoardBrand({ repositoryRoot: fixture }),
		/invalid SuperBoard brand contract/u,
	);
});

test("active brand checks cover Site and plugin sources without a retired application", async (context) => {
	const fixture = await mkdtemp(join(tmpdir(), "superboard-active-brand-"));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	for (const file of [
		"config/superboard-brand.json",
		"schemas/superboard-brand.schema.json",
		"deploy/targets/mbza-development.json",
	]) {
		const target = join(fixture, file);
		await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
		await writeFile(target, await readFile(new URL(`../${file}`, import.meta.url)));
	}
	const dir = join(fixture, "apps/site/src");
	await mkdir(dir, { recursive: true });
	const file = join(dir, "Page.tsx");
	await writeFile(file, 'export const title="OpenGrow";');
	execFileSync("git", ["init", "--quiet"], { cwd: fixture });
	execFileSync("git", ["add", "."], { cwd: fixture });
	await assert.rejects(
		checkSuperBoardBrand({ repositoryRoot: fixture }),
		/legacy active brand references/u,
	);
	await writeFile(file, 'export const title="SuperBoard";');
	execFileSync("git", ["add", "."], { cwd: fixture });
	await assert.doesNotReject(checkSuperBoardBrand({ repositoryRoot: fixture }));
});

test("brand checks reject untracked UI and catalogue labels while preserving SDK coordinates", async (context) => {
	const fixture = await mkdtemp(join(tmpdir(), "superboard-brand-copy-"));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	for (const file of [
		"config/superboard-brand.json",
		"schemas/superboard-brand.schema.json",
		"deploy/targets/mbza-development.json",
	]) {
		const target = join(fixture, file);
		await mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
		await writeFile(target, await readFile(new URL(`../${file}`, import.meta.url)));
	}
	execFileSync("git", ["init", "--quiet"], { cwd: fixture });
	execFileSync("git", ["add", "."], { cwd: fixture });
	const source = join(fixture, "packages/supbrd-runtime-plugins/src/front/NewPage.tsx");
	await mkdir(join(source, ".."), { recursive: true });
	for (const name of [
		"OpenGrow",
		"OpenFlow",
		"Openflow",
		"openGrow",
		"opengrow",
		"OPENFLOW",
		"open-grow",
		"Superboard",
	]) {
		await writeFile(source, `export const title = "${name}";`);
		await assert.rejects(checkSuperBoardBrand({ repositoryRoot: fixture }), /NewPage\.tsx/u);
	}
	await writeFile(source, 'export const title = "SuperBoard";');
	const catalogue = join(fixture, "config/sdk-libraries.json");
	const library = { displayName: "SuperBoard iOS", packageName: "OpenGrow" };
	await writeFile(catalogue, JSON.stringify({ libraries: [library] }));
	await assert.doesNotReject(checkSuperBoardBrand({ repositoryRoot: fixture }));
	await writeFile(
		catalogue,
		JSON.stringify({ libraries: [{ ...library, displayName: "OpenGrow iOS" }] }),
	);
	await assert.rejects(checkSuperBoardBrand({ repositoryRoot: fixture }), /sdk-libraries\.json/u);
	await rm(catalogue);
	await writeFile(
		join(fixture, "config/superboard-plugin-packages.json"),
		JSON.stringify({ packages: [{ label_fr: "Superboard" }] }),
	);
	await assert.rejects(
		checkSuperBoardBrand({ repositoryRoot: fixture }),
		/superboard-plugin-packages\.json/u,
	);
});
