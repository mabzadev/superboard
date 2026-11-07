import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";
import baseConfig from "./vitest.config.js";

export default centralTests(
	import.meta.url,
	defineConfig({
		...baseConfig,
		test: {
			...baseConfig.test,
			include: ["../../tests/checks/apps/release-service/encryption-verification-workflow.test.ts"],
			exclude: baseConfig.test.exclude.filter(
				(pattern) =>
					pattern !==
					"../../tests/checks/apps/release-service/encryption-verification-workflow.test.ts",
			),
		},
	}),
);
