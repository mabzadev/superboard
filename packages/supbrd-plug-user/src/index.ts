import {
	REQUIRED_FRONT_STATES,
	assertRendererCompatibility,
	sha256Canonical,
	verifySuperBoardPluginManifest,
} from "@superboard/supbrd-core";
import type {
	RendererDescriptor,
	SuperBoardPluginManifest,
	SuperBoardSchemaDescriptor,
} from "@superboard/supbrd-core";

import frontBundle from "../../../config/superboard-front-bundle.json";

const pluginId = "supbrd-plug-user";
const pluginVersion = "1.3.0";
const rendererRuntime = { abi_version: "1.0.0", runtime_version: "0.1.0" } as const;

export const USER_RENDERER_IDS = {
	login: `${pluginId}.renderer.login_form`,
	profile: `${pluginId}.renderer.profile_card`,
	members: `${pluginId}.renderer.members_table`,
	admin: `${pluginId}.renderer.admin_surface`,
} as const;

export type UserMessageId =
	| "user.login.title"
	| "user.login.description"
	| "user.profile.title"
	| "user.profile.description"
	| "user.members.title"
	| "user.members.description"
	| "user.admin.title"
	| "user.admin.description";

export interface UserMember {
	id: string;
	email: string;
	name: string | null;
	role: number;
	disabled: boolean;
}

export type UserRendererProps =
	| { kind: "login"; title_message_id: "user.page.sign_in" }
	| { kind: "profile"; operator: UserMember }
	| { kind: "members"; page_size: number; members: UserMember[] }
	| { kind: "admin_surface"; route_id: string; path: string };

interface BaseRendererView {
	state: "rendered" | "error";
	renderer_id: string;
	title_message_id: UserMessageId;
	description_message_id: UserMessageId;
	isolated: boolean;
}

export type UserRendererView =
	| (BaseRendererView & { kind: "login"; action_id: "emdash.core.action.admin_session_start" })
	| (BaseRendererView & { kind: "profile"; operator: UserMember })
	| (BaseRendererView & { kind: "members"; members: UserMember[] })
	| (BaseRendererView & { kind: "admin_surface"; route_id: string; path: string })
	| (BaseRendererView & { kind: "error" });

interface RendererBuildDefinition {
	renderer_id: string;
	build_id: string;
	props_schema_name: string;
	implementation: (props: UserRendererProps) => UserRendererView;
}

const memberSchema = {
	type: "object",
	additionalProperties: false,
	required: ["id", "email", "name", "role", "disabled"],
	properties: {
		id: { type: "string", minLength: 1 },
		email: { type: "string", format: "email" },
		name: { type: ["string", "null"] },
		role: { type: "integer" },
		disabled: { type: "boolean" },
	},
} as const;

const propsSchemaContracts = {
	login_form_props_v1: {
		type: "object",
		additionalProperties: false,
		required: ["kind", "title_message_id"],
		properties: {
			kind: { const: "login" },
			title_message_id: { const: "user.page.sign_in" },
		},
	},
	profile_card_props_v1: {
		type: "object",
		additionalProperties: false,
		required: ["kind", "operator"],
		properties: { kind: { const: "profile" }, operator: memberSchema },
	},
	members_table_props_v1: {
		type: "object",
		additionalProperties: false,
		required: ["kind", "page_size", "members"],
		properties: {
			kind: { const: "members" },
			page_size: { type: "integer", minimum: 10, maximum: 100 },
			members: { type: "array", items: memberSchema },
		},
	},
	admin_surface_props_v1: {
		type: "object",
		additionalProperties: false,
		required: ["kind", "route_id", "path"],
		properties: {
			kind: { const: "admin_surface" },
			route_id: { type: "string", minLength: 1 },
			path: { type: "string", minLength: 1 },
		},
	},
} as const;

const propsSchemas = await Promise.all(
	Object.entries(propsSchemaContracts).map(async ([name, jsonSchema]) =>
		schemaContribution(name, jsonSchema),
	),
);

