import { fileURLToPath } from "node:url";

const RELEASE_ENDPOINTS = ["user-slice", "compile", "preview", "approve", "activate", "rollback"];

export function superboardReleaseOperatorApi() {
	return {
		name: "superboard-release-operator-api",
		hooks: {
			"astro:config:setup": ({ injectRoute }) => {
				injectRoute({
					pattern: "/_emdash/api/superboard/plugins/user/install",
					entrypoint: fileURLToPath(
						new URL(
							"./src/pages/_superboard/api/plugins/user/install.ts",
							import.meta.url,
						),
					),
				});
				injectRoute({
					pattern: "/_emdash/superboard/releases/[candidateId]",
					entrypoint: fileURLToPath(
						new URL(
							"./src/pages/_superboard/release-console/[candidateId].ts",
							import.meta.url,
						),
					),
				});
				for (const endpoint of RELEASE_ENDPOINTS) {
					injectRoute({
						pattern: `/_emdash/api/superboard/releases/${endpoint}`,
						entrypoint: fileURLToPath(
							new URL(`./src/pages/_superboard/api/releases/${endpoint}.ts`, import.meta.url),
						),
					});
				}
			},
		},
	};
}
