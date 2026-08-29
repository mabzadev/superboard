import {
	REQUIRED_FRONT_STATES,
	type FrontReleaseInput,
	type FrontState,
	type RendererDescriptor,
} from "@superboard/supbrd-core";

const pluginId = "supbrd-plug-user";
const pluginVersion = "1.3.0";
const checksumPattern = /^sha256:[a-f0-9]{64}$/u;

export interface UserRendererView {
	state: "rendered" | "error";
	renderer_id: string;
	title: string;
	description: string;
	isolated: boolean;
	fields: Array<{ label: string; value: string }>;
}

interface UserRendererDefinition {
	renderer_id: string;
	element_type: string;
	build_id: string;
	build_checksum: string;
	abi_version: "1.0.0";
	runtime_range: ">=0.1.0 <0.2.0";
	props_schema: {
		schema_id: string;
		version: "1.0.0";
		checksum: string;
		additionalProperties: false;
		required: string[];
	};
	supported_states: readonly FrontState[];
}

const renderers = [
	renderer(
		"user.login-form",
		`${pluginId}.renderer.login_form`,
		"1fafd5f20b26f2eb0beb5b30e228b923fce3de2d1f0e8b4fc25bdc9f2d1fc94e",
		`${pluginId}.schema.login_form_props.v1`,
		"a1f0992d7a120291de3ad34516b07513703ca5ecf9f44d444ad87b9fe66f5b9a",
		["title"],
	),
	renderer(
		"user.profile-card",
		`${pluginId}.renderer.profile_card`,
		"0bb8e6c1a08620b37f9ba2fa99173b065740a09d5218addeb9aa2f8b62bd806f",
		`${pluginId}.schema.profile_card_props.v1`,
		"885c218c126644cd33273e8c02817cd3cceb311a0c076ebc7fde2ea3047b0209",
		["show_devices"],
	),
	renderer(
		"user.members-table",
		`${pluginId}.renderer.members_table`,
		"8a91976d6e4961f6deb2b589189b979c706cfccc9f64de9a313b56fdcb1b1424",
		`${pluginId}.schema.members_table_props.v1`,
		"df2fc0bb9e00e19298de3adb439555767aef51d1a47813ce17b529efe966d2cb",
		["page_size"],
	),
] as const;

const manifest = {
	schema_version: "1.0.0",
	plugin_id: pluginId,
	plugin_kind: "full",
	plugin_version: pluginVersion,
	artifact_id: `${pluginId}@${pluginVersion}`,
	artifact_checksum:
		"sha256:30064029eb79e4216d08c5328c45e3d005b144a662cf5e5683c6ba6daa2d3046",
	publisher: "superboard",
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
		"user.login-form": `${pluginId}.renderer.login_form`,
		"user.profile-card": `${pluginId}.renderer.profile_card`,
		"user.members-table": `${pluginId}.renderer.members_table`,
	},
	stores: [
		store("user_directory", "restricted", "0001_user_directory"),
		store("user_credentials", "secret", "0002_user_credentials_providers"),
		store("user_sessions", "restricted", "0003_application_sessions"),
	],
	schemas: [
		schema("empty.v1"),
		schema("user_profile.v1"),
		schema("user_profile_update.v1"),
		schema("user_members_query.v1"),
		schema("user_members_page.v1"),
		schema("user_member_suspend.v1"),
		schema("user_member.v1"),
		schema("application_sign_in.v1"),
		schema("application_session.v1"),
	],
	renderers,
	commands: [
		command("application_sign_in", "application_client", "application.identity.sign_in"),
		command("update_profile", "superboard_front", "users.write"),
		command("suspend_member", "superboard_front", "users.write"),
	],
	data_sources: [
		dataSource("current_profile", "superboard_front", "users.read", "user_directory"),
		dataSource("members", "superboard_front", "users.read", "user_directory"),
	],
	failure_policies: { writes: "fail_closed", reads: "unavailable" },
} as const;