const rendererBuilds: RendererBuildDefinition[] = [
	{
		renderer_id: USER_RENDERER_IDS.login,
		build_id: "01J00000000000000000000240",
		props_schema_name: "login_form_props_v1",
		implementation: renderLogin,
	},
	{
		renderer_id: USER_RENDERER_IDS.profile,
		build_id: "01J00000000000000000000241",
		props_schema_name: "profile_card_props_v1",
		implementation: renderProfile,
	},
	{
		renderer_id: USER_RENDERER_IDS.members,
		build_id: "01J00000000000000000000242",
		props_schema_name: "members_table_props_v1",
		implementation: renderMembers,
	},
	{
		renderer_id: USER_RENDERER_IDS.admin,
		build_id: "01J00000000000000000000244",
		props_schema_name: "admin_surface_props_v1",
		implementation: renderAdminSurface,
	},
];

const renderers = await Promise.all(
	rendererBuilds.map(async (definition) => rendererDescriptor(definition)),
);
const stores = await Promise.all([
	contribution("store", "user_directory", {
		kind: "d1",
		authority: pluginId,
		schema_version: "1",
		migrations: ["0001_user_directory"],
		availability: "required",
		classification: "restricted",
		encryption: "required",
	}),
	contribution("store", "user_credentials", {
		kind: "d1",
		authority: pluginId,
		schema_version: "1",
		migrations: ["0002_user_credentials_providers"],
		availability: "required",
		classification: "secret",
		encryption: "required",
	}),
	contribution("store", "user_sessions", {
		kind: "d1",
		authority: pluginId,
		schema_version: "1",
		migrations: ["0003_application_sessions"],
		availability: "required",
		classification: "restricted",
		encryption: "required",
	}),
]);
const stringField = { type: "string" } as const;
const businessSchemaContracts = {
	"empty.v1": closedObject([], {}),
	"application_sign_in.v1": closedObject(["email", "password"], {
		email: { type: "string", format: "email" },
		password: stringField,
	}),
	"application_session.v1": closedObject(["session_id", "expires_at"], {
		session_id: stringField,
		expires_at: stringField,
	}),
	"user_profile_update.v1": closedObject(["user_id", "display_name"], {
		user_id: stringField,
		display_name: stringField,
	}),
	"user_profile.v1": closedObject(["user_id", "email", "display_name"], {
		user_id: stringField,
		email: { type: "string", format: "email" },
		display_name: stringField,
	}),
	"user_members_query.v1": closedObject(["page", "page_size"], {
		page: { type: "integer", minimum: 1, maximum: 100_000 },
		page_size: { type: "integer", minimum: 10, maximum: 100 },
	}),
	"user_members_page.v1": closedObject(["items", "next_page"], {
		items: { type: "array", items: { type: "string" } },
		next_page: { type: "integer", minimum: 1, maximum: 100_000 },
	}),
	"user_member_suspend.v1": closedObject(["user_id", "reason"], {
		user_id: stringField,
		reason: stringField,
	}),
	"user_member.v1": closedObject(["user_id", "status"], {
		user_id: stringField,
		status: { type: "string", enum: ["active", "suspended"] },
	}),
	"provider_link.v1": closedObject(["user_id", "provider"], {
		user_id: stringField,
		provider: { type: "string", enum: ["apple", "google"] },
	}),
	"provider.v1": closedObject(["provider", "linked"], {
		provider: { type: "string", enum: ["apple", "google"] },
		linked: { type: "boolean" },
	}),
	"session_revoke.v1": closedObject(["session_id"], { session_id: stringField }),
	"providers.v1": closedObject(["providers"], {
		providers: { type: "array", items: { type: "string" } },
	}),
	"sessions.v1": closedObject(["session_ids"], {
		session_ids: { type: "array", items: { type: "string" } },
	}),
} as const;
const schemas = [
	...propsSchemas,
	...(await Promise.all(
		Object.entries(businessSchemaContracts).map(async ([name, schema]) =>
			schemaContribution(name, schema),
		),
	)),
];
const commands = await Promise.all([
	contribution("command", "application_sign_in", {
		input_schema_id: schemaId("application_sign_in.v1"),
		output_schema_id: schemaId("application_session.v1"),
		audience: "application_client",
		permission: "application.identity.sign_in",
		failure_policy: "fail_closed",
	}),
	contribution("command", "update_profile", {
		input_schema_id: schemaId("user_profile_update.v1"),
		output_schema_id: schemaId("user_profile.v1"),
		audience: "superboard_front",
		permission: "users.write",
		failure_policy: "fail_closed",
	}),
	contribution("command", "suspend_member", {
		input_schema_id: schemaId("user_member_suspend.v1"),
		output_schema_id: schemaId("user_member.v1"),
		audience: "superboard_front",
		permission: "users.write",
		failure_policy: "fail_closed",
	}),
	contribution("command", "link_provider", {
		input_schema_id: schemaId("provider_link.v1"),
		output_schema_id: schemaId("provider.v1"),
		audience: "application_client",
		permission: "application.identity.providers.write",
		failure_policy: "fail_closed",
	}),
	contribution("command", "revoke_application_session", {
		input_schema_id: schemaId("session_revoke.v1"),
		output_schema_id: schemaId("application_session.v1"),
		audience: "application_client",
		permission: "application.identity.sessions.write",
		failure_policy: "fail_closed",
	}),
]);
const dataSources = await Promise.all([
	contribution("data_source", "current_profile", {
		input_schema_id: schemaId("empty.v1"),
		output_schema_id: schemaId("user_profile.v1"),
		audience: "superboard_front",
		permission: "users.read",
		store_id: `${pluginId}.store.user_directory`,
		consistency: "strong",
		unavailable_state: "unavailable",
	}),
	contribution("data_source", "members", {
		input_schema_id: schemaId("user_members_query.v1"),
		output_schema_id: schemaId("user_members_page.v1"),
		audience: "superboard_front",
		permission: "users.read",
		store_id: `${pluginId}.store.user_directory`,
		consistency: "strong",
		unavailable_state: "unavailable",
	}),
	contribution("data_source", "linked_providers", {
		input_schema_id: schemaId("empty.v1"),
		output_schema_id: schemaId("providers.v1"),
		audience: "application_client",
		permission: "application.identity.providers.read",
		store_id: `${pluginId}.store.user_credentials`,
		consistency: "strong",
		unavailable_state: "unavailable",
	}),
	contribution("data_source", "active_sessions", {
		input_schema_id: schemaId("empty.v1"),
		output_schema_id: schemaId("sessions.v1"),
		audience: "application_client",
		permission: "application.identity.sessions.read",
		store_id: `${pluginId}.store.user_sessions`,
		consistency: "strong",
		unavailable_state: "unavailable",
	}),
]);

