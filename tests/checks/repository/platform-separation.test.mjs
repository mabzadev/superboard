import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lintPlatformSeparation } from "../../lints/platform-separation.mjs";

test("application code and container packaging cannot return to the platform", () => {
	const root = mkdtempSync(join(tmpdir(), "superboard-boundary-"));
	try {
		for (const filename of [
			"apps/vocostar/worker/src/index.ts",
			"fixtures/test-site/Dockerfile",
			"compose.yaml",
		]) {
			mkdirSync(join(root, filename, ".."), { recursive: true });
			writeFileSync(join(root, filename), "");
		}
		assert.deepEqual(
			lintPlatformSeparation(root)
				.map(({ filename }) => filename)
				.sort(),
			["apps/vocostar/worker/src/index.ts", "compose.yaml", "fixtures/test-site/Dockerfile"],
		);
		rmSync(join(root, "apps/vocostar/worker"), { recursive: true });
		rmSync(join(root, "fixtures"), { recursive: true });
		rmSync(join(root, "compose.yaml"));
		mkdirSync(join(root, "packages/plugins/supbrd-core/api/migrations"), { recursive: true });
		writeFileSync(
			join(root, "packages/plugins/supbrd-core/api/migrations/0001_legacy_vocostar.sql"),
			"-- immutable migration",
		);
		assert.deepEqual(lintPlatformSeparation(root), []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
