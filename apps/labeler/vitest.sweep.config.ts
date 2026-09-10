import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: ["../../tests/checks/apps/labeler/live/model-sweep.live.test.ts"],
			maxWorkers: 1,
			testTimeout: 2 * 60 * 60 * 1_000,
			hookTimeout: 2 * 60 * 60 * 1_000,
		},
	}),
);
