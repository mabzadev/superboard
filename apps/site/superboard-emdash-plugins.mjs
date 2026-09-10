const multilineSettingPattern = /(?:origins|locales|content_types|scopes|json)$/u;
const pluginPrefixPattern = /^supbrd-(?:plug|plugmod)-/u;
const settingLabelSeparators = /[_-]/u;
import { fileURLToPath } from "node:url";

import topology from "../../scripts/config/emdash-plugin-topology.json" with { type: "json" };
import catalog from "../../scripts/config/superboard-plugin-catalog.json" with { type: "json" };

export const SUPERBOARD_PLUGIN_TEMPLATES = Object.freeze(
	topology.plugins
		.filter(({ manifest }) => manifest.plugin_id.includes("*"))
		.map(({ manifest }) => manifest.plugin_id)
		.toSorted(),
);

export function configureSuperBoardPlugins(plugins) {
	return plugins
		.filter(({ manifest }) => !manifest.plugin_id.includes("*"))
		.map(({ manifest, label, kind }) => {
			const displayName = label ?? pluginDisplayName(manifest.plugin_id);
			const settingsSchema = emdashSettingsSchema(manifest.settings.schema.properties);
			const entrypoint = fileURLToPath(
				new URL(`../../packages/plugins/${manifest.plugin_id}/dist/index.js`, import.meta.url),
			);
			return {
				id: manifest.plugin_id,
				version: manifest.plugin_version,
				defaultEnabled: kind === "core",
				lifecycleManaged: true,
				lifecycleEnablePath: `/_emdash/api/superboard/plugins/${encodeURIComponent(manifest.plugin_id)}/enable`,
				lifecycleDisablePath: `/_emdash/api/superboard/plugins/${encodeURIComponent(manifest.plugin_id)}/disable`,
				entrypoint,
				adminPages: [
					{ path: "/", label: displayName, icon: "settings" },
					...(manifest.plugin_id === "supbrd-core"
						? [{ path: "/configuration", label: "Configuration", icon: "settings" }]
						: []),
				],
				settingsSchema,
				format: "standard",
				capabilities: [],
				storage: Object.fromEntries(
					manifest.stores.map(({ store_id: storeId }) => [
						storeId.replaceAll(".", "_").replaceAll("-", "_"),
						{ indexes: [] },
					]),
				),
				routes: [
					"admin",
					"contract",
					"health",
					"settings/effective",
					"commands/catalog",
					"commands/execute",
					"data-sources/catalog",
				],
				superboardManifest: manifest,
			};
		});
}

export const superboardConfiguredPlugins = Object.freeze(
	configureSuperBoardPlugins(catalog.plugins),
);

function emdashSettingsSchema(properties) {
	return Object.fromEntries(
		Object.entries(properties).map(([key, field]) => {
			const common = { label: settingLabel(key) };
			if (field.writeOnly === true) return [key, { ...common, type: "secret" }];
			if (Array.isArray(field.enum)) {
				return [
					key,
					{
						...common,
						type: "select",
						options: field.enum.map((value) => ({ value, label: settingLabel(value) })),
					},
				];
			}
			if (field.type === "boolean") return [key, { ...common, type: "boolean" }];
			if (field.type === "integer" || field.type === "number") {
				return [key, { ...common, type: "number", min: field.minimum, max: field.maximum }];
			}
			if (field.format === "uri") return [key, { ...common, type: "url" }];
			if (field.format === "email") return [key, { ...common, type: "email" }];
			return [
				key,
				{
					...common,
					type: "string",
					multiline: multilineSettingPattern.test(key),
				},
			];
		}),
	);
}

function pluginDisplayName(pluginId) {
	return pluginId.replace(pluginPrefixPattern, "").split("-").map(settingLabel).join(" ");
}

function settingLabel(value) {
	if (String(value).startsWith("supbrd-") && String(value).includes("__")) {
		const [component, key] = String(value).split("__");
		return `${pluginDisplayName(component)} · ${settingLabel(key)}`;
	}
	return String(value)
		.split(settingLabelSeparators)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
