import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: {
			environment: "node",
			include: [
				"../../../../tests/checks/plugins/supbrd-plug-communication/email/unit/**/*.test.ts",
			],
		},
	}),
);
