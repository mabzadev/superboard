import { describe, expect, it } from "vitest";

import {
	decodeCursor,
	encodeCursor,
	InvalidCursorError,
} from "../../../../../../../packages/core/src/database/repositories/types.js";

describe("decodeCursor", () => {
	it("round-trips a valid cursor", () => {
		const cursor = encodeCursor("2024-01-01", "01ABC");
		const decoded = decodeCursor(cursor);
		expect(decoded).toEqual({ orderValue: "2024-01-01", id: "01ABC" });
	});

	it("throws InvalidCursorError on empty string", () => {
		expect(() => decodeCursor("")).toThrow(InvalidCursorError);
	});

	it("throws InvalidCursorError on non-base64 input", () => {
		expect(() => decodeCursor("not-base64-!!!")).toThrow(InvalidCursorError);
	});

	it("throws InvalidCursorError on base64 of malformed JSON", () => {
		const bad = Buffer.from("{not valid json").toString("base64");
		expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
	});

	it("throws InvalidCursorError on base64 JSON missing required fields", () => {
		const bad = Buffer.from(JSON.stringify({ wrong: "shape" })).toString("base64");
		expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
	});

	it("throws InvalidCursorError when id is not a string", () => {
		const bad = Buffer.from(JSON.stringify({ orderValue: "x", id: 42 })).toString("base64");
		expect(() => decodeCursor(bad)).toThrow(InvalidCursorError);
	});

	it("rejects oversized cursors before attempting to decode (DoS guard)", () => {
		const huge = "A".repeat(5000);
		expect(() => decodeCursor(huge)).toThrow(InvalidCursorError);
	});

	it("error message truncates very long cursors", () => {
		const longish = "A".repeat(200);
		try {
			decodeCursor(longish);
			expect.fail("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidCursorError);
			expect((error as Error).message.length).toBeLessThan(120);
		}
	});
});
