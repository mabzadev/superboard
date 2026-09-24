import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			include: ["../../../../tests/checks/plugins/superboard-acquisition/flows/unit/**/*.test.ts"],
		},
	}),
);
