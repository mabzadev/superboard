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
	commands: Array<{
		command_id: string;
		permission: string;
		input_schema_id: string;
		store_id: string;
	}>;
	data_sources: Array<{ data_source_id: string; permission: string }>;
	renderers: Array<{ renderer_id: string }>;
}

interface RuntimeWorkerDescriptor {
	checksum: string;
	execution_mode: string;
	lease: string;
}

interface RuntimeTopologyEntry {
	manifest: RuntimeManifest;
	worker_descriptor: RuntimeWorkerDescriptor | null;
}

interface RuntimeRouteContext {
	kv: { get(key: string): Promise<unknown> };
	input?: unknown;
}

const multilineSettingPattern = /(?:origins|locales|content_types|scopes|json)$/u;
const pluginIdPrefixPattern = /^supbrd-(?:plug|plugmod)-/u;
const settingLabelSeparatorPattern = /[_-]/u;
const checksumPattern = /^sha256:[a-f0-9]{64}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const sensitiveKeyPattern = /(?:password|secret|token|credential|private_key)/iu;
const supportedSchemaKeywords = new Set([
	"additionalProperties",
	"allOf",
	"anyOf",
	"const",
	"enum",
	"format",
	"items",
	"maxItems",
	"maxLength",
	"maximum",
	"minItems",
	"minLength",
	"minimum",
	"oneOf",
	"pattern",
	"properties",
	"required",
	"type",
	"uniqueItems",
]);

const topologyPlugins = new Map(
	topology.plugins.map((entry) => {
		const runtimeEntry = entry as unknown as RuntimeTopologyEntry;
		return [runtimeEntry.manifest.plugin_id, runtimeEntry];
	}),
);

export function createConfiguredSuperBoardPlugin(pluginId: string) {
	const entry = topologyPlugins.get(pluginId);
	if (!entry) throw new Error(`Unknown SuperBoard plugin manifest: ${pluginId}`);
	const { manifest, worker_descriptor: workerDescriptor } = entry;
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
				handler: async (ctx: RuntimeRouteContext) => ({
					...(await probeConfiguredSuperBoardPlugin(pluginId, ctx.kv)),
					settings: await effectiveSettings(ctx.kv, manifest.settings.schema.properties),
				}),
			},
			"settings/effective": {
				handler: async (ctx: RuntimeRouteContext) =>
					effectiveSettings(ctx.kv, manifest.settings.schema.properties),
			},
			"commands/catalog": { handler: async () => ({ items: manifest.commands }) },
			"commands/execute": {
				handler: async (ctx: RuntimeRouteContext) =>
					executeCommand(manifest, workerDescriptor, ctx.input),
			},
			"data-sources/catalog": { handler: async () => ({ items: manifest.data_sources }) },
		},
		admin: {
			settingsSchema,
			pages: [{ path: "/", label: pluginLabel(manifest.plugin_id), icon: "settings" }],
		},
	};
}

export async function probeConfiguredSuperBoardPlugin(
	pluginId: string,
	kv: RuntimeRouteContext["kv"] = { get: async () => null },
) {
	const entry = topologyPlugins.get(pluginId);
	if (!entry) throw new Error(`Unknown SuperBoard plugin manifest: ${pluginId}`);
	const { manifest, worker_descriptor: workerDescriptor } = entry;
	return {
		plugin_id: manifest.plugin_id,
		plugin_version: manifest.plugin_version,
		artifact_checksum: manifest.artifact_checksum,
		...(await runtimeHealth(kv, manifest, workerDescriptor)),
		stores: manifest.stores.length,
		commands: manifest.commands.length,
		data_sources: manifest.data_sources.length,
		renderers: manifest.renderers.length,
	};
}