const manifestArtifact = {
	schema_version: "1.0.0",
	plugin_id: pluginId,
	plugin_kind: "full",
	plugin_version: pluginVersion,
	artifact_id: `${pluginId}@${pluginVersion}`,
	publisher: "superboard",
	resources: [
		"USER_DIRECTORY_STORE",
		"USER_CREDENTIALS_STORE",
		"USER_SESSIONS_STORE",
		"PLUGIN_PRIVATE_KV",
		"SECRET:APPLICATION_JWT_SIGNING_KEY",
	],
	settings: {
		render_mode: "block_kit",
		storage: "plugin_kv",
		schema: {
			type: "object",
			additionalProperties: false,
			required: ["mfa_policy", "allow_anonymous_upgrade", "max_active_sessions"],
			properties: {
				mfa_policy: { type: "string", enum: ["optional", "required"] },
				allow_anonymous_upgrade: { type: "boolean" },
				max_active_sessions: { type: "integer", minimum: 1, maximum: 20 },
			},
		},
	},
	execution: { backend: "sandboxed", worker: "none", renderer: "native_bundle" },
	capabilities: [
		"plugin.storage",
		"identity.directory.read",
		"identity.directory.write",
		"identity.credentials.read",
		"identity.credentials.write",
		"identity.providers.read",
		"identity.providers.write",
		"identity.sessions.read",
		"identity.sessions.write",
		"identity.tokens.sign",
		"renderer.register",
	],
	aliases: {
		"user.login-form": USER_RENDERER_IDS.login,
		"user.profile-card": USER_RENDERER_IDS.profile,
		"user.members-table": USER_RENDERER_IDS.members,
	},
	stores,
	schemas,
	renderers,
	commands,
	data_sources: dataSources,
	failure_policies: { writes: "fail_closed", reads: "unavailable" },
} satisfies Omit<SuperBoardPluginManifest, "artifact_checksum">;

