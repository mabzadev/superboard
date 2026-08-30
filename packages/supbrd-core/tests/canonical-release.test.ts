import { describe, expect, test } from "vitest";

import { canonicalizeReleasePayload } from "../src/index.js";

describe("Canonical Release Payload", () => {
	test("matches the RFC 8785 serialization vector", () => {
		const payload = {
			// oxlint-disable-next-line eslint/no-loss-of-precision -- RFC 8785 intentionally demonstrates IEEE-754 rounding.
			numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27],
			string: '€$\u000f\nA\'B"\\"/',
			literals: [null, true, false],
		};

		expect(canonicalizeReleasePayload(payload)).toBe(
			'{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}',
		);
	});

	test("rejects values that cannot belong to a Canonical Release Payload", () => {
		const sparse: unknown[] = [];
		sparse.length = 1;

		expect(() => canonicalizeReleasePayload(sparse)).toThrow(/sparse/i);
	});
});
