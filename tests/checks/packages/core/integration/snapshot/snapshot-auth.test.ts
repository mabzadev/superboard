import { sql } from "kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	generateSnapshot,
	parsePreviewSignatureHeader,
	verifyPreviewSignature,
} from "../../../../../../packages/core/src/api/handlers/snapshot.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabaseWithCollections } from "../../utils/test-db.js";

const SECRET = "test-preview-secret";

async function signPreview(
	source: string,
	ttl = 3600,
): Promise<{ source: string; exp: number; sig: string }> {
	const exp = Math.floor(Date.now() / 1000) + ttl;
	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(SECRET),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const buffer = await crypto.subtle.sign("HMAC", key, encoder.encode(`${source}:${exp}`));
	const sig = Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

	return { source, exp, sig };
}

function buildSignatureHeader(parts: { source: string; exp: number; sig: string }): string {
	return `${parts.source}:${parts.exp}:${parts.sig}`;
}

describe("preview snapshot auth flow", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
	});

	afterEach(async () => {
		await db.destroy();
	});

	it("end-to-end: signed preview URL → header → snapshot access", async () => {
		await sql`
			INSERT INTO ec_post (id, slug, status, title, content, created_at, updated_at, version)
			VALUES ('p1', 'test-post', 'published', 'Test', 'Body', datetime('now'), datetime('now'), 1)
		`.execute(db);

		const signed = await signPreview("https://mysite.com");

		const headerValue = buildSignatureHeader(signed);

		const parsed = parsePreviewSignatureHeader(headerValue);
		expect(parsed).not.toBeNull();
		expect(parsed!.source).toBe("https://mysite.com");
		expect(parsed!.exp).toBe(signed.exp);
		expect(parsed!.sig).toBe(signed.sig);

		const valid = await verifyPreviewSignature(parsed!.source, parsed!.exp, parsed!.sig, SECRET);
		expect(valid).toBe(true);

		const snapshot = await generateSnapshot(db);
		expect(snapshot.tables.ec_post).toHaveLength(1);
		expect(snapshot.tables.ec_post[0]!.slug).toBe("test-post");
	});

	it("rejects tampered signature", async () => {
		const signed = await signPreview("https://mysite.com");
		const headerValue = buildSignatureHeader(signed);

		const parsed = parsePreviewSignatureHeader(headerValue);
		expect(parsed).not.toBeNull();

		const valid = await verifyPreviewSignature(parsed!.source, parsed!.exp, "a".repeat(64), SECRET);
		expect(valid).toBe(false);
	});

	it("rejects wrong secret", async () => {
		const signed = await signPreview("https://mysite.com");
		const headerValue = buildSignatureHeader(signed);

		const parsed = parsePreviewSignatureHeader(headerValue);
		expect(parsed).not.toBeNull();

		const valid = await verifyPreviewSignature(
			parsed!.source,
			parsed!.exp,
			parsed!.sig,
			"wrong-secret",
		);
		expect(valid).toBe(false);
	});

	it("rejects expired signature", async () => {
		const signed = await signPreview("https://mysite.com", -1);
		const headerValue = buildSignatureHeader(signed);

		const parsed = parsePreviewSignatureHeader(headerValue);
		expect(parsed).not.toBeNull();

		const valid = await verifyPreviewSignature(parsed!.source, parsed!.exp, parsed!.sig, SECRET);
		expect(valid).toBe(false);
	});
});

describe("parsePreviewSignatureHeader", () => {
	it("parses source URLs with colons correctly", async () => {
		const signed = await signPreview("https://mysite.com:8080");
		const header = buildSignatureHeader(signed);

		const parsed = parsePreviewSignatureHeader(header);
		expect(parsed).not.toBeNull();
		expect(parsed!.source).toBe("https://mysite.com:8080");
		expect(parsed!.exp).toBe(signed.exp);
		expect(parsed!.sig).toBe(signed.sig);
	});

	it("rejects empty string", () => {
		expect(parsePreviewSignatureHeader("")).toBeNull();
	});

	it("rejects header with no colons", () => {
		expect(parsePreviewSignatureHeader("noseparators")).toBeNull();
	});

	it("rejects header with sig wrong length", () => {
		expect(parsePreviewSignatureHeader("https://x.com:12345:tooshort")).toBeNull();
	});

	it("rejects header with non-numeric exp", () => {
		expect(parsePreviewSignatureHeader(`https://x.com:notanumber:${"a".repeat(64)}`)).toBeNull();
	});
});
