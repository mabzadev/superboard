import { canonicalPluginId, pluginPackageOwner } from "@superboard/contracts/plugin-packages";

import { createConfiguredSuperBoardPlugin as createPluginRuntime } from "../../../../packages/supbrd-core/src/plugin-runtime.js";
import topology from "../../../../scripts/config/emdash-plugin-topology.json";
import catalog from "../../../../scripts/config/superboard-plugin-catalog.json";

const manifests = new Map(
	[
		...topology.plugins.map(({ manifest }) => manifest),
		...catalog.plugins.flatMap(({ manifest, canonical_manifest }) => [
			manifest,
			canonical_manifest,
		]),
	].map((manifest) => [manifest.plugin_id, manifest]),
);
const labels = new Map(
	catalog.plugins.flatMap(
		({ manifest, canonical_manifest, label }) =>
			[
				[manifest.plugin_id, label],
				[canonical_manifest.plugin_id, label],
			] as const,
	),
);
const componentPrefix = /^supbrd-(?:plug|plugmod)-/u;

export function resolveConfiguredPluginSettingKey(pluginId: string, key: string): string {
	const manifest = manifests.get(pluginPackageOwner(pluginId));
	return (
		Object.keys(manifest?.settings.schema.properties ?? {}).find(
			(candidate) => canonicalPluginId(candidate) === key,
		) ?? key
	);
}

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
