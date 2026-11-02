import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			include: [
				"../../tests/checks/packages/core/integration/cli/**/*.test.ts",
				"../../tests/checks/packages/core/integration/client/**/*.test.ts",
			],
			globalSetup: ["../../tests/checks/packages/core/integration/global-setup.ts"],
			testTimeout: 30_000,
			hookTimeout: 120_000,
		},
	}),
);
