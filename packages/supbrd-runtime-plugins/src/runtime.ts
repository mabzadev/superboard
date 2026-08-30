import { userPluginManifest } from "@superboard/supbrd-plug-user";
import { definePlugin } from "emdash";

import topology from "../../../config/emdash-plugin-topology.json";

interface JsonSetting {
	type?: string;
	enum?: string[];
	format?: string;
	minimum?: number;
	maximum?: number;
	writeOnly?: boolean;
}

type RuntimeSettingField =
	| { type: "string"; label: string; multiline?: boolean }
	| { type: "number"; label: string; min?: number; max?: number }
	| { type: "boolean"; label: string }
	| { type: "select"; label: string; options: Array<{ value: string; label: string }> }
	| { type: "secret"; label: string }
	| { type: "url"; label: string }
	| { type: "email"; label: string };

interface RuntimeManifest {
	plugin_id: string;
	plugin_version: string;
	plugin_kind: "full" | "module";
	artifact_checksum: string;
	settings: { schema: { properties: Record<string, JsonSetting> } };
	stores: Array<{ store_id: string }>;
	commands: Array<{ command_id: string; permission: string }>;
	data_sources: Array<{ data_source_id: string; permission: string }>;
	renderers: Array<{ renderer_id: string }>;
}

const topologyManifests = new Map(
	topology.plugins.map(({ manifest }) => [
		manifest.plugin_id,
		manifest as unknown as RuntimeManifest,
	]),
);

export function createConfiguredSuperBoardPlugin(pluginId: string) {
	const manifest = (
		pluginId === userPluginManifest.plugin_id ? userPluginManifest : topologyManifests.get(pluginId)
	) as RuntimeManifest | undefined;
	if (!manifest) throw new Error(`Unknown SuperBoard plugin manifest: ${pluginId}`);
	const settingsSchema = toEmDashSettingsSchema(manifest.settings.schema.properties);
	const storage = Object.fromEntries(
		manifest.stores.map(({ store_id: storeId }) => [storeId.split(".").at(-1)!, { indexes: [] }]),
	);

	return definePlugin({
		id: manifest.plugin_id,
		version: manifest.plugin_version,
		storage,
		routes: {
			admin: { handler: async () => adminBlocks(manifest) },
			contract: { handler: async () => manifest },
			health: {
				handler: async (ctx) => ({
					plugin_id: manifest.plugin_id,
					plugin_version: manifest.plugin_version,
					artifact_checksum: manifest.artifact_checksum,
					status: "ready",
					stores: manifest.stores.length,
					commands: manifest.commands.length,
					data_sources: manifest.data_sources.length,
					renderers: manifest.renderers.length,
					settings: await effectiveSettings(ctx.kv, manifest.settings.schema.properties),
				}),
			},
			"settings/effective": {
				handler: async (ctx) => effectiveSettings(ctx.kv, manifest.settings.schema.properties),
			},
			"commands/catalog": { handler: async () => ({ items: manifest.commands }) },
			"data-sources/catalog": { handler: async () => ({ items: manifest.data_sources }) },
		},
		admin: {
			settingsSchema,
			pages: [{ path: "/", label: pluginLabel(manifest.plugin_id), icon: "settings" }],
		},
	});
}

function adminBlocks(manifest: RuntimeManifest) {
	const settings = Object.keys(manifest.settings.schema.properties).toSorted();
	return {
		blocks: [
			{ type: "header", text: pluginLabel(manifest.plugin_id) },
			{
				type: "context",
				elements: [
					`${manifest.plugin_id} · ${manifest.plugin_version} · ${manifest.plugin_kind}`,
					manifest.artifact_checksum,
				],
			},
			{
				type: "fields",
				fields: [
					{ label: "Settings", value: String(settings.length) },
					{ label: "Stores", value: String(manifest.stores.length) },
					{ label: "Commands", value: String(manifest.commands.length) },
					{ label: "Data sources", value: String(manifest.data_sources.length) },
					{ label: "Renderers", value: String(manifest.renderers.length) },
				],
			},
			{
				type: "section",
				text: `**Settings**\n${settings.map((key) => `• \`${key}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**Stores**\n${manifest.stores.map(({ store_id: storeId }) => `• \`${storeId}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**Commands**\n${manifest.commands.map(({ command_id: commandId }) => `• \`${commandId}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**Data sources**\n${manifest.data_sources.map(({ data_source_id: dataSourceId }) => `• \`${dataSourceId}\``).join("\n")}`,
			},
		],
	};
}

async function effectiveSettings(
	kv: { get<T>(key: string): Promise<T | null> },
	properties: Record<string, JsonSetting>,
) {
	const values: Record<string, unknown> = {};
	const secrets_set: Record<string, boolean> = {};
	for (const [key, field] of Object.entries(properties)) {
		const value = await kv.get<unknown>(`settings:${key}`);
		if (field.writeOnly === true) secrets_set[key] = value !== null && value !== "";
		else values[key] = value;
	}
	return { values, secrets_set };
}

function toEmDashSettingsSchema(properties: Record<string, JsonSetting>) {
	return Object.fromEntries(
		Object.entries(properties).map(([key, field]) => [key, settingField(key, field)]),
	) as Record<string, RuntimeSettingField>;
}

function settingField(key: string, field: JsonSetting): RuntimeSettingField {
	const label = settingLabel(key);
	if (field.writeOnly === true) return { type: "secret", label };
	if (Array.isArray(field.enum)) {
		return {
			type: "select",
			label,
			options: field.enum.map((value) => ({ value, label: settingLabel(value) })),
		};
	}
	if (field.type === "boolean") return { type: "boolean", label };
	if (field.type === "integer" || field.type === "number") {
		return { type: "number", label, min: field.minimum, max: field.maximum };
	}
	if (field.format === "uri") return { type: "url", label };
	if (field.format === "email") return { type: "email", label };
	return {
		type: "string",
		label,
		multiline: /(?:origins|locales|content_types|scopes|json)$/u.test(key),
	};
}

function pluginLabel(pluginId: string) {
	return pluginId
		.replace(/^supbrd-(?:plug|plugmod)-/u, "")
		.split("-")
		.map(settingLabel)
		.join(" ");
}

function settingLabel(value: string) {
	return value
		.split(/[_-]/u)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
