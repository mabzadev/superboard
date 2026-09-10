import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../../../scripts/cloudflare/vitest-d1.mjs";
import { centralTests } from "../../../../tests/checks/project-config.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default centralTests(
	import.meta.url,
	defineConfig({
		root,
		plugins: [
			cloudflareTest(async () => {
				const migrations = await readD1Migrations(
					fileURLToPath(new URL("./migrations", import.meta.url)),
				);
				return {
					wrangler: {
						configPath: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
					},
					miniflare: {
						bindings: {
							INTERNAL_API_TOKEN: "onboarding-runtime-secret",
							...d1RuntimeBindings(migrations),
						},
					},
				};
			}),
		],
		test: {
			include: [
				"../../../../tests/checks/plugins/supbrd-plug-journeys/onboardings/runtime/**/*.test.ts",
			],
			setupFiles: [
				"../../../../tests/checks/plugins/supbrd-plug-journeys/onboardings/runtime/apply-migrations.ts",
			],
			sequence: { concurrent: false },
		},
	}),
);
