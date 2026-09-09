import { fileURLToPath } from "node:url";

export function superboardRuntimeCache() {
	return {
		name: "superboard-runtime-cache",
		hooks: {
			"astro:config:setup": ({ command, config, updateConfig }) => {
				updateConfig({
					vite: {
						cacheDir: fileURLToPath(
							new URL(`node_modules/.vite-superboard/${command}/`, config.root),
						),
					},
				});
			},
		},
	};
}
