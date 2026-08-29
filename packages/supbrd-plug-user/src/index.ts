import {
	REQUIRED_FRONT_STATES,
	sha256Canonical,
	verifySuperBoardPluginManifest,
	type FrontReleaseInput,
	type FrontState,
	type RendererDescriptor,
	type SuperBoardPluginManifest,
} from "@superboard/supbrd-core";

const pluginId = "supbrd-plug-user";
const pluginVersion = "1.3.0";
const rendererRuntime = { abi_version: "1.0.0", runtime_version: "0.1.0" } as const;

export const USER_RENDERER_IDS = {
	login: `${pluginId}.renderer.login_form`,
	profile: `${pluginId}.renderer.profile_card`,
	members: `${pluginId}.renderer.members_table`,
} as const;

export const USER_MESSAGES = {
	en: {
		"user.page.sign_in": "Sign in",
		"user.page.profile": "Profile",
		"user.page.users": "Users",
		"user.login.title": "Operator sign in",
		"user.login.description": "Continue with the EmDash passkey that protects this SuperBoard instance.",
		"user.profile.title": "Operator profile",
		"user.profile.description": "Review the identity used by this operator session.",
		"user.members.title": "Application users",
		"user.members.description": "Review application-user access independently from operator authentication.",
		"user.action.passkey": "Continue with Passkey",
		"user.field.name": "Name",
		"user.field.email": "Email",
		"user.field.role": "Role",
		"user.field.status": "Status",
		"user.status.active": "Active",
		"user.status.disabled": "Disabled",
	},
	fr: {
		"user.page.sign_in": "Connexion",
		"user.page.profile": "Profil",
		"user.page.users": "Utilisateurs",
		"user.login.title": "Connexion opérateur",
		"user.login.description": "Continuez avec la passkey EmDash qui protège cette instance SuperBoard.",
		"user.profile.title": "Profil opérateur",
		"user.profile.description": "Consultez l’identité utilisée par cette session opérateur.",
		"user.members.title": "Utilisateurs de l’application",
		"user.members.description": "Consultez les accès applicatifs indépendamment de l’authentification opérateur.",
		"user.action.passkey": "Continuer avec une passkey",
		"user.field.name": "Nom",
		"user.field.email": "E-mail",
		"user.field.role": "Rôle",
		"user.field.status": "Statut",
		"user.status.active": "Actif",
		"user.status.disabled": "Désactivé",
	},
} as const;

export type UserMessageId = keyof (typeof USER_MESSAGES)["en"];
export type UserLocale = keyof typeof USER_MESSAGES;

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
	| { kind: "members"; page_size: number; members: UserMember[] };

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
	| (BaseRendererView & { kind: "error" });

interface RendererBuildDefinition {
	element_type: string;
	renderer_id: string;
	build_id: string;
	props_schema: { schema_id: string; version: "1.0.0"; additionalProperties: false; required: string[] };
	build_contract: { component: string; states: readonly FrontState[] };
}

const rendererBuilds: RendererBuildDefinition[] = [
	rendererBuild("user.login-form", USER_RENDERER_IDS.login, "login-form-v1", "01J00000000000000000000240", ["kind", "title_message_id"]),
	rendererBuild("user.profile-card", USER_RENDERER_IDS.profile, "profile-card-v1", "01J00000000000000000000241", ["kind", "operator"]),
	rendererBuild("user.members-table", USER_RENDERER_IDS.members, "members-table-v1", "01J00000000000000000000242", ["kind", "page_size", "members"]),
];

