import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

test("every required Dashboard surface is executable in the Site target", () => {
	const result = spawnSync(
		"pnpm",
		[
			"--dir",
			"apps/site",
			"exec",
			"vitest",
			"run",
			"--config",
			"vitest.config.ts",
			"tests/front-surface-parity.test.ts",
		],
		{
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
		},
	);
	assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join("\n"));
});