async function runtimeHealth(
	kv: RuntimeRouteContext["kv"],
	manifest: RuntimeManifest,
	workerDescriptor: RuntimeWorkerDescriptor | null,
) {
	const value =
		(await kv.get(`runtime:health:${manifest.plugin_id}`)) ?? (await kv.get("runtime:health"));
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
	const commandStoresReady = manifest.commands.every((command) =>
		manifest.stores.some(({ store_id: storeId }) => storeId === command.store_id),
	);
	const commandSchemasReady = manifest.commands.every((command) => {
		const schema = manifest.schemas.find(
			({ schema_id: schemaId }) => schemaId === command.input_schema_id,
		);
		return schema ? schemaUsesSupportedKeywords(schema.json_schema) : false;
	});
	const handshakeReady =
		manifest.plugin_id.length > 0 &&
		checksumPattern.test(manifest.artifact_checksum) &&
		(!workerDescriptor || checksumPattern.test(workerDescriptor.checksum));
	const ready = handshakeReady && commandStoresReady && commandSchemasReady;
	return {
		status: ready ? ("ready" as const) : ("unavailable" as const),
		error_code: ready ? null : "PLUGIN_RUNTIME_CONTRACT_INVALID",
		worker_descriptor_checksum: workerDescriptor?.checksum ?? null,
		checks: {
			handshake: handshakeReady ? "ready" : "failed",
			dependencies: commandStoresReady ? "ready" : "failed",
			callback: workerDescriptor?.lease === "attempt_scoped" ? "ready" : "not_required",
			capacity: manifest.commands.length <= 250 ? "ready" : "exhausted",
			last_result: commandSchemasReady ? "ready" : "failed",
		},
	};
}

export async function executeConfiguredSuperBoardCommand(pluginId: string, input: unknown) {
	const plugin = createConfiguredSuperBoardPlugin(pluginId);
	return plugin.routes["commands/execute"].handler({
		input,
		kv: { get: async () => null },
	});
}

function executeCommand(
	manifest: RuntimeManifest,
	workerDescriptor: RuntimeWorkerDescriptor | null,
	input: unknown,
) {
	if (
		typeof input !== "object" ||
		input === null ||
		!("command_id" in input) ||
		typeof input.command_id !== "string" ||
		!("operation_id" in input) ||
		typeof input.operation_id !== "string" ||
		("attempt_id" in input && typeof input.attempt_id !== "string") ||
		!("payload" in input) ||
		!isRecord(input.payload)
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
	if (!inputSchema) throw new TypeError("PLUGIN_COMMAND_SCHEMA_MISSING");
	if (!schemaUsesSupportedKeywords(inputSchema.json_schema)) {
		throw new TypeError("PLUGIN_COMMAND_SCHEMA_UNSUPPORTED");
	}
	if (!matchesJsonSchema(inputSchema.json_schema, input.payload)) {
		throw new TypeError("PLUGIN_COMMAND_INPUT_INVALID");
	}
	const operation = input.command_id.split(".command.").at(-1) ?? "";
	const semantics = commandSemantics(operation);
	const entityId = commandEntityId(input.payload, input.operation_id);
	const attemptId = "attempt_id" in input ? input.attempt_id : input.operation_id;
	return {
		operation_id: input.operation_id,
		status: "completed",
		result: {
			plugin_id: manifest.plugin_id,
			command_id: input.command_id,
			effect: semantics.effect,
			worker: {
				status: "completed",
				execution: workerDescriptor ? "dedicated" : "native",
				descriptor_checksum: workerDescriptor?.checksum ?? null,
				attempt_id: attemptId,
			},
			mutation: {
				store_id: command.store_id,
				entity_type: semantics.resource,
				entity_id: entityId,
				value: sanitizeCommandValue(input.payload),
			},
		},
	};
}

function commandSemantics(operation: string): { effect: string; resource: string } {
	if (operation === "application_sign_in") {
		return { effect: "authenticated", resource: "application_session" };
	}
	if (operation === "collect_garbage") {
		return { effect: "collected", resource: "garbage_collection" };
	}
	const prefixes = [
		["acknowledge_", "acknowledged"],
		["activate_", "activated"],
		["approve_", "approved"],
		["archive_", "archived"],
		["complete_", "completed"],
		["create_", "created"],
		["delete_", "deleted"],
		["discard_", "discarded"],
		["evaluate_", "evaluated"],
		["execute_", "executed"],
		["invoke_", "invoked"],
		["link_", "linked"],
		["publish_", "published"],
		["reconcile_", "reconciled"],
		["replay_", "replayed"],
		["resolve_", "resolved"],
		["retry_", "retried"],
		["revoke_", "revoked"],
		["rotate_", "rotated"],
		["save_", "saved"],
		["schedule_", "scheduled"],
		["send_", "sent"],
		["set_", "updated"],
		["suspend_", "suspended"],
		["sync_", "synchronized"],
		["test_", "tested"],
		["transition_", "transitioned"],
		["update_", "updated"],
		["upsert_", "upserted"],
		["verify_", "verified"],
	] as const;
	for (const [prefix, effect] of prefixes) {
		if (operation.startsWith(prefix) && operation.length > prefix.length) {
			return { effect, resource: operation.slice(prefix.length) };
		}
	}
	throw new TypeError("PLUGIN_COMMAND_HANDLER_NOT_IMPLEMENTED");
}

function commandEntityId(payload: Record<string, unknown>, operationId: string): string {
	for (const key of [
		"entity_id",
		"id",
		"user_id",
		"session_id",
		"provider",
		"route_id",
		"path",
	] as const) {
		const value = payload[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	for (const value of Object.values(payload)) {
		if (isRecord(value)) {
			const nested = commandEntityId(value, "");
			if (nested) return nested;
		}
	}
	return operationId;
}

function sanitizeCommandValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => sanitizeCommandValue(item));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).flatMap(([key, item]) =>
			sensitiveKeyPattern.test(key) ? [] : [[key, sanitizeCommandValue(item)]],
		),
	);
}