export const userPluginManifest = deepFreeze(manifest);

export function validateUserPluginManifest(value: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!isRecord(value)) return { valid: false, errors: ["MANIFEST_NOT_OBJECT"] };
	const expectedKeys = [
		"aliases",
		"artifact_checksum",
		"artifact_id",
		"capabilities",
		"commands",
		"data_sources",
		"execution",
		"failure_policies",
		"plugin_id",
		"plugin_kind",
		"plugin_version",
		"publisher",
		"renderers",
		"schema_version",
		"schemas",
		"stores",
	].toSorted();
	if (JSON.stringify(Object.keys(value).toSorted()) !== JSON.stringify(expectedKeys)) {
		errors.push("MANIFEST_NOT_CLOSED");
	}
	if (value.plugin_id !== pluginId || value.plugin_kind !== "full") errors.push("PLUGIN_IDENTITY_INVALID");
	if (!isRecord(value.execution) || value.execution.worker !== "none") {
		errors.push("PLUGIN_EXECUTION_INVALID");
	}
	if (typeof value.artifact_checksum !== "string" || !checksumPattern.test(value.artifact_checksum)) {
		errors.push("ARTIFACT_CHECKSUM_INVALID");
	}
	for (const [collection, namespace] of [
		[value.renderers, `${pluginId}.renderer.`],
		[value.commands, `${pluginId}.command.`],
		[value.data_sources, `${pluginId}.data_source.`],
		[value.schemas, `${pluginId}.schema.`],
		[value.stores, `${pluginId}.store.`],
	] as const) {
		if (!Array.isArray(collection)) {
			errors.push("CONTRIBUTION_COLLECTION_INVALID");
			continue;
		}
		for (const contribution of collection) {
			const id = contributionId(contribution);
			if (!id?.startsWith(namespace)) errors.push("CONTRIBUTION_NAMESPACE_INVALID");
		}
	}
	for (const definition of Array.isArray(value.renderers) ? value.renderers : []) {
		if (
			!isRecord(definition) ||
			definition.abi_version !== "1.0.0" ||
			definition.runtime_range !== ">=0.1.0 <0.2.0" ||
			JSON.stringify(definition.supported_states) !== JSON.stringify(REQUIRED_FRONT_STATES)
		) {
			errors.push("RENDERER_CONTRACT_INVALID");
		}
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function composeUserFrontReleaseInput(input: {
	instance_id: string;
	front_draft_id: string;
	draft_snapshot_id: string;
	compilation_id: string;
	candidate_id: string;
	release_id: string;
	created_at: string;
}): FrontReleaseInput {
	const statePolicies = Object.fromEntries(
		REQUIRED_FRONT_STATES.map((state) => [state, `emdash.core.state.${state}`]),
	) as Record<FrontState, string>;
	const route = (
		routeId: string,
		path: string,
		pageId: string,
		rendererIds: string[],
		authPolicy: "anonymous_only" | "authenticated",
		permission: string,
	) => ({
		route_id: routeId,
		path_pattern: path,
		route_kind: "page" as const,
		audience: "superboard_front" as const,
		auth_policy: authPolicy,
		permission_expression: permission,
		priority: 100,
		parameters: {},
		query: {},
		page_id: pageId,
		layout_ids: authPolicy === "authenticated" ? ["layout.superboard_admin"] : [],
		renderer_ids: rendererIds,
		state_policies: statePolicies,
		dependencies: ["dependency.supbrd_plug_user"],
		redirect: null,
	});
	return {
		schema_version: "1.0.0",
		compiler_version: "0.1.0",
		...input,
		release_sequence: 1,
		previous_release_id: null,
		front_route_manifest: {
			schema_version: "1.0.0",
			manifest_id: "01J00000000000000000000220",
			normalization: {
				unicode: "NFC",
				case_sensitive: true,
				trailing_slash: "strip",
				percent_decoding: "once",
			},
			auth_transitions: {
				login_route_id: "superboard.login",
				authenticated_home_route_id: "superboard.app_shell",
			},
			system_routes: [],
			routes: [
				route(
					"superboard.login",
					"/login",
					"page.superboard_login",
					[`${pluginId}.renderer.login_form`],
					"anonymous_only",
					"allow",
				),
				route("superboard.app_shell", "/app", "page.superboard_app", [], "authenticated", "allow"),
				route(
					"superboard.profile",
					"/app/profile",
					"page.superboard_profile",
					[`${pluginId}.renderer.profile_card`],
					"authenticated",
					"users.read",
				),
				route(
					"superboard.users",
					"/app/users",
					"page.superboard_users",
					[`${pluginId}.renderer.members_table`],
					"authenticated",
					"users.read",
				),
			],
		},
		gateway_manifest: {
			schema_version: "1.0.0",
			gateway_manifest_id: "01J00000000000000000000221",
			routes: [],
		},
		presentation: {
			pages: [
				page("page.superboard_login", "Sign in", `${pluginId}.renderer.login_form`),
				page("page.superboard_app", "SuperBoard", "emdash.core.renderer.admin_shell"),
				page("page.superboard_profile", "Profile", `${pluginId}.renderer.profile_card`),
				page("page.superboard_users", "Users", `${pluginId}.renderer.members_table`),
			],
			layouts: [
				{ layout_id: "layout.superboard_admin", root_renderer_id: "emdash.core.renderer.admin_shell" },
			],
			navigation: [
				{ route_id: "superboard.profile", label: "Profile", permission: "users.read" },
				{ route_id: "superboard.users", label: "Users", permission: "users.read" },
			],
			translations: [],
			media: [],
			theme: { theme_id: "theme.superboard", tokens: {} },
		},
		renderers: renderers.map((definition) => rendererContract(definition)),
		plugin_lock: [
			{
				plugin_id: "supbrd-core",
				version: "0.1.0",
				artifact_checksum: `sha256:${"c".repeat(64)}`,
				native: true,
			},
			{
				plugin_id: pluginId,
				version: pluginVersion,
				artifact_checksum: manifest.artifact_checksum,
				native: false,
			},
		],
		dependency_policies: [
			{
				dependency_id: "dependency.supbrd_plug_user",
				kind: "required",
				minimum_version: pluginVersion,
				activation_policy: "ready",
				runtime_failure_policy: "unavailable",
				fallback_dependency_id: null,
			},
		],
		rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] },
		core_concrete_pages: [],
	};
}

