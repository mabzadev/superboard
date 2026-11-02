import { describe, expect, it } from "vitest";

import { sha256Multihash } from "../../../../packages/plugin-cli/src/multihash.js";

describe("sha256Multihash", () => {
	it("matches an independently-verified vector for sha2-256('hello world')", () => {
		const out = sha256Multihash(new TextEncoder().encode("hello world"));
		expect(out).toBe("bciqlstjhxgju2pqiuuxffv62pwv7vree57rxuu4a52iir55m4lx432i");
	});
});
