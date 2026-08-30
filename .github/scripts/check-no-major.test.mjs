import assert from "node:assert/strict";
import test from "node:test";

import { isVersionCheckExempt, stableSuperBoardPackagePaths } from "./check-no-major.mjs";

void test("only reviewed stable SuperBoard package paths bypass the EmDash pre-1.0 gate", () => {
	assert.equal(stableSuperBoardPackagePaths.size, 13);
	assert.equal(isVersionCheckExempt("apps/mcp/package.json"), true);
	assert.equal(isVersionCheckExempt("sdks/identity/react/package.json"), true);
	assert.equal(isVersionCheckExempt("packages/core/package.json"), false);
	assert.equal(isVersionCheckExempt("packages/new-stable-package/package.json"), false);
});
