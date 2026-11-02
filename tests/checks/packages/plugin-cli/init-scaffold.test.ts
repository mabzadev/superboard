import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InitError, scaffold } from "../../../../packages/plugin-cli/src/init/scaffold.js";
import type { ScaffoldInputs } from "../../../../packages/plugin-cli/src/init/templates.js";
import { loadManifest } from "../../../../packages/plugin-cli/src/manifest/load.js";

const FULL_INPUTS: ScaffoldInputs = {
	slug: "gallery",
	publisher: "did:plc:abc123def456",
	publisherHandle: "example.com",
	license: "MIT",
	author: { name: "Jane Doe" },
	security: { email: "security@example.com" },
	description: undefined,
	repo: undefined,
};

const MINIMAL_INPUTS: ScaffoldInputs = {
	slug: "gallery",
	publisher: undefined,
	publisherHandle: undefined,
	license: undefined,
	author: undefined,
	security: undefined,
	description: undefined,
	repo: undefined,
};

describe("scaffold", () => {
	let targetDir: string;

	beforeEach(async () => {
		const root = await mkdtemp(join(tmpdir(), "emdash-init-test-"));
		targetDir = join(root, "plugin");
	});

	afterEach(async () => {
		const root = targetDir.replace(/\/plugin$/, "");
		await rm(root, { recursive: true, force: true });
	});

	it("writes the expected file tree", async () => {
		const result = await scaffold({ targetDir, inputs: FULL_INPUTS, force: false });
		expect(result.written).toHaveLength(7);

		const fileSet = new Set(result.written.map((p) => p.replace(`${targetDir}/`, "")));
		expect(fileSet.has("emdash-plugin.jsonc")).toBe(true);
		expect(fileSet.has("package.json")).toBe(true);
		expect(fileSet.has("tsconfig.json")).toBe(true);
		expect(fileSet.has(".gitignore")).toBe(true);
		expect(fileSet.has("README.md")).toBe(true);
		expect(fileSet.has("src/plugin.ts")).toBe(true);
		expect(fileSet.has("tests/plugin.test.ts")).toBe(true);
	});

	it("produces a manifest that the loader accepts", async () => {
		await scaffold({ targetDir, inputs: FULL_INPUTS, force: false });
		const { manifest } = await loadManifest(targetDir);
		expect(manifest.slug).toBe("gallery");
		expect(manifest.version).toBeUndefined();
		expect(manifest.publisher).toBe("did:plc:abc123def456");
		expect(manifest.license).toBe("MIT");
	});

	it("produces a minimal manifest that round-trips through the loader (with empty publisher)", async () => {
		await scaffold({ targetDir, inputs: MINIMAL_INPUTS, force: false });
		await expect(loadManifest(targetDir)).rejects.toMatchObject({
			name: "ManifestError",
			code: "MANIFEST_VALIDATION_ERROR",
		});
	});

	it("refuses to overwrite an existing file without --force", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(targetDir, { recursive: true });
		await writeFile(join(targetDir, "package.json"), "{}", "utf8");

		await expect(scaffold({ targetDir, inputs: FULL_INPUTS, force: false })).rejects.toMatchObject({
			name: "InitError",
			code: "TARGET_FILE_EXISTS",
			conflicts: ["package.json"],
		});

		const contents = await readFile(join(targetDir, "package.json"), "utf8");
		expect(contents).toBe("{}");
	});

	it("does not partially write when a conflict is detected", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(targetDir, { recursive: true });
		await writeFile(join(targetDir, "package.json"), "{}", "utf8");

		await expect(scaffold({ targetDir, inputs: FULL_INPUTS, force: false })).rejects.toThrow(
			InitError,
		);

		const entries = await readdir(targetDir);
		expect(entries).toEqual(["package.json"]);
	});

	it("overwrites existing files when --force is set", async () => {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(targetDir, { recursive: true });
		await writeFile(join(targetDir, "package.json"), "{}", "utf8");

		await scaffold({ targetDir, inputs: FULL_INPUTS, force: true });
		const contents = await readFile(join(targetDir, "package.json"), "utf8");
		const parsed = JSON.parse(contents) as { name: string };
		expect(parsed.name).toBe("gallery");
	});

	it("creates intermediate directories (src/, tests/)", async () => {
		await scaffold({ targetDir, inputs: FULL_INPUTS, force: false });
		const srcStat = await stat(join(targetDir, "src"));
		const testsStat = await stat(join(targetDir, "tests"));
		expect(srcStat.isDirectory()).toBe(true);
		expect(testsStat.isDirectory()).toBe(true);
	});

	it("invokes onFileWritten once per file in scaffold order", async () => {
		const calls: string[] = [];
		await scaffold({
			targetDir,
			inputs: FULL_INPUTS,
			force: false,
			onFileWritten: (rel) => calls.push(rel),
		});
		expect(calls).toEqual([
			"emdash-plugin.jsonc",
			"package.json",
			"tsconfig.json",
			".gitignore",
			"README.md",
			"src/plugin.ts",
			"tests/plugin.test.ts",
		]);
	});
});
