import { createHash } from "node:crypto";

import { toBase32 } from "@atcute/multibase";
import { describe, expect, it } from "vitest";

import { verifyChecksum } from "../../../../../../packages/core/src/api/handlers/registry.js";

function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function sha256Multibase(bytes: Uint8Array): string {
	const digest = createHash("sha256").update(bytes).digest();
	const multihash = new Uint8Array(2 + digest.length);
	multihash[0] = 0x12;
	multihash[1] = 0x20;
	multihash.set(digest, 2);
	return `b${toBase32(multihash)}`;
}

describe("verifyChecksum", () => {
	const bytes = new TextEncoder().encode("hello, registry");

	it("accepts the correct hex SHA-256 of the bytes", async () => {
		expect(await verifyChecksum(bytes, sha256Hex(bytes))).toBe(true);
	});

	it("accepts the hex SHA-256 case-insensitively", async () => {
		expect(await verifyChecksum(bytes, sha256Hex(bytes).toUpperCase())).toBe(true);
	});

	it("rejects an incorrect hex SHA-256", async () => {
		expect(await verifyChecksum(bytes, "0".repeat(64))).toBe(false);
	});

	it("accepts the multibase-multihash (sha2-256, base32) form", async () => {
		expect(await verifyChecksum(bytes, sha256Multibase(bytes))).toBe(true);
	});

	it("rejects multibase encoded over the wrong bytes", async () => {
		const wrong = new TextEncoder().encode("hello, different");
		expect(await verifyChecksum(bytes, sha256Multibase(wrong))).toBe(false);
	});

	it("rejects multibase wrapped around a non-sha2-256 algorithm", async () => {
		const digest = createHash("sha512").update(bytes).digest();
		const multihash = new Uint8Array(2 + digest.length);
		multihash[0] = 0x13;
		multihash[1] = 0x40;
		multihash.set(digest, 2);
		expect(await verifyChecksum(bytes, `b${toBase32(multihash)}`)).toBe(false);
	});

	it("rejects strings that are neither hex nor valid multibase", async () => {
		expect(await verifyChecksum(bytes, "")).toBe(false);
		expect(await verifyChecksum(bytes, "not-a-checksum")).toBe(false);
		expect(await verifyChecksum(bytes, "0xdeadbeef")).toBe(false);
	});
});
