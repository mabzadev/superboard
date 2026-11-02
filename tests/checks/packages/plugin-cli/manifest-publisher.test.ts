import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Did } from "@atcute/lexicons/syntax";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	checkPublisher,
	writePublisherBack,
} from "../../../../packages/plugin-cli/src/manifest/publisher.js";
import {
	ManifestSchema,
	PublisherSchema,
} from "../../../../packages/plugin-cli/src/manifest/schema.js";

const SESSION_DID = "did:plc:abc123def456" as Did;
const OTHER_DID = "did:plc:xyz789otherrr" as Did;

describe("PublisherSchema", () => {
	it("accepts a did:plc identifier", () => {
		expect(PublisherSchema.parse("did:plc:abc123")).toBe("did:plc:abc123");
	});

	it("accepts a did:web identifier", () => {
		expect(PublisherSchema.parse("did:web:example.com")).toBe("did:web:example.com");
	});

	it("accepts a handle", () => {
		expect(PublisherSchema.parse("example.com")).toBe("example.com");
		expect(PublisherSchema.parse("jane.bsky.social")).toBe("jane.bsky.social");
	});

	it("rejects a bare slug", () => {
		const result = PublisherSchema.safeParse("not-a-handle-or-did");
		expect(result.success).toBe(false);
	});

	it("rejects an empty string", () => {
		const result = PublisherSchema.safeParse("");
		expect(result.success).toBe(false);
	});

	it("rejects a malformed did", () => {
		const result = PublisherSchema.safeParse("did:");
		expect(result.success).toBe(false);
	});
});

describe("ManifestSchema with publisher", () => {
	const minimal = {
		slug: "my-plugin",
		version: "0.1.0",
		license: "MIT",
		author: { name: "Jane Doe" },
		security: { email: "security@example.com" },
	};

	it("accepts a manifest with a DID publisher", () => {
		const result = ManifestSchema.safeParse({
			...minimal,
			publisher: "did:plc:abc123",
		});
		expect(result.success).toBe(true);
	});

	it("accepts a manifest with a handle publisher", () => {
		const result = ManifestSchema.safeParse({
			...minimal,
			publisher: "example.com",
		});
		expect(result.success).toBe(true);
	});

	it("rejects a manifest without a publisher", () => {
		const result = ManifestSchema.safeParse(minimal);
		expect(result.success).toBe(false);
	});

	it("rejects a manifest with an invalid publisher", () => {
		const result = ManifestSchema.safeParse({
			...minimal,
			publisher: "not-valid",
		});
		expect(result.success).toBe(false);
	});
});

describe("checkPublisher", () => {
	it("returns 'unpinned' when the manifest has no publisher", async () => {
		const result = await checkPublisher({
			manifestPublisher: undefined,
			sessionDid: SESSION_DID,
		});
		expect(result.kind).toBe("unpinned");
	});

	it("returns 'match' when a pinned DID equals the session DID", async () => {
		const result = await checkPublisher({
			manifestPublisher: SESSION_DID,
			sessionDid: SESSION_DID,
		});
		expect(result.kind).toBe("match");
		if (result.kind === "match") {
			expect(result.pinnedDid).toBe(SESSION_DID);
		}
	});

	it("returns 'mismatch' when a pinned DID differs from the session DID", async () => {
		const result = await checkPublisher({
			manifestPublisher: OTHER_DID,
			sessionDid: SESSION_DID,
		});
		expect(result.kind).toBe("mismatch");
		if (result.kind === "mismatch") {
			expect(result.pinnedDid).toBe(OTHER_DID);
			expect(result.pinnedDisplay).toBe(OTHER_DID);
		}
	});
});

