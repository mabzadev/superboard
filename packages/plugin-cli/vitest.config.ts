import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: ["../../tests/checks/packages/plugin-cli/**/*.test.ts"],
			testTimeout: 30_000,
		},
	}),
);
