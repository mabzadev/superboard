import { describe, expect, it } from "vitest";

import { toOwnedArrayBuffer } from "../src/bytes.js";

describe("toOwnedArrayBuffer", () => {
	it("copies only the visible bytes into an independent ArrayBuffer", () => {
		const source = new Uint8Array([9, 1, 2, 9]);
		const result = toOwnedArrayBuffer(source.subarray(1, 3));

		expect([...new Uint8Array(result)]).toEqual([1, 2]);
		source[1] = 7;
		expect([...new Uint8Array(result)]).toEqual([1, 2]);
	});
});
