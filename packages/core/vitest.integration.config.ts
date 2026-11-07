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
			// These tests boot real Astro dev servers in beforeAll hooks.
			// Default hookTimeout (10s) is too short -- server startup +
			// migrations + seed can take 30-60s.
			testTimeout: 30_000,
			hookTimeout: 120_000,
		},
	}),
);
