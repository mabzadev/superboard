import { createConfiguredSuperBoardPlugin as createPluginRuntime } from "../../../../packages/supbrd-core/src/plugin-runtime.js";
import topology from "../../../../scripts/config/emdash-plugin-topology.json";
import catalog from "../../../../scripts/config/superboard-plugin-catalog.json";

const manifests = new Map(
	[...topology.plugins, ...catalog.plugins].map(({ manifest }) => [manifest.plugin_id, manifest]),
);
const labels = new Map(catalog.plugins.map(({ manifest, label }) => [manifest.plugin_id, label]));
const componentPrefix = /^supbrd-(?:plug|plugmod)-/u;

export function createConfiguredSuperBoardPlugin(pluginId: string) {
	const manifest = manifests.get(pluginId);
	if (!manifest) throw new Error(`Unknown SuperBoard plugin manifest: ${pluginId}`);
	const label =
		labels.get(pluginId) ??
		pluginId
			.replace(componentPrefix, "")
			.split("-")
			.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
			.join(" ");
	return createPluginRuntime(manifest, label);
}