export function mountUserRenderer(input: {
	renderer_id: string;
	props: unknown;
	render: (props: unknown) => UserRendererView;
	root_layout: boolean;
}): UserRendererView {
	assertRendererProps(input.renderer_id, input.props);
	try {
		return input.render(input.props);
	} catch (error) {
		if (input.root_layout) throw error;
		return {
			state: "error",
			renderer_id: input.renderer_id,
			title: "Renderer unavailable",
			description: "This plugin renderer failed in isolation.",
			isolated: true,
			fields: [],
		};
	}
}

export function renderUserRenderer(rendererId: string): UserRendererView {
	const views: Record<string, UserRendererView> = {
		[`${pluginId}.renderer.login_form`]: view(rendererId, "Operator sign in", "Continue with EmDash Passkey."),
		[`${pluginId}.renderer.profile_card`]: view(rendererId, "Operator profile", "Manage your SuperBoard profile."),
		[`${pluginId}.renderer.members_table`]: view(rendererId, "Application users", "Review application-user access."),
	};
	const rendererView = views[rendererId];
	if (!rendererView) throw new Error(`Unknown user renderer: ${rendererId}`);
	return rendererView;
}

export function visibleUserNavigation(
	input: FrontReleaseInput,
	permissions: readonly string[],
): Array<{ route_id: string; label: string }> {
	const routeIds = new Set(input.front_route_manifest.routes.map(({ route_id: routeId }) => routeId));
	return input.presentation.navigation.flatMap((entry) => {
		if (
			!isRecord(entry) ||
			typeof entry.route_id !== "string" ||
			typeof entry.label !== "string" ||
			typeof entry.permission !== "string" ||
			!routeIds.has(entry.route_id) ||
			!permissions.includes(entry.permission)
		) {
			return [];
		}
		return [{ route_id: entry.route_id, label: entry.label }];
	});
}

