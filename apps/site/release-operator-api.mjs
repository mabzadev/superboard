import { fileURLToPath } from "node:url";

const RELEASE_ENDPOINTS = ["user-slice", "compile", "preview", "approve", "activate", "rollback"];

export function superboardReleaseOperatorApi() {
	return {
		name: "superboard-release-operator-api",
		hooks: {
			"astro:config:setup": ({ injectRoute }) => {
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
