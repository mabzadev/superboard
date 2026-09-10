import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: ["../../tests/checks/packages/plugin-cli/**/*.test.ts"],
			// Bundle / build tests run a full tsdown probe + transpile,
			// which is fast locally but can take >5s on cold CI runners.
			testTimeout: 30_000,
		},
	}),
);
