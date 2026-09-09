import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
	test: { include: ["runtime-tests/plugin-packages.runtime.test.ts"], maxWorkers: 1 },
});
