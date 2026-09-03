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
	schemas: Array<{ schema_id: string; json_schema: Record<string, unknown> }>;
	commands: Array<{ command_id: string; permission: string; input_schema_id: string }>;
	data_sources: Array<{ data_source_id: string; permission: string }>;
	renderers: Array<{ renderer_id: string }>;
}

interface RuntimeRouteContext {
	kv: { get(key: string): Promise<unknown> };
	input?: unknown;
}

const multilineSettingPattern = /(?:origins|locales|content_types|scopes|json)$/u;
const pluginIdPrefixPattern = /^supbrd-(?:plug|plugmod)-/u;
const settingLabelSeparatorPattern = /[_-]/u;

const topologyManifests = new Map(
	topology.plugins.map(({ manifest }) => [
		manifest.plugin_id,
		manifest as unknown as RuntimeManifest,
	]),
);

export function createConfiguredSuperBoardPlugin(pluginId: string) {
	const manifest = topologyManifests.get(pluginId);
	if (!manifest) throw new Error(`Unknown SuperBoard plugin manifest: ${pluginId}`);
	const settingsSchema = toEmDashSettingsSchema(manifest.settings.schema.properties);
	const storage = Object.fromEntries(
		manifest.stores.map(({ store_id: storeId }) => [storeId.split(".").at(-1)!, { indexes: [] }]),
	);

	return {
		id: manifest.plugin_id,
		version: manifest.plugin_version,
		capabilities: [],
		allowedHosts: [],
		storage,
		hooks: {},
		routes: {
			admin: { handler: async () => adminBlocks(manifest) },
			contract: { handler: async () => manifest },
			health: {
				handler: async (ctx: RuntimeRouteContext) => {
					const runtime = await runtimeHealth(ctx.kv);
					return {
						plugin_id: manifest.plugin_id,
						plugin_version: manifest.plugin_version,
						artifact_checksum: manifest.artifact_checksum,
						...runtime,
						stores: manifest.stores.length,
						commands: manifest.commands.length,
						data_sources: manifest.data_sources.length,
						renderers: manifest.renderers.length,
						settings: await effectiveSettings(ctx.kv, manifest.settings.schema.properties),
					};
				},
			},
			"settings/effective": {
				handler: async (ctx: RuntimeRouteContext) =>
					effectiveSettings(ctx.kv, manifest.settings.schema.properties),
			},
			"commands/catalog": { handler: async () => ({ items: manifest.commands }) },
			"commands/execute": {
				handler: async (ctx: RuntimeRouteContext) => executeCommand(manifest, ctx.input),
			},
			"data-sources/catalog": { handler: async () => ({ items: manifest.data_sources }) },
		},
		admin: {
			settingsSchema,
			pages: [{ path: "/", label: pluginLabel(manifest.plugin_id), icon: "settings" }],
		},
	};
}

async function runtimeHealth(kv: RuntimeRouteContext["kv"]) {
	const value = await kv.get("runtime:health");
	if (
		typeof value === "object" &&
		value !== null &&
		"status" in value &&
		value.status === "unavailable"
	) {
		return {
			status: "unavailable" as const,
			error_code:
				"error_code" in value && typeof value.error_code === "string"
					? value.error_code
					: "PLUGIN_RUNTIME_UNAVAILABLE",
		};
	}
	return { status: "ready" as const, error_code: null };
}

export async function executeConfiguredSuperBoardCommand(pluginId: string, input: unknown) {
	const plugin = createConfiguredSuperBoardPlugin(pluginId);
	return plugin.routes["commands/execute"].handler({
		input,
		kv: { get: async () => null },
	});
}

function executeCommand(manifest: RuntimeManifest, input: unknown) {
	if (
		typeof input !== "object" ||
		input === null ||
		!("command_id" in input) ||
		typeof input.command_id !== "string" ||
		!("operation_id" in input) ||
		typeof input.operation_id !== "string" ||
		!("payload" in input) ||
		typeof input.payload !== "object" ||
		input.payload === null
	) {
		throw new TypeError("PLUGIN_COMMAND_INPUT_INVALID");
	}
	const command = manifest.commands.find(
		({ command_id: commandId }) => commandId === input.command_id,
	);
	if (!command) {
		throw new TypeError("PLUGIN_COMMAND_NOT_DECLARED");
	}
	const inputSchema = manifest.schemas.find(
		({ schema_id: schemaId }) => schemaId === command.input_schema_id,
	);
	if (!inputSchema || !matchesJsonSchema(inputSchema.json_schema, input.payload)) {
		throw new TypeError("PLUGIN_COMMAND_INPUT_INVALID");
	}
	return {
		operation_id: input.operation_id,
		status: "completed",
		result: {
			plugin_id: manifest.plugin_id,
			command_id: input.command_id,
			payload: input.payload,
		},
	};
}

function matchesJsonSchema(schema: Record<string, unknown>, value: unknown): boolean {
	if ("const" in schema && value !== schema.const) return false;
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
	if (Array.isArray(schema.oneOf)) {
		return schema.oneOf.some(
			(candidate) => isRecord(candidate) && matchesJsonSchema(candidate, value),
		);
	}
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (!types.some((type) => matchesType(type, value))) return false;
	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
		if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
			return false;
		}
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) return false;
		if (typeof schema.maximum === "number" && value > schema.maximum) return false;
	}
	if (Array.isArray(value) && isRecord(schema.items)) {
		const itemSchema = schema.items;
		return value.every((item) => matchesJsonSchema(itemSchema, item));
	}
	if (isRecord(value)) {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		if (
			Array.isArray(schema.required) &&
			schema.required.some((key) => typeof key !== "string" || !(key in value))
		) {
			return false;
		}
		if (schema.additionalProperties === false) {
			if (Object.keys(value).some((key) => !(key in properties))) return false;
		}
		for (const [key, propertySchema] of Object.entries(properties)) {
			if (
				key in value &&
				isRecord(propertySchema) &&
				!matchesJsonSchema(propertySchema, value[key])
			) {
				return false;
			}
		}
	}
	return true;
}

function matchesType(type: unknown, value: unknown): boolean {
	if (type === undefined) return true;
	if (type === "null") return value === null;
	if (type === "array") return Array.isArray(value);
	if (type === "object") return isRecord(value);
	if (type === "integer") return Number.isInteger(value);
	return typeof value === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	kv: { get(key: string): Promise<unknown> },
	properties: Record<string, JsonSetting>,
) {
	const values: Record<string, unknown> = {};
	const secrets_set: Record<string, boolean> = {};
	for (const [key, field] of Object.entries(properties)) {
		const value = await kv.get(`settings:${key}`);
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

function pluginLabel(pluginId: string) {
	return pluginId.replace(pluginIdPrefixPattern, "").split("-").map(settingLabel).join(" ");
}

function settingLabel(value: string) {
	return value
		.split(settingLabelSeparatorPattern)
		.filter(Boolean)
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}
