import { fileURLToPath } from "node:url";

import topology from "../../config/emdash-plugin-topology.json" with { type: "json" };

const VERSION_OVERRIDES = Object.freeze({ "supbrd-plug-user": "1.3.0" });
export const SUPERBOARD_PLUGIN_TEMPLATES = Object.freeze(
	topology.plugins
		.filter(({ manifest }) => manifest.plugin_id.includes("*"))
		.map(({ manifest }) => manifest.plugin_id)
		.toSorted(),
);

export function configureSuperBoardPlugins(plugins) {
	return plugins
		.filter(({ manifest }) => !manifest.plugin_id.includes("*"))
		.map(({ manifest }) => {
			const version = VERSION_OVERRIDES[manifest.plugin_id] ?? manifest.plugin_version;
			const displayName = pluginDisplayName(manifest.plugin_id);
			const settingsSchema = emdashSettingsSchema(manifest.settings.schema.properties);
			const entrypoint = fileURLToPath(
				new URL(
					`../../packages/supbrd-runtime-plugins/dist/${manifest.plugin_id}.js`,
					import.meta.url,
				),
			);
			return {
				id: manifest.plugin_id,
				version,
				defaultEnabled: false,
				lifecycleManaged: true,
				entrypoint,
				adminPages: [{ path: "/", label: displayName, icon: "settings" }],
				settingsSchema,
				format: "standard",
				capabilities: [],
				storage: Object.fromEntries(
					manifest.stores.map(({ store_id: storeId }) => [
						storeId.split(".").at(-1),
						{ indexes: [] },
					]),
				),
				routes: [
					"admin",
					"contract",
					"health",
					"settings/effective",
					"commands/catalog",
					"data-sources/catalog",
				],
				superboardManifest: manifest,
			};
		});
}

export const superboardConfiguredPlugins = Object.freeze(
	configureSuperBoardPlugins(topology.plugins),
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
					multiline: /(?:origins|locales|content_types|scopes|json)$/u.test(key),
				},
			];
		}),
	);
}

function pluginDisplayName(pluginId) {
	return pluginId
		.replace(/^supbrd-(?:plug|plugmod)-/u, "")
		.split("-")
		.map(settingLabel)
		.join(" ");
}

function settingLabel(value) {
	return String(value)
		.split(/[_-]/u)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
