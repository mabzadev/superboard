import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			server: {
				deps: { inline: ["@flue/runtime"] },
			},
		},
		resolve: {
			alias: {
				"cloudflare:workers": fileURLToPath(
					new URL(
						"../../tests/checks/infra/flue-review/stubs/cloudflare-workers.ts",
						import.meta.url,
					),
				),
			},
		},
	}),
);
