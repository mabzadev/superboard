import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			include: ["../../tests/checks/packages/create-emdash/**/*.test.ts"],
		},
	}),
);
