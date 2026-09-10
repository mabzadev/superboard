import path from "path";

import { defineConfig } from "vitest/config";

import { centralTests } from "../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			globals: true,
			environment: "node",
			coverage: {
				provider: "v8",
				reporter: ["text", "json", "html"],
				exclude: ["node_modules/**", "dist/**", "**/*.d.ts", "**/*.config.*", "**/mockData/**"],
			},
		},
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src"),
			},
		},
	}),
);
