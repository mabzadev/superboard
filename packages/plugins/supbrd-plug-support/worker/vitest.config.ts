import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		root: import.meta.dirname,
		resolve: {
			alias: {
				"cloudflare:workers": fileURLToPath(
					new URL("./src/test-cloudflare-workers.ts", import.meta.url),
				),
			},
		},
		test: {
			environment: "node",
			include: ["../../../../tests/checks/plugins/supbrd-plug-support/worker/unit/**/*.test.ts"],
			globals: true,
		},
	}),
);