describe("writePublisherBack", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "emdash-publisher-test-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("inserts publisher after license, preserving comments and order", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	// Top-level comment
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		await writePublisherBack({ manifestPath: path, sessionDid: SESSION_DID });
		const updated = await readFile(path, "utf8");
		expect(updated).toContain(`"publisher": "${SESSION_DID}"`);
		expect(updated).toContain("// Top-level comment");
		expect(updated).toContain('"license": "MIT"');
		const licenseIdx = updated.indexOf('"license"');
		const publisherIdx = updated.indexOf('"publisher"');
		const authorIdx = updated.indexOf('"author"');
		expect(licenseIdx).toBeLessThan(publisherIdx);
		expect(publisherIdx).toBeLessThan(authorIdx);
	});

	it("appends a // <handle> comment when a session handle is provided", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		await writePublisherBack({
			manifestPath: path,
			sessionDid: SESSION_DID,
			sessionHandle: "jane.bsky.social",
		});
		const updated = await readFile(path, "utf8");
		expect(updated).toMatch(/"publisher": "did:plc:abc123def456",? \/\/ jane\.bsky\.social/);
		const { loadManifest } = await import("../../../../packages/plugin-cli/src/manifest/load.js");
		const { manifest } = await loadManifest(path);
		expect(manifest.publisher).toBe(SESSION_DID);
	});

	it("anchors the comment to the publisher property even when the DID appears in another field", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"description": "Originally published as ${SESSION_DID}. See changelog.",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		await writePublisherBack({
			manifestPath: path,
			sessionDid: SESSION_DID,
			sessionHandle: "jane.bsky.social",
		});
		const updated = await readFile(path, "utf8");
		const lines = updated.split("\n");
		const descriptionLine = lines.find((l) => l.includes('"description"'))!;
		const publisherLine = lines.find((l) => l.includes('"publisher"'))!;
		expect(descriptionLine).toBeDefined();
		expect(publisherLine).toBeDefined();
		expect(descriptionLine).not.toMatch(/\/\/ jane\.bsky\.social/);
		expect(publisherLine).toMatch(/\/\/ jane\.bsky\.social/);
	});

	it("omits the comment when no handle is provided", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		await writePublisherBack({ manifestPath: path, sessionDid: SESSION_DID });
		const updated = await readFile(path, "utf8");
		const publisherLine = updated.split("\n").find((l) => l.includes('"publisher"'));
		expect(publisherLine).toBeDefined();
		expect(publisherLine).not.toContain("//");
	});

	it("preserves the source's indentation (2-space)", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = [
			"{",
			'  "slug": "my-plugin",',
			'  "version": "0.1.0",',
			'  "license": "MIT",',
			'  "author": { "name": "Jane Doe" },',
			'  "security": { "email": "security@example.com" }',
			"}",
			"",
		].join("\n");
		await writeFile(path, source, "utf8");
		await writePublisherBack({ manifestPath: path, sessionDid: SESSION_DID });
		const updated = await readFile(path, "utf8");
		expect(updated).not.toContain("\t");
		const publisherLine = updated.split("\n").find((l) => l.includes('"publisher"'))!;
		expect(publisherLine.startsWith("  ")).toBe(true);
		expect(publisherLine.startsWith("\t")).toBe(false);
	});

	it("does not overwrite an existing publisher (defensive re-parse)", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"publisher": "did:plc:user-pinned-already",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		let warnings = 0;
		let infos = 0;
		await writePublisherBack({
			manifestPath: path,
			sessionDid: SESSION_DID,
			onInfo: () => infos++,
			onWarn: () => warnings++,
		});
		const updated = await readFile(path, "utf8");
		expect(updated).toContain('"publisher": "did:plc:user-pinned-already"');
		expect(updated).not.toContain(SESSION_DID);
		expect(infos).toBe(1);
		expect(warnings).toBe(0);
	});

	it("does not fail when the file is missing (warns only)", async () => {
		const path = join(dir, "no-such-file.jsonc");
		let warnings = 0;
		await writePublisherBack({
			manifestPath: path,
			sessionDid: SESSION_DID,
			onWarn: () => warnings++,
		});
		expect(warnings).toBe(1);
	});

	it("does not fail when the file no longer parses (warns only)", async () => {
		const path = join(dir, "broken.jsonc");
		await writeFile(path, '{ "license": "MIT", broken syntax', "utf8");
		let warnings = 0;
		await writePublisherBack({
			manifestPath: path,
			sessionDid: SESSION_DID,
			onWarn: () => warnings++,
		});
		expect(warnings).toBe(1);
	});

	it("produces a JSONC document that round-trips through the loader", async () => {
		const path = join(dir, "emdash-plugin.jsonc");
		const source = `{
	"slug": "my-plugin",
	"version": "0.1.0",
	"license": "MIT",
	"author": { "name": "Jane Doe" },
	"security": { "email": "security@example.com" }
}
`;
		await writeFile(path, source, "utf8");
		await writePublisherBack({ manifestPath: path, sessionDid: SESSION_DID });

		const { loadManifest } = await import("../../../../packages/plugin-cli/src/manifest/load.js");
		const { manifest } = await loadManifest(path);
		expect(manifest.publisher).toBe(SESSION_DID);
		expect(manifest.license).toBe("MIT");
		expect(manifest.author?.name).toBe("Jane Doe");
	});
});
