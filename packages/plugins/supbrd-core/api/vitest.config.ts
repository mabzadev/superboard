import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		root: import.meta.dirname,
		test: {
			environment: "node",
			include: ["../../../../tests/checks/plugins/supbrd-core/api/unit/**/*.test.ts"],
			globals: true,
		},
	}),
);