const renderers = await Promise.all(rendererBuilds.map(async (definition) => rendererDescriptor(definition)));
const stores = await Promise.all([
	contribution("store", "user_directory", { kind: "d1", authority: pluginId, schema_version: "1", migrations: ["0001_user_directory"], availability: "required", classification: "restricted", encryption: "required" }),
	contribution("store", "user_credentials", { kind: "d1", authority: pluginId, schema_version: "1", migrations: ["0002_user_credentials_providers"], availability: "required", classification: "secret", encryption: "required" }),
	contribution("store", "user_sessions", { kind: "d1", authority: pluginId, schema_version: "1", migrations: ["0003_application_sessions"], availability: "required", classification: "restricted", encryption: "required" }),
]);
const schemas = await Promise.all([
	"empty.v1", "user_profile.v1", "user_profile_update.v1", "user_members_query.v1",
	"user_members_page.v1", "user_member_suspend.v1", "user_member.v1", "application_sign_in.v1",
	"application_session.v1",
].map((name) => contribution("schema", name, { closed: true })));
const commands = await Promise.all([
	contribution("command", "application_sign_in", { audience: "application_client", permission: "application.identity.sign_in", failure_policy: "fail_closed" }),
	contribution("command", "update_profile", { audience: "superboard_front", permission: "users.write", failure_policy: "fail_closed" }),
	contribution("command", "suspend_member", { audience: "superboard_front", permission: "users.write", failure_policy: "fail_closed" }),
]);
const dataSources = await Promise.all([
	contribution("data_source", "current_profile", { audience: "superboard_front", permission: "users.read", store_id: `${pluginId}.store.user_directory`, consistency: "strong", unavailable_state: "unavailable" }),
	contribution("data_source", "members", { audience: "superboard_front", permission: "users.read", store_id: `${pluginId}.store.user_directory`, consistency: "strong", unavailable_state: "unavailable" }),
]);

const manifestArtifact = {
	schema_version: "1.0.0",
	plugin_id: pluginId,
	plugin_kind: "full",
	plugin_version: pluginVersion,
	artifact_id: `${pluginId}@${pluginVersion}`,
	publisher: "superboard",
	execution: { backend: "sandboxed", worker: "none", renderer: "native_bundle" },
	capabilities: ["plugin.storage", "identity.directory.read", "identity.directory.write", "identity.credentials.read", "identity.credentials.write", "identity.providers.read", "identity.providers.write", "identity.sessions.read", "identity.sessions.write", "identity.tokens.sign", "renderer.register"],
	aliases: { "user.login-form": USER_RENDERER_IDS.login, "user.profile-card": USER_RENDERER_IDS.profile, "user.members-table": USER_RENDERER_IDS.members },
	stores,
	schemas,
	renderers,
	commands,
	data_sources: dataSources,
	failure_policies: { writes: "fail_closed", reads: "unavailable" },
} satisfies Omit<SuperBoardPluginManifest, "artifact_checksum">;

export const userPluginManifest: SuperBoardPluginManifest = deepFreeze({
	...manifestArtifact,
	artifact_checksum: await sha256Canonical(manifestArtifact),
});

