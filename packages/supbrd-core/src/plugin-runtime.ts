import { resolveLocale } from "@emdash-cms/admin/locales/config.js";
import { setupI18n } from "@lingui/core";

const multilineSettingPattern = /(?:origins|locales|content_types|scopes|json)$/u;
const pluginPrefixPattern = /^supbrd-(?:plug|plugmod)-/u;
const labelSeparatorPattern = /[_-]/u;

interface AdminRequest {
	url: string;
	headers: HeadersInit;
}

const adminSummaryMessages = {
	en: {
		settings: "Settings",
		stores: "Stores",
		commands: "Commands",
		data_sources: "Data sources",
		renderers: "Renderers",
	},
	fr: {
		settings: "Paramètres",
		stores: "Stockages",
		commands: "Commandes",
		data_sources: "Sources de données",
		renderers: "Moteurs de rendu",
	},
	ar: {
		settings: "الإعدادات",
		stores: "مخازن البيانات",
		commands: "الأوامر",
		data_sources: "مصادر البيانات",
		renderers: "مكوّنات العرض",
	},
};

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

interface RuntimeRouteContext {
	kv: { list(prefix?: string): Promise<Array<{ key: string; value: unknown }>> };
}

export function createConfiguredSuperBoardPlugin(input: unknown, label: string) {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- generated manifests are validated by the parity gate before bundling.
	const manifest = input as RuntimeManifest;
	const settingsSchema = toEmDashSettingsSchema(manifest.settings.schema.properties);
	const storage = Object.fromEntries(
		manifest.stores.map(({ store_id: storeId }) => [
			storeId.replaceAll(".", "_").replaceAll("-", "_"),
			{ indexes: [] },
		]),
	);

	return {
		id: manifest.plugin_id,
		version: manifest.plugin_version,
		capabilities: [],
		allowedHosts: [],
		storage,
		hooks: {},
		routes: {
			admin: {
				handler: async (context?: { request?: AdminRequest }) =>
					adminBlocks(manifest, label, context?.request),
			},
			contract: { handler: async () => manifest },
			health: {
				handler: async (routeContext: unknown, pluginContext?: RuntimeRouteContext) => ({
					plugin_id: manifest.plugin_id,
					plugin_version: manifest.plugin_version,
					artifact_checksum: manifest.artifact_checksum,
					status: "ready",
					stores: manifest.stores.length,
					commands: manifest.commands.length,
					data_sources: manifest.data_sources.length,
					renderers: manifest.renderers.length,
					settings: await effectiveSettings(
						routePluginContext(routeContext, pluginContext).kv,
						manifest.settings.schema.properties,
					),
				}),
			},
			"settings/effective": {
				handler: async (routeContext: unknown, pluginContext?: RuntimeRouteContext) =>
					effectiveSettings(
						routePluginContext(routeContext, pluginContext).kv,
						manifest.settings.schema.properties,
					),
			},
			"commands/catalog": { handler: async () => ({ items: manifest.commands }) },
			"data-sources/catalog": { handler: async () => ({ items: manifest.data_sources }) },
		},
		admin: {
			settingsSchema,
			pages: [
				{ path: "/", label: label, icon: "settings" },
				...(manifest.plugin_id === "supbrd-core" || manifest.plugin_id === "supbrd-plug-settings"
					? [{ path: "/configuration", label: "Configuration", icon: "settings" }]
					: []),
			],
		},
	};
}

function routePluginContext(
	routeContext: unknown,
	pluginContext?: RuntimeRouteContext,
): RuntimeRouteContext {
	if (pluginContext) return pluginContext;
	if (
		typeof routeContext === "object" &&
		routeContext !== null &&
		"kv" in routeContext &&
		typeof routeContext.kv === "object" &&
		routeContext.kv !== null &&
		"list" in routeContext.kv &&
		typeof routeContext.kv.list === "function"
	) {
		const kv = routeContext.kv;
		const list = kv.list;
		if (typeof list !== "function") throw new Error("Plugin execution context is unavailable");
		return {
			kv: {
				list: async (prefix?: string): Promise<Array<{ key: string; value: unknown }>> =>
					Reflect.apply(list, kv, [prefix]),
			},
		};
	}
	throw new Error("Plugin execution context is unavailable");
}

function adminBlocks(manifest: RuntimeManifest, label: string, request?: AdminRequest) {
	const settings = Object.keys(manifest.settings.schema.properties).toSorted();
	const requestedLocale = request
		? resolveLocale(new Request(request.url, { headers: request.headers }))
		: "en";
	const locale = requestedLocale === "fr" || requestedLocale === "ar" ? requestedLocale : "en";
	const i18n = setupI18n({ locale, messages: { [locale]: adminSummaryMessages[locale] } });
	return {
		blocks: [
			{ type: "header", text: label },
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
					{ label: i18n._("settings"), value: String(settings.length) },
					{ label: i18n._("stores"), value: String(manifest.stores.length) },
					{ label: i18n._("commands"), value: String(manifest.commands.length) },
					{ label: i18n._("data_sources"), value: String(manifest.data_sources.length) },
					{ label: i18n._("renderers"), value: String(manifest.renderers.length) },
				],
			},
			{
				type: "section",
				text: `**${i18n._("settings")}**\n${settings.map((key) => `• \`${key}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**${i18n._("stores")}**\n${manifest.stores.map(({ store_id: storeId }) => `• \`${storeId}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**${i18n._("commands")}**\n${manifest.commands.map(({ command_id: commandId }) => `• \`${commandId}\``).join("\n")}`,
			},
			{
				type: "section",
				text: `**${i18n._("data_sources")}**\n${manifest.data_sources.map(({ data_source_id: dataSourceId }) => `• \`${dataSourceId}\``).join("\n")}`,
			},
		],
	};
}

async function effectiveSettings(
	kv: RuntimeRouteContext["kv"],
	properties: Record<string, JsonSetting>,
) {
	const values: Record<string, unknown> = {};
	const secrets_set: Record<string, boolean> = {};
	const settings = new Map((await kv.list("settings:")).map(({ key, value }) => [key, value]));
	for (const [key, field] of Object.entries(properties)) {
		const value = settings.get(`settings:${key}`) ?? null;
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
		multiline: multilineSettingPattern.test(key),
	};
}

function pluginLabel(pluginId: string): string {
	return pluginId.replace(pluginPrefixPattern, "").split("-").map(settingLabel).join(" ");
}

function settingLabel(value: string): string {
	if (value.startsWith("supbrd-") && value.includes("__")) {
		const [component = "", key = ""] = value.split("__");
		return `${pluginLabel(component)} · ${settingLabel(key)}`;
	}
	return value
		.split(labelSeparatorPattern)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
