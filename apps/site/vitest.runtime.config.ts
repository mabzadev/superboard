import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../scripts/cloudflare-vitest-d1.mjs";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: fileURLToPath(new URL("./wrangler.test.jsonc", import.meta.url)) },
			miniflare: {
				compatibilityDate: "2026-08-08",
				bindings: {
					SUPERBOARD_INSTANCE_ID: "vocostar",
					SUPERBOARD_RELEASE_OPERATIONS: "enabled",
					...d1RuntimeBindings(
						await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
					),
				},
			},
		})),
	],
	test: {
		include: ["runtime-tests/**/*.test.ts"],
		setupFiles: ["./runtime-tests/apply-migrations.ts"],
		sequence: { concurrent: false },
	},
});
