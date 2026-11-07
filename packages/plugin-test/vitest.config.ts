import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";
import { emdashPluginTest } from "./src/config.js";

const fixture = fileURLToPath(new URL("../plugins/marketplace-test", import.meta.url));

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [emdashPluginTest({ dir: fixture })],
		test: {
			include: ["../../tests/checks/packages/plugin-test/**/*.test.ts"],
			exclude: ["../../tests/checks/packages/plugin-test/node/**/*.test.ts"],
			testTimeout: 30_000,
			hookTimeout: 30_000,
		},
	}),
);
