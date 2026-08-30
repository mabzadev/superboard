import { fileURLToPath } from "node:url";

import topology from "../../config/emdash-plugin-topology.json" with { type: "json" };

const VERSION_OVERRIDES = Object.freeze({ "supbrd-plug-user": "1.3.0" });
const entrypoint = fileURLToPath(
	new URL("./src/plugins/superboard-manifest-adapter.ts", import.meta.url),
);

export const SUPERBOARD_PLUGIN_TEMPLATES = Object.freeze(
	topology.plugins
		.filter(({ manifest }) => manifest.plugin_id.includes("*"))
		.map(({ manifest }) => manifest.plugin_id)
		.toSorted(),
);

export const superboardConfiguredPlugins = Object.freeze(
	topology.plugins
		.filter(({ manifest, worker_descriptor: descriptor }) => {
			if (manifest.plugin_id.includes("*")) return false;
			return manifest.plugin_kind === "full" || descriptor?.deployment_status === "ready";
		})
		.map(({ manifest }) => {
			const version = VERSION_OVERRIDES[manifest.plugin_id] ?? manifest.plugin_version;
			return {
				id: manifest.plugin_id,
				version,
				entrypoint,
				format: "native",
				options: { id: manifest.plugin_id, version },
			};
		}),
);
