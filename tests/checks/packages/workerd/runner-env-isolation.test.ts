import { afterEach, describe, expect, it } from "vitest";

import { minimalWorkerdEnv } from "../../../../packages/workerd/src/sandbox/runner.js";

describe("minimalWorkerdEnv", () => {
	afterEach(() => {
		delete process.env.EMDASH_TEST_SECRET;
		delete process.env.EMDASH_WORKERD_PASSTHROUGH_ENV;
	});

	it("does not pass arbitrary host env vars to workerd", () => {
		process.env.EMDASH_TEST_SECRET = "shouldnotleak";

		const env = minimalWorkerdEnv();

		expect(env.EMDASH_TEST_SECRET).toBeUndefined();
		if (process.env.PATH !== undefined) {
			expect(env.PATH).toBe(process.env.PATH);
		}
	});

	it("passes through vars listed in EMDASH_WORKERD_PASSTHROUGH_ENV", () => {
		process.env.EMDASH_TEST_SECRET = "needed-by-plugin";
		process.env.EMDASH_WORKERD_PASSTHROUGH_ENV = "EMDASH_TEST_SECRET";

		const env = minimalWorkerdEnv();

		expect(env.EMDASH_TEST_SECRET).toBe("needed-by-plugin");
	});

	it("trims whitespace and ignores empty entries in the passthrough list", () => {
		process.env.EMDASH_TEST_SECRET = "value";
		process.env.EMDASH_WORKERD_PASSTHROUGH_ENV = " , EMDASH_TEST_SECRET ,  ";

		const env = minimalWorkerdEnv();

		expect(env.EMDASH_TEST_SECRET).toBe("value");
	});

	it("skips passthrough names that are not set on the host", () => {
		process.env.EMDASH_WORKERD_PASSTHROUGH_ENV = "EMDASH_DOES_NOT_EXIST_XYZ";

		const env = minimalWorkerdEnv();

		expect(env.EMDASH_DOES_NOT_EXIST_XYZ).toBeUndefined();
	});
});
