import { defineConfig } from "vitest/config";

import { centralTests } from "../../../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		test: { include: ["../../../../tests/checks/plugins/supbrd-core/mcp/unit/**/*.test.ts"] },
	}),
);
