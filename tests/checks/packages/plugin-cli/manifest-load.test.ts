import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	ManifestError,
	loadManifest,
	MANIFEST_FILENAME,
	parseAndValidateManifest,
} from "../../../../packages/plugin-cli/src/manifest/load.js";

const MINIMAL = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"publisher": "example.com",
	"license": "MIT",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}`;

describe("parseAndValidateManifest (in-memory)", () => {
	it("parses + validates a minimal manifest", () => {
		const { manifest, path } = parseAndValidateManifest(MINIMAL, "/virtual/manifest.jsonc");
		expect(path).toBe("/virtual/manifest.jsonc");
		expect(manifest.license).toBe("MIT");
		expect(manifest.author?.name).toBe("Jane Doe");
		expect(manifest.security?.email).toBe("security@example.com");
	});

	it("accepts JSONC features (comments + trailing commas)", () => {
		const source = `{
			// top-level comment
			"slug": "my-plugin",
			"version": "0.1.0",
			"publisher": "example.com",
			"license": "MIT", /* block comment */
			"author": { "name": "Jane Doe", },
			"security": { "email": "security@example.com", },
		}`;
		const { manifest } = parseAndValidateManifest(source, "/virtual/manifest.jsonc");
		expect(manifest.license).toBe("MIT");
	});

	describe("MANIFEST_PARSE_ERROR", () => {
		it("reports a missing closing brace with line:column", () => {
			const source = `{
	"license": "MIT"
	"author": { "name": "x" }
`;
			expect(() => parseAndValidateManifest(source, "/v/m.jsonc")).toThrow(ManifestError);
			try {
				parseAndValidateManifest(source, "/v/m.jsonc");
			} catch (error) {
				expect(error).toBeInstanceOf(ManifestError);
				const err = error as ManifestError;
				expect(err.code).toBe("MANIFEST_PARSE_ERROR");
				expect(err.message).toMatch(/\/v\/m\.jsonc:\d+:\d+/);
			}
		});

		it("rejects an empty file", () => {
			expect(() => parseAndValidateManifest("", "/v/m.jsonc")).toThrow(ManifestError);
		});
	});

	describe("MANIFEST_VALIDATION_ERROR", () => {
		it("reports the field path", () => {
			const source = `{
	"license": "",
	"author": { "name": "Jane" },
	"security": { "email": "a@b.com" }
}`;
			try {
				parseAndValidateManifest(source, "/v/m.jsonc");
				expect.fail("expected ManifestError");
			} catch (error) {
				const err = error as ManifestError;
				expect(err.code).toBe("MANIFEST_VALIDATION_ERROR");
				const license = err.issues.find((i) => i.path === "license");
				expect(license).toBeDefined();
				expect(license?.location?.line).toBe(2);
			}
		});

		it("collects multiple issues in one error", () => {
			const source = `{
	"license": "",
	"author": { "name": "" },
	"security": {}
}`;
			try {
				parseAndValidateManifest(source, "/v/m.jsonc");
				expect.fail("expected ManifestError");
			} catch (error) {
				const err = error as ManifestError;
				expect(err.issues.length).toBeGreaterThanOrEqual(3);
				for (const issue of err.issues) {
					expect(typeof issue.path).toBe("string");
					expect(typeof issue.message).toBe("string");
				}
			}
		});

		it("rejects unknown top-level keys with strict mode", () => {
			const source = `{
	"license": "MIT",
	"licens": "MIT",
	"author": { "name": "Jane" },
	"security": { "email": "a@b.com" }
}`;
			try {
				parseAndValidateManifest(source, "/v/m.jsonc");
				expect.fail("expected ManifestError");
			} catch (error) {
				const err = error as ManifestError;
				expect(err.code).toBe("MANIFEST_VALIDATION_ERROR");
				const typoIssue = err.issues.find((i) => i.message.includes('"licens"'));
				expect(typoIssue).toBeDefined();
				expect(typoIssue?.location?.line).toBe(3);
			}
		});
	});
});

describe("loadManifest (filesystem)", () => {
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "emdash-manifest-test-"));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("loads from a directory by appending the conventional filename", async () => {
		await writeFile(join(dir, MANIFEST_FILENAME), MINIMAL, "utf8");
		const { manifest, path } = await loadManifest(dir);
		expect(path.endsWith(MANIFEST_FILENAME)).toBe(true);
		expect(manifest.license).toBe("MIT");
	});

	it("loads from an explicit .jsonc path", async () => {
		const filePath = join(dir, "explicit.jsonc");
		await writeFile(filePath, MINIMAL, "utf8");
		const { manifest, path } = await loadManifest(filePath);
		expect(path).toBe(filePath);
		expect(manifest.license).toBe("MIT");
	});

	it("loads from an explicit .json path", async () => {
		const filePath = join(dir, "explicit.json");
		await writeFile(filePath, MINIMAL, "utf8");
		const { manifest } = await loadManifest(filePath);
		expect(manifest.license).toBe("MIT");
	});

	it("returns MANIFEST_NOT_FOUND when the file is missing", async () => {
		const missing = join(dir, "no-such-manifest.jsonc");
		try {
			await loadManifest(missing);
			expect.fail("expected ManifestError");
		} catch (error) {
			expect(error).toBeInstanceOf(ManifestError);
			expect((error as ManifestError).code).toBe("MANIFEST_NOT_FOUND");
		}
	});

	it("returns MANIFEST_TOO_LARGE when the file exceeds the cap", async () => {
		const { MANIFEST_MAX_BYTES } =
			await import("../../../../packages/plugin-cli/src/manifest/load.js");
		const filler = "x".repeat(MANIFEST_MAX_BYTES);
		const oversize = `{ "license": "${filler}", "author": {"name":"J"}, "security": {"email":"a@b.com"} }`;
		const filePath = join(dir, "oversize.jsonc");
		await writeFile(filePath, oversize, "utf8");
		try {
			await loadManifest(filePath);
			expect.fail("expected ManifestError");
		} catch (error) {
			expect(error).toBeInstanceOf(ManifestError);
			expect((error as ManifestError).code).toBe("MANIFEST_TOO_LARGE");
		}
	});
});
