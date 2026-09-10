import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { d1RuntimeBindings } from "../../../scripts/cloudflare/vitest-d1.mjs";
import { centralTests } from "../../../tests/checks/project-config.mjs";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default centralTests(
	import.meta.url,
	defineConfig({
		root: here("."),
		plugins: [
			cloudflareTest(async () => {
				const migrations = await readD1Migrations(here("./migrations"));
				return {
					wrangler: { configPath: here("./wrangler.jsonc") },
					miniflare: {
						bindings: {
							CUSTOM_WORKER_TOKEN: "custom-runtime-secret",
							...d1RuntimeBindings(migrations),
						},
					},
				};
			}),
		],
		test: {
			include: ["../../../tests/checks/apps/reference/worker/runtime/**/*.test.ts"],
			setupFiles: ["../../../tests/checks/apps/reference/worker/runtime/apply-migrations.ts"],
			sequence: { concurrent: false },
		},
	}),
);
