import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			include: ["../../tests/checks/apps/site/**/*.test.ts"],
			exclude: ["../../tests/checks/apps/site/runtime/**"],
		},
	}),
);