export async function validateUserPluginManifest(value: unknown) {
	const result = await verifySuperBoardPluginManifest(value);
	if (!result.valid || !isRecord(value)) return result;
	const errors: string[] = [];
	if (value.plugin_id !== pluginId || value.plugin_kind !== "full") errors.push("PLUGIN_IDENTITY_INVALID");
	if (!isRecord(value.execution) || value.execution.worker !== "none") errors.push("PLUGIN_EXECUTION_INVALID");
	for (const definition of Array.isArray(value.renderers) ? value.renderers : []) {
		if (!isRecord(definition) || definition.abi_version !== rendererRuntime.abi_version || definition.runtime_range !== ">=0.1.0 <0.2.0" || JSON.stringify(definition.supported_states) !== JSON.stringify(REQUIRED_FRONT_STATES)) errors.push("RENDERER_CONTRACT_INVALID");
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export async function composeUserFrontReleaseInput(input: {
	instance_id: string; front_draft_id: string; draft_snapshot_id: string; compilation_id: string;
	candidate_id: string; release_id: string; created_at: string;
}): Promise<FrontReleaseInput> {
	const statePolicies = Object.fromEntries(REQUIRED_FRONT_STATES.map((state) => [state, `emdash.core.state.${state}`])) as Record<FrontState, string>;
	const route = (routeId: string, path: string, pageId: string, rendererIds: string[], authPolicy: "anonymous_only" | "authenticated", permission: string) => ({
		route_id: routeId, path_pattern: path, route_kind: "page" as const, audience: "superboard_front" as const,
		auth_policy: authPolicy, permission_expression: permission, priority: 100, parameters: {}, query: {},
		page_id: pageId, layout_ids: authPolicy === "authenticated" ? ["layout.superboard_admin"] : [],
		renderer_ids: rendererIds, state_policies: statePolicies, dependencies: ["dependency.supbrd_plug_user"], redirect: null,
	});
	return {
		schema_version: "1.0.0", compiler_version: "0.1.0", ...input, release_sequence: 1, previous_release_id: null,
		front_route_manifest: {
			schema_version: "1.0.0", manifest_id: "01J00000000000000000000220",
			normalization: { unicode: "NFC", case_sensitive: true, trailing_slash: "strip", percent_decoding: "once" },
			auth_transitions: { login_route_id: "superboard.login", authenticated_home_route_id: "superboard.app_shell" }, system_routes: [],
			routes: [
				route("superboard.login", "/login", "page.superboard_login", [USER_RENDERER_IDS.login], "anonymous_only", "allow"),
				route("superboard.app_shell", "/app", "page.superboard_app", [], "authenticated", "allow"),
				route("superboard.profile", "/app/profile", "page.superboard_profile", [USER_RENDERER_IDS.profile], "authenticated", "users.read"),
				route("superboard.users", "/app/users", "page.superboard_users", [USER_RENDERER_IDS.members], "authenticated", "users.read"),
			],
		},
		gateway_manifest: { schema_version: "1.0.0", gateway_manifest_id: "01J00000000000000000000221", routes: [] },
		presentation: {
			pages: [page("page.superboard_login", "user.page.sign_in", USER_RENDERER_IDS.login), page("page.superboard_app", "SuperBoard", "emdash.core.renderer.admin_shell"), page("page.superboard_profile", "user.page.profile", USER_RENDERER_IDS.profile), page("page.superboard_users", "user.page.users", USER_RENDERER_IDS.members)],
			layouts: [{ layout_id: "layout.superboard_admin", root_renderer_id: "emdash.core.renderer.admin_shell" }],
			navigation: [{ route_id: "superboard.profile", label: "user.page.profile", permission: "users.read" }, { route_id: "superboard.users", label: "user.page.users", permission: "users.read" }],
			translations: Object.entries(USER_MESSAGES).map(([locale, messages]) => ({ locale, messages })), media: [],
			theme: { theme_id: "theme.superboard", tokens: {} },
		},
		renderers,
		plugin_lock: [
			{ plugin_id: "supbrd-core", version: "0.1.0", artifact_checksum: await sha256Canonical({ artifact_id: "supbrd-core@0.1.0", native: true }), native: true },
			{ plugin_id: pluginId, version: pluginVersion, artifact_checksum: userPluginManifest.artifact_checksum, native: false },
		],
		dependency_policies: [{ dependency_id: "dependency.supbrd_plug_user", kind: "required", minimum_version: pluginVersion, activation_policy: "ready", runtime_failure_policy: "unavailable", fallback_dependency_id: null }],
		rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] }, core_concrete_pages: [],
	};
}

export const CORE_ADMIN_SHELL_DESCRIPTOR: RendererDescriptor = {
	renderer_id: "emdash.core.renderer.admin_shell", plugin_id: "supbrd-core", plugin_version: "0.1.0",
	build_id: "emdash-admin-shell-0.1.0", build_checksum: await sha256Canonical({ component: "emdash-admin-shell", version: "0.1.0" }),
	abi_version: "1.0.0", runtime_range: ">=0.1.0 <0.2.0",
	props_schema: { schema_id: "emdash.core.schema.admin_shell_props.v1", version: "1.0.0", checksum: await sha256Canonical({ closed: true, required: [] }) },
	capabilities: ["renderer.mount"], slots: ["content"], supported_states: [...REQUIRED_FRONT_STATES],
};

export function assertRendererCompatibility(descriptor: RendererDescriptor, runtime = rendererRuntime): void {
	if (descriptor.abi_version !== runtime.abi_version || !descriptor.runtime_range.startsWith(">=0.1.0 ")) {
		throw new Error(`Renderer compatibility rejected for ${descriptor.renderer_id}`);
	}
}

export function mountUserRenderer(input: { renderer_id: string; props: UserRendererProps; descriptor?: RendererDescriptor; root_layout?: boolean }): UserRendererView {
	const descriptor = input.descriptor ?? renderers.find(({ renderer_id }) => renderer_id === input.renderer_id);
	if (!descriptor) throw new Error(`Renderer descriptor missing: ${input.renderer_id}`);
	assertRendererCompatibility(descriptor);
	const renderer = rendererRegistry[input.renderer_id];
	if (!renderer) {
		if (input.root_layout) throw new Error(`Root renderer unavailable: ${input.renderer_id}`);
		return errorView(input.renderer_id);
	}
	try { return renderer(input.props); }
	catch (error) { if (input.root_layout) throw error; return errorView(input.renderer_id); }
}

