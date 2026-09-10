import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [
			cloudflareTest({
				miniflare: {
					compatibilityDate: "2026-08-08",
					d1Databases: ["DB"],
					bindings: {
						PACKAGE_MIGRATIONS: await readD1Migrations(
							new URL("./migrations", import.meta.url).pathname,
						),
					},
				},
			}),
		],
		test: {
			include: ["../../tests/checks/apps/site/runtime/plugin-packages.runtime.test.ts"],
			maxWorkers: 1,
		},
	}),
);
