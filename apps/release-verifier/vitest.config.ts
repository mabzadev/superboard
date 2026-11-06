import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
	}),
);