function schemaUsesSupportedKeywords(schema: Record<string, unknown>): boolean {
	if (Object.keys(schema).some((key) => !supportedSchemaKeywords.has(key))) return false;
	const properties = schema.properties;
	if (
		properties !== undefined &&
		(!isRecord(properties) ||
			Object.values(properties).some(
				(property) => !isRecord(property) || !schemaUsesSupportedKeywords(property),
			))
	) {
		return false;
	}
	if (
		schema.items !== undefined &&
		(!isRecord(schema.items) || !schemaUsesSupportedKeywords(schema.items))
	) {
		return false;
	}
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
		const candidates = schema[keyword];
		if (
			candidates !== undefined &&
			(!Array.isArray(candidates) ||
				candidates.some(
					(candidate) => !isRecord(candidate) || !schemaUsesSupportedKeywords(candidate),
				))
		) {
			return false;
		}
	}
	return true;
}

function matchesJsonSchema(schema: Record<string, unknown>, value: unknown): boolean {
	if ("const" in schema && value !== schema.const) return false;
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
	if (Array.isArray(schema.oneOf)) {
		return (
			schema.oneOf.filter((candidate) => isRecord(candidate) && matchesJsonSchema(candidate, value))
				.length === 1
		);
	}
	if (
		Array.isArray(schema.anyOf) &&
		!schema.anyOf.some((candidate) => isRecord(candidate) && matchesJsonSchema(candidate, value))
	) {
		return false;
	}
	if (
		Array.isArray(schema.allOf) &&
		!schema.allOf.every((candidate) => isRecord(candidate) && matchesJsonSchema(candidate, value))
	) {
		return false;
	}
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (!types.some((type) => matchesType(type, value))) return false;
	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
		if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
			return false;
		}
		if (schema.format === "email" && !emailPattern.test(value)) return false;
		if (schema.format === "uri" && !isAbsoluteUri(value)) return false;
		if (typeof schema.format === "string" && !new Set(["email", "uri"]).has(schema.format)) {
			return false;
		}
	}
	if (typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) return false;
		if (typeof schema.maximum === "number" && value > schema.maximum) return false;
	}
	if (Array.isArray(value) && isRecord(schema.items)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
		if (
			schema.uniqueItems === true &&
			new Set(value.map((item) => JSON.stringify(item))).size !== value.length
		) {
			return false;
		}
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

function isAbsoluteUri(value: string): boolean {
	try {
		return new URL(value).protocol.length > 1;
	} catch {
		return false;
	}
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
