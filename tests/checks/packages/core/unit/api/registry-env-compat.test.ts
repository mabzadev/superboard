import { describe, expect, it } from "vitest";

import { mapErrorStatus } from "../../../../../../packages/core/src/api/errors.js";
import { assertEnvCompatible } from "../../../../../../packages/core/src/api/handlers/registry.js";

describe("assertEnvCompatible", () => {
	const host = { "env:emdash": "1.2.0", "env:astro": "4.12.0" };

	it("returns null when every constraint is satisfied", () => {
		expect(
			assertEnvCompatible({ "env:emdash": ">=1.0.0", "env:astro": ">=4.0.0" }, host),
		).toBeNull();
	});

	it("returns null when there are no constraints", () => {
		expect(assertEnvCompatible(undefined, host)).toBeNull();
		expect(assertEnvCompatible({}, host)).toBeNull();
	});

	it("returns an ENV_INCOMPATIBLE error when a constraint is not satisfied", () => {
		const error = assertEnvCompatible({ "env:astro": ">=4.16" }, host);
		expect(error?.code).toBe("ENV_INCOMPATIBLE");
		expect(error?.details.requires).toEqual({ "env:astro": ">=4.16" });
		expect(error?.details.host).toEqual(host);
		expect(error?.message).toContain("env:astro");
	});

	it("reports every unsatisfied constraint, skipping satisfied ones", () => {
		const error = assertEnvCompatible({ "env:emdash": ">=2.0.0", "env:astro": ">=4.0.0" }, host);
		expect(error?.details.requires).toEqual({ "env:emdash": ">=2.0.0" });
	});

	it("does not crash on a garbage requires shape", () => {
		expect(assertEnvCompatible("garbage", host)).toBeNull();
		expect(assertEnvCompatible(42, host)).toBeNull();
		expect(assertEnvCompatible({ "env:astro": 999 }, host)).toBeNull();
		expect(assertEnvCompatible(null, host)).toBeNull();
	});

	it("skips constraints for envs the host does not advertise", () => {
		expect(assertEnvCompatible({ "did:plc:abc": "^1.0.0" }, host)).toBeNull();
		expect(assertEnvCompatible({ "env:astro": ">=4.16" }, { "env:emdash": "1.2.0" })).toBeNull();
	});
});

describe("ENV_INCOMPATIBLE status mapping", () => {
	it("maps to 409 Conflict", () => {
		expect(mapErrorStatus("ENV_INCOMPATIBLE")).toBe(409);
	});
});