function renderer(
	elementType: string,
	rendererId: string,
	buildChecksum: string,
	schemaId: string,
	propsChecksum: string,
	required: string[],
): UserRendererDefinition {
	return {
		element_type: elementType,
		renderer_id: rendererId,
		build_id: "01J00000000000000000000240",
		build_checksum: `sha256:${buildChecksum}`,
		abi_version: "1.0.0",
		runtime_range: ">=0.1.0 <0.2.0",
		props_schema: {
			schema_id: schemaId,
			version: "1.0.0",
			checksum: `sha256:${propsChecksum}`,
			additionalProperties: false,
			required,
		},
		supported_states: REQUIRED_FRONT_STATES,
	};
}

function rendererContract(definition: UserRendererDefinition): RendererDescriptor {
	return {
		renderer_id: definition.renderer_id,
		plugin_id: pluginId,
		plugin_version: pluginVersion,
		build_id: definition.build_id,
		build_checksum: definition.build_checksum,
		abi_version: definition.abi_version,
		runtime_range: definition.runtime_range,
		props_schema: {
			schema_id: definition.props_schema.schema_id,
			version: definition.props_schema.version,
			checksum: definition.props_schema.checksum,
		},
		capabilities: ["renderer.mount"],
		slots: [],
		supported_states: [...definition.supported_states],
	};
}

function assertRendererProps(rendererId: string, props: unknown): void {
	if (!isRecord(props)) throw new TypeError("Renderer props must be an object");
	if (rendererId.endsWith("login_form") && typeof props.title !== "string") {
		throw new TypeError("login_form.title is required");
	}
	if (rendererId.endsWith("profile_card") && typeof props.show_devices !== "boolean") {
		throw new TypeError("profile_card.show_devices is required");
	}
	if (
		rendererId.endsWith("members_table") &&
		(!Number.isInteger(props.page_size) || Number(props.page_size) < 10 || Number(props.page_size) > 100)
	) {
		throw new TypeError("members_table.page_size must be between 10 and 100");
	}
}

function store(name: string, classification: string, migration: string) {
	return {
		store_id: `${pluginId}.store.${name}`,
		kind: "d1",
		authority: pluginId,
		schema_version: "1",
		migrations: [migration],
		availability: "required",
		classification,
		encryption: "required",
	};
}

function schema(name: string) {
	return { schema_id: `${pluginId}.schema.${name}`, closed: true, version: "1.0.0" };
}

function command(name: string, audience: string, permission: string) {
	return {
		command_id: `${pluginId}.command.${name}`,
		audience,
		permission,
		failure_policy: "fail_closed",
	};
}

function dataSource(name: string, audience: string, permission: string, storeName: string) {
	return {
		data_source_id: `${pluginId}.data_source.${name}`,
		audience,
		permission,
		store_id: `${pluginId}.store.${storeName}`,
		consistency: "strong",
		unavailable_state: "unavailable",
	};
}

function contributionId(value: unknown): string | null {
	if (!isRecord(value)) return null;
	for (const key of ["renderer_id", "command_id", "data_source_id", "schema_id", "store_id"] as const) {
		if (typeof value[key] === "string") return value[key];
	}
	return null;
}

function page(pageId: string, title: string, rootRendererId: string) {
	return { page_id: pageId, title, root_renderer_id: rootRendererId };
}

function view(rendererId: string, title: string, description: string): UserRendererView {
	return { state: "rendered", renderer_id: rendererId, title, description, isolated: false, fields: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null) return value;
	Object.freeze(value);
	for (const child of Object.values(value)) deepFreeze(child);
	return value;
}
