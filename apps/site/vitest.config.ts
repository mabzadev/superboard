import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

import { injectCoreRoutes } from "../../packages/core/src/astro/integration/routes.js";
import { centralTests } from "../../tests/checks/project-config.mjs";
import { describeAstroRoutes, routeManifestModuleSource } from "./route-registry.mjs";

const injectedRoutes: Array<{ type: string; pattern: string; entrypoint: string }> = [];
injectCoreRoutes((route) => {
	if (!route.entrypoint.endsWith(".astro")) injectedRoutes.push({ ...route, type: "endpoint" });
});
const emdashRouteGraph = await describeAstroRoutes(
	injectedRoutes,
	fileURLToPath(new URL(".", import.meta.url)),
);

export default centralTests(
	import.meta.url,
	defineConfig({
		plugins: [
			{
				name: "superboard-route-graph",
				resolveId(id) {
					return id === "virtual:superboard/route-manifest"
						? "\0virtual:superboard/route-manifest"
						: null;
				},
				load(id) {
					return id === "\0virtual:superboard/route-manifest"
						? routeManifestModuleSource(emdashRouteGraph)
						: null;
				},
			},
		],
		test: {
			include: ["../../tests/checks/apps/site/**/*.test.ts"],
			exclude: ["../../tests/checks/apps/site/runtime/**"],
		},
	}),
);
