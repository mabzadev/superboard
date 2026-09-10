import assert from "node:assert/strict";
import test from "node:test";

import {
	superboardEnvironmentContract,
	superboardEnvironmentValue,
} from "../../../scripts/cloudflare/environment.mjs";

test("canonical variables are trimmed and identify their source", () => {
	const env = {
		SUPERBOARD_TARGET: " mbza-development ",
		SUPERBOARD_ENVIRONMENT: "development",
		SUPERBOARD_RELEASE: "revision-1",
	};
	assert.equal(superboardEnvironmentValue("SUPERBOARD_TARGET", env), "mbza-development");
	assert.equal(superboardEnvironmentValue("SUPERBOARD_ENVIRONMENT", env), "development");
	assert.deepEqual(superboardEnvironmentContract(env).SUPERBOARD_RELEASE, {
		value: "revision-1",
		source: "SUPERBOARD_RELEASE",
	});
});

test("unset, blank and unrelated variables cannot select an environment", () => {
	assert.equal(
		superboardEnvironmentValue("SUPERBOARD_TARGET", {
			SUPERBOARD_TARGET: " ",
			OTHER_TARGET: "production",
		}),
		undefined,
	);
	assert.deepEqual(superboardEnvironmentContract({}).SUPERBOARD_TARGET, {
		value: undefined,
		source: null,
	});
	assert.throws(
		() => superboardEnvironmentValue("UNDECLARED", {}),
		/Unknown SuperBoard environment variable/u,
	);
});
