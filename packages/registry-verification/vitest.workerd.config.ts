import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
		test: {
			include: ["../../tests/checks/packages/registry-verification/workerd/**/*.test.ts"],
		},
	}),
);
