import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTarball, MAX_FILE_SIZE } from "../../../../packages/plugin-cli/src/bundle/utils.js";
import { extractManifestFromTarballForTest } from "../../../../packages/plugin-cli/src/commands/publish.js";

describe("extractManifestFromTarball (publish CLI)", () => {
	let stagingDir: string;
	let outDir: string;

	beforeEach(async () => {
		stagingDir = await mkdtemp(join(tmpdir(), "emdash-tar-staging-"));
		outDir = await mkdtemp(join(tmpdir(), "emdash-tar-out-"));
	});

	afterEach(async () => {
		await rm(stagingDir, { recursive: true, force: true });
		await rm(outDir, { recursive: true, force: true });
	});

	async function buildTarball(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
		for (const [name, body] of Object.entries(files)) {
			const fullPath = join(stagingDir, name);
			await mkdir(dirname(fullPath), { recursive: true });
			await writeFile(fullPath, body);
		}
		const tarballPath = join(outDir, "test.tar.gz");
		await createTarball(stagingDir, tarballPath);
		return new Uint8Array(await readFile(tarballPath));
	}

	const minimalManifest = JSON.stringify({
		id: "test-plugin",
		version: "1.0.0",
		capabilities: [],
		allowedHosts: [],
		storage: {},
		hooks: [],
		routes: [],
		admin: {},
	});

	it("returns the manifest for a tarball within all caps", async () => {
		const bytes = await buildTarball({
			"manifest.json": minimalManifest,
			"backend.js": "export default {};\n",
		});
		const manifest = await extractManifestFromTarballForTest(bytes);
		expect(manifest.id).toBe("test-plugin");
		expect(manifest.version).toBe("1.0.0");
	});

	it("rejects a tarball with a single file over the per-file cap", async () => {
		const bytes = await buildTarball({
			"manifest.json": minimalManifest,
			"backend.js": "x".repeat(MAX_FILE_SIZE + 1),
		});
		await expect(extractManifestFromTarballForTest(bytes)).rejects.toThrow(
			/violates bundle size caps[\s\S]*backend\.js/,
		);
	});

	it("rejects a tarball whose total decompressed size exceeds the bundle cap", async () => {
		const bytes = await buildTarball({
			"manifest.json": minimalManifest,
			"a.js": "a".repeat(MAX_FILE_SIZE),
			"b.js": "b".repeat(MAX_FILE_SIZE),
			"c.js": "c".repeat(MAX_FILE_SIZE),
		});
		await expect(extractManifestFromTarballForTest(bytes)).rejects.toThrow(
			/violates bundle size caps[\s\S]*Bundle size/,
		);
	});

	it("rejects a tarball with too many files even when each is tiny", async () => {
		const files: Record<string, string> = { "manifest.json": minimalManifest };
		for (let i = 0; i < 25; i++) files[`f-${String(i).padStart(2, "0")}.js`] = "x";
		const bytes = await buildTarball(files);
		await expect(extractManifestFromTarballForTest(bytes)).rejects.toThrow(
			/violates bundle size caps[\s\S]*contains \d+ files/,
		);
	});

	it("does not count non-file tar entries (symlinks etc.) toward the file cap", async () => {
		const { packTar } = await import("modern-tar");
		const { gzipSync } = await import("node:zlib");
		const symlinkEntries = Array.from({ length: 25 }, (_, i) => ({
			header: {
				name: `link-${i}`,
				size: 0,
				type: "symlink" as const,
				linkname: "manifest.json",
			},
			body: new Uint8Array(0),
		}));
		const tarBytes = await packTar([
			{
				header: { name: "manifest.json", size: minimalManifest.length, type: "file" as const },
				body: new TextEncoder().encode(minimalManifest),
			},
			...symlinkEntries,
		]);
		const gzipped = gzipSync(tarBytes);
		const manifest = await extractManifestFromTarballForTest(new Uint8Array(gzipped));
		expect(manifest.id).toBe("test-plugin");
	});
});