const rendererRegistry: Record<string, (props: UserRendererProps) => UserRendererView> = {
	[USER_RENDERER_IDS.login]: (props) => {
		if (props.kind !== "login" || props.title_message_id !== "user.page.sign_in") throw new TypeError("Invalid login renderer props");
		return { ...baseView(USER_RENDERER_IDS.login, "user.login.title", "user.login.description"), kind: "login", action_id: "emdash.core.action.admin_session_start" };
	},
	[USER_RENDERER_IDS.profile]: (props) => {
		if (props.kind !== "profile" || !validMember(props.operator)) throw new TypeError("Invalid profile renderer props");
		return { ...baseView(USER_RENDERER_IDS.profile, "user.profile.title", "user.profile.description"), kind: "profile", operator: props.operator };
	},
	[USER_RENDERER_IDS.members]: (props) => {
		if (props.kind !== "members" || !Number.isInteger(props.page_size) || props.page_size < 10 || props.page_size > 100 || !props.members.every(validMember)) throw new TypeError("Invalid members renderer props");
		return { ...baseView(USER_RENDERER_IDS.members, "user.members.title", "user.members.description"), kind: "members", members: props.members.slice(0, props.page_size) };
	},
};

export function visibleUserNavigation(input: FrontReleaseInput, permissions: readonly string[]) {
	const routeIds = new Set(input.front_route_manifest.routes.map(({ route_id }) => route_id));
	return input.presentation.navigation.flatMap((entry) => isRecord(entry) && typeof entry.route_id === "string" && typeof entry.label === "string" && typeof entry.permission === "string" && routeIds.has(entry.route_id) && permissions.includes(entry.permission) ? [{ route_id: entry.route_id, label: entry.label }] : []);
}

function rendererBuild(elementType: string, rendererId: string, component: string, buildId: string, required: string[]): RendererBuildDefinition {
	return { element_type: elementType, renderer_id: rendererId, build_id: buildId, props_schema: { schema_id: `${pluginId}.schema.${component}_props.v1`, version: "1.0.0", additionalProperties: false, required }, build_contract: { component, states: REQUIRED_FRONT_STATES } };
}

async function rendererDescriptor(definition: RendererBuildDefinition): Promise<RendererDescriptor> {
	return { renderer_id: definition.renderer_id, plugin_id: pluginId, plugin_version: pluginVersion, build_id: definition.build_id, build_checksum: await sha256Canonical(definition.build_contract), abi_version: "1.0.0", runtime_range: ">=0.1.0 <0.2.0", props_schema: { schema_id: definition.props_schema.schema_id, version: definition.props_schema.version, checksum: await sha256Canonical(definition.props_schema) }, capabilities: ["renderer.mount"], slots: [], supported_states: [...REQUIRED_FRONT_STATES] };
}

async function contribution<K extends "store" | "schema" | "command" | "data_source", const T extends Record<string, unknown>>(
	kind: K,
	name: string,
	contract: T,
): Promise<T & Record<`${K}_id`, string> & { version: string; checksum: string }> {
	const content = {
		[`${kind}_id`]: `${pluginId}.${kind}.${name}`,
		...contract,
		version: "1.0.0",
	};
	return { ...content, checksum: await sha256Canonical(content) } as T & Record<`${K}_id`, string> & { version: string; checksum: string };
}

function baseView(rendererId: string, title: UserMessageId, description: UserMessageId): BaseRendererView { return { state: "rendered", renderer_id: rendererId, title_message_id: title, description_message_id: description, isolated: false }; }
function errorView(rendererId: string): UserRendererView { return { state: "error", renderer_id: rendererId, title_message_id: "user.members.title", description_message_id: "user.members.description", isolated: true, kind: "error" }; }
function validMember(value: unknown): value is UserMember { return isRecord(value) && typeof value.id === "string" && typeof value.email === "string" && (typeof value.name === "string" || value.name === null) && typeof value.role === "number" && typeof value.disabled === "boolean"; }
function page(pageId: string, title: string, rootRendererId: string) { return { page_id: pageId, title, root_renderer_id: rootRendererId }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function deepFreeze<T>(value: T): T { if (typeof value !== "object" || value === null) return value; Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); return value; }
