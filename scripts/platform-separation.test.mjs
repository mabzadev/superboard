import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintPlatformSeparation } from "./platform-separation.mjs";

test("application code and container packaging cannot return to the platform", () => {
	const root = mkdtempSync(join(tmpdir(), "superboard-boundary-"));
	try {
		for (const filename of [
			"workers/custom/vocostar/src/index.ts",
			"demos/example/Dockerfile",
			"compose.yaml",
		]) {
			mkdirSync(join(root, filename, ".."), { recursive: true });
			writeFileSync(join(root, filename), "");
		}
		assert.deepEqual(
			lintPlatformSeparation(root)
				.map(({ filename }) => filename)
				.sort(),
			["compose.yaml", "demos/example/Dockerfile", "workers/custom/vocostar/src/index.ts"],
		);
		rmSync(join(root, "workers/custom/vocostar"), { recursive: true });
		rmSync(join(root, "demos"), { recursive: true });
		rmSync(join(root, "compose.yaml"));
		mkdirSync(join(root, "workers/api/migrations"), { recursive: true });
		writeFileSync(
			join(root, "workers/api/migrations/0001_legacy_vocostar.sql"),
			"-- immutable migration",
		);
		assert.deepEqual(lintPlatformSeparation(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
