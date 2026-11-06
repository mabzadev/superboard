import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: ["../../tests/checks/packages/plugin-test/node/**/*.test.ts"],
			testTimeout: 30_000,
			hookTimeout: 30_000,
		},
	}),
);
