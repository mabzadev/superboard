import "../../fixtures/cloudflare/targets.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the retired Dashboard OAuth tool cannot plan a new Dashboard deployment", () => {
	const result = spawnSync(
		process.execPath,
		[
			"scripts/cloudflare/rotate-oauth.mjs",
			"--target",
			"reference-production",
			"--environment",
			"production",
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /retired/u);
	assert.equal(result.stdout, "");
});
