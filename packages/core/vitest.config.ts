import { defineConfig } from "vitest/config";

import { centralTests } from "../../tests/checks/project-config.mjs";

const virtualStubs: Record<string, string> = {
	"virtual:emdash/wait-until": "export const waitUntil = undefined;",
	"virtual:emdash/scheduler": "export const createScheduler = null;",
	"virtual:emdash/config": "export default {};",
	"virtual:emdash/env": "export const env = undefined;",
	"virtual:emdash/build": "export const buildTime = 0;",
};

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [
			{
				name: "emdash-virtual-stubs",
				resolveId(id) {
					if (Object.hasOwn(virtualStubs, id)) return "\0" + id;
					return null;
				},
				load(id) {
					if (!id.startsWith("\0virtual:emdash/")) return null;
					const key = id.slice(1);
					if (Object.hasOwn(virtualStubs, key)) return virtualStubs[key];
					return null;
				},
			},
		],
		test: {
			globals: true,
			environment: "node",
			include: ["../../tests/checks/packages/core/**/*.test.ts"],
			exclude: [
				"../../tests/checks/packages/core/workerd/**",
				"../../tests/checks/packages/core/repro/**/*.render.test.ts",
				"../../tests/checks/packages/core/integration/smoke/**",
				"../../tests/checks/packages/core/integration/cli/**",
				"../../tests/checks/packages/core/integration/client/**",
				"../../tests/checks/packages/core/integration/media/**",
				"../../tests/fixtures/core-integration-site/**",
			],
			coverage: {
				provider: "v8",
				reporter: ["text", "json", "html"],
				thresholds: {
					statements: 80,
					branches: 80,
					functions: 80,
					lines: 80,
				},
			},
		},
	}),
);
