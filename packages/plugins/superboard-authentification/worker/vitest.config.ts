import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: [
				"../../../../tests/checks/plugins/superboard-authentification/worker/unit/*.test.ts",
				"../../../../tests/checks/plugins/superboard-authentification/worker/unit/integration/**/*.test.ts",
			],
		},
	}),
);