function pluginArtifactContent(manifest: unknown): unknown {
	return {
		manifest,
		renderer_implementations: rendererBuilds.map(
			({ renderer_id, build_id, props_schema_name }) => ({
				renderer_id,
				build_id,
				props_schema_name,
			}),
		),
	};
}

export const userPluginManifest: SuperBoardPluginManifest = deepFreeze({
	...manifestArtifact,
	artifact_checksum: await sha256Canonical(pluginArtifactContent(manifestArtifact)),
});

export async function validateUserPluginManifest(value: unknown) {
	const manifestWithoutChecksum = isRecord(value)
		? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "artifact_checksum"))
		: value;
	const result = await verifySuperBoardPluginManifest(value, {
		artifact_content: pluginArtifactContent(manifestWithoutChecksum),
	});
	if (!result.valid || !isRecord(value)) return result;
	const errors: string[] = [];
	if (value.plugin_id !== pluginId || value.plugin_kind !== "full")
		errors.push("PLUGIN_IDENTITY_INVALID");
	if (!isRecord(value.execution) || value.execution.worker !== "none")
		errors.push("PLUGIN_EXECUTION_INVALID");
	for (const definition of Array.isArray(value.renderers) ? value.renderers : []) {
		if (
			!isRecord(definition) ||
			definition.abi_version !== rendererRuntime.abi_version ||
			definition.runtime_range !== ">=0.1.0 <0.2.0" ||
			JSON.stringify(definition.supported_states) !== JSON.stringify(REQUIRED_FRONT_STATES)
		)
			errors.push("RENDERER_CONTRACT_INVALID");
		if (!propsSchemas.some(({ schema_id }) => schema_id === definition.props_schema?.schema_id))
			errors.push("RENDERER_PROPS_SCHEMA_UNREGISTERED");
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function mountUserRenderer(input: {
	renderer_id: string;
	props: UserRendererProps;
	descriptor?: RendererDescriptor;
	root_layout?: boolean;
}): UserRendererView {
	const descriptor =
		input.descriptor ?? renderers.find(({ renderer_id }) => renderer_id === input.renderer_id);
	if (!descriptor) throw new Error(`Renderer descriptor missing: ${input.renderer_id}`);
	assertRendererCompatibility(descriptor, rendererRuntime);
	const renderer = rendererRegistry[input.renderer_id];
	if (!renderer) {
		if (input.root_layout) throw new Error(`Root renderer unavailable: ${input.renderer_id}`);
		return errorView(input.renderer_id);
	}
	try {
		return renderer(input.props);
	} catch (error) {
		if (input.root_layout) throw error;
		return errorView(input.renderer_id);
	}
}

const rendererRegistry: Record<string, (props: UserRendererProps) => UserRendererView> = {
	[USER_RENDERER_IDS.login]: renderLogin,
	[USER_RENDERER_IDS.profile]: renderProfile,
	[USER_RENDERER_IDS.members]: renderMembers,
	[USER_RENDERER_IDS.admin]: renderAdminSurface,
};

function renderLogin(props: UserRendererProps): UserRendererView {
	if (props.kind !== "login" || props.title_message_id !== "user.page.sign_in")
		throw new TypeError("Invalid login renderer props");
	return {
		...baseView(USER_RENDERER_IDS.login, "user.login.title", "user.login.description"),
		kind: "login",
		action_id: "emdash.core.action.admin_session_start",
	};
}

function renderProfile(props: UserRendererProps): UserRendererView {
	if (props.kind !== "profile" || !validMember(props.operator))
		throw new TypeError("Invalid profile renderer props");
	return {
		...baseView(USER_RENDERER_IDS.profile, "user.profile.title", "user.profile.description"),
		kind: "profile",
		operator: props.operator,
	};
}

function renderMembers(props: UserRendererProps): UserRendererView {
	if (
		props.kind !== "members" ||
		!Number.isInteger(props.page_size) ||
		props.page_size < 10 ||
		props.page_size > 100 ||
		!props.members.every(validMember)
	)
		throw new TypeError("Invalid members renderer props");
	return {
		...baseView(USER_RENDERER_IDS.members, "user.members.title", "user.members.description"),
		kind: "members",
		members: props.members.slice(0, props.page_size),
	};
}

function renderAdminSurface(props: UserRendererProps): UserRendererView {
	if (
		props.kind !== "admin_surface" ||
		typeof props.route_id !== "string" ||
		props.route_id.length === 0 ||
		typeof props.path !== "string" ||
		!props.path.startsWith("/")
	) {
		throw new TypeError("Invalid User admin surface renderer props");
	}
	return {
		...baseView(USER_RENDERER_IDS.admin, "user.admin.title", "user.admin.description"),
		kind: "admin_surface",
		route_id: props.route_id,
		path: props.path,
	};
}

async function rendererDescriptor(
	definition: RendererBuildDefinition,
): Promise<RendererDescriptor> {
	const propsSchema = propsSchemas.find(
		({ schema_id }) => schema_id === `${pluginId}.schema.${definition.props_schema_name}`,
	);
	if (!propsSchema) throw new Error(`Missing props schema: ${definition.props_schema_name}`);
	return {
		renderer_id: definition.renderer_id,
		plugin_id: pluginId,
		plugin_version: pluginVersion,
		build_id:
			definition.renderer_id === USER_RENDERER_IDS.admin
				? frontBundle.build_id
				: definition.build_id,
		build_checksum:
			definition.renderer_id === USER_RENDERER_IDS.admin
				? frontBundle.build_checksum
				: await sha256Canonical({
						renderer_id: definition.renderer_id,
						build_id: definition.build_id,
						props_schema_checksum: propsSchema.checksum,
					}),
		abi_version: "1.0.0",
		runtime_range: ">=0.1.0 <0.2.0",
		props_schema: {
			schema_id: propsSchema.schema_id,
			version: propsSchema.version,
			checksum: propsSchema.checksum,
		},
		capabilities: ["renderer.mount"],
		slots: [],
		supported_states: [...REQUIRED_FRONT_STATES],
	};
}

async function schemaContribution(
	name: string,
	jsonSchema: { readonly [key: string]: unknown },
): Promise<SuperBoardSchemaDescriptor> {
	return contribution("schema", name, { closed: true, json_schema: jsonSchema });
}

async function contribution<
	K extends "store" | "schema" | "command" | "data_source",
	const T extends Record<string, unknown>,
>(
	kind: K,
	name: string,
	contract: T,
): Promise<T & Record<`${K}_id`, string> & { version: string; checksum: string }> {
	const content = { [`${kind}_id`]: `${pluginId}.${kind}.${name}`, ...contract, version: "1.0.0" };
	return { ...content, checksum: await sha256Canonical(content) } as T &
		Record<`${K}_id`, string> & { version: string; checksum: string };
}

function baseView(
	rendererId: string,
	title: UserMessageId,
	description: UserMessageId,
): BaseRendererView {
	return {
		state: "rendered",
		renderer_id: rendererId,
		title_message_id: title,
		description_message_id: description,
		isolated: false,
	};
}
function errorView(rendererId: string): UserRendererView {
	return {
		state: "error",
		renderer_id: rendererId,
		title_message_id: "user.members.title",
		description_message_id: "user.members.description",
		isolated: true,
		kind: "error",
	};
}
function validMember(value: unknown): value is UserMember {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.email === "string" &&
		(typeof value.name === "string" || value.name === null) &&
		typeof value.role === "number" &&
		typeof value.disabled === "boolean"
	);
}
function schemaId(name: string) {
	return `${pluginId}.schema.${name}`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function closedObject<
	const Required extends readonly string[],
	const Properties extends Record<string, unknown>,
>(required: Required, properties: Properties) {
	return { type: "object", additionalProperties: false, required, properties } as const;
}
function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
