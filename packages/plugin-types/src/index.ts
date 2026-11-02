export type PluginCapability =
	| "network:request"
	| "network:request:unrestricted"
	| "content:read"
	| "content:write"
	| "taxonomies:read"
	| "media:read"
	| "media:write"
	| "users:read"
	| "email:send"
	| "hooks.email-transport:register"
	| "hooks.email-events:register"
	| "hooks.page-fragments:register"
	| "network:fetch"
	| "network:fetch:any"
	| "read:content"
	| "write:content"
	| "read:media"
	| "write:media"
	| "read:users"
	| "email:provide"
	| "email:intercept"
	| "page:inject";

export type DeprecatedPluginCapability =
	| "network:fetch"
	| "network:fetch:any"
	| "read:content"
	| "write:content"
	| "read:media"
	| "write:media"
	| "read:users"
	| "email:provide"
	| "email:intercept"
	| "page:inject";

export type CurrentPluginCapability = Exclude<PluginCapability, DeprecatedPluginCapability>;

export const CAPABILITY_RENAMES: Readonly<
	Record<DeprecatedPluginCapability, CurrentPluginCapability>
> = Object.freeze({
	"network:fetch": "network:request",
	"network:fetch:any": "network:request:unrestricted",
	"read:content": "content:read",
	"write:content": "content:write",
	"read:media": "media:read",
	"write:media": "media:write",
	"read:users": "users:read",
	"email:provide": "hooks.email-transport:register",
	"email:intercept": "hooks.email-events:register",
	"page:inject": "hooks.page-fragments:register",
});

export function isDeprecatedCapability(cap: string): cap is DeprecatedPluginCapability {
	return Object.hasOwn(CAPABILITY_RENAMES, cap);
}

export function normalizeCapability(cap: string): string {
	if (isDeprecatedCapability(cap)) {
		return CAPABILITY_RENAMES[cap];
	}
	return cap;
}

export function normalizeCapabilities(caps: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const cap of caps) {
		const norm = normalizeCapability(cap);
		if (!seen.has(norm)) {
			seen.add(norm);
			out.push(norm);
		}
	}
	return out;
}

export type AccessConstraints = Record<string, unknown>;

export interface DeclaredAccess {
	content?: { read?: AccessConstraints; write?: AccessConstraints };
	taxonomies?: { read?: AccessConstraints };
	media?: { read?: AccessConstraints; write?: AccessConstraints };
	network?: { request?: { allowedHosts?: string[] } };
	email?: { send?: AccessConstraints; events?: AccessConstraints; transport?: AccessConstraints };
	page?: { fragments?: AccessConstraints };
	users?: { read?: AccessConstraints };
}

export function capabilitiesToDeclaredAccess(
	capabilities: readonly string[],
	allowedHosts: readonly string[],
): DeclaredAccess {
	const caps = new Set(capabilities.map((c) => normalizeCapability(c)));
	const out: DeclaredAccess = {};

	if (caps.has("content:read") || caps.has("content:write")) {
		out.content = { read: {} };
		if (caps.has("content:write")) out.content.write = {};
	}
	if (caps.has("taxonomies:read")) out.taxonomies = { read: {} };
	if (caps.has("media:read") || caps.has("media:write")) {
		out.media = { read: {} };
		if (caps.has("media:write")) out.media.write = {};
	}
	if (caps.has("network:request:unrestricted")) {
		out.network = { request: {} };
	} else if (caps.has("network:request")) {
		out.network = { request: { allowedHosts: [...allowedHosts] } };
	}
	if (caps.has("email:send")) (out.email ??= {}).send = {};
	if (caps.has("hooks.email-events:register")) (out.email ??= {}).events = {};
	if (caps.has("hooks.email-transport:register")) (out.email ??= {}).transport = {};
	if (caps.has("hooks.page-fragments:register")) out.page = { fragments: {} };
	if (caps.has("users:read")) out.users = { read: {} };

	return out;
}

export function declaredAccessToCapabilities(declaredAccess: DeclaredAccess): {
	capabilities: PluginCapability[];
	allowedHosts: string[];
} {
	const caps = new Set<PluginCapability>();
	let allowedHosts: string[] = [];

	if (declaredAccess.content?.read) caps.add("content:read");
	if (declaredAccess.content?.write) {
		caps.add("content:write");
		caps.add("content:read");
	}
	if (declaredAccess.taxonomies?.read) caps.add("taxonomies:read");
	if (declaredAccess.media?.read) caps.add("media:read");
	if (declaredAccess.media?.write) {
		caps.add("media:write");
		caps.add("media:read");
	}
	if (declaredAccess.network?.request) {
		const hosts = declaredAccess.network.request.allowedHosts;
		if (hosts === undefined) {
			caps.add("network:request:unrestricted");
			caps.add("network:request");
		} else {
			caps.add("network:request");
			allowedHosts = [...hosts];
		}
	}
	if (declaredAccess.email?.send) caps.add("email:send");
	if (declaredAccess.email?.events) caps.add("hooks.email-events:register");
	if (declaredAccess.email?.transport) caps.add("hooks.email-transport:register");
	if (declaredAccess.page?.fragments) caps.add("hooks.page-fragments:register");
	if (declaredAccess.users?.read) caps.add("users:read");

	return { capabilities: [...caps], allowedHosts };
}

export interface ManifestHookEntry {
	name: string;
	exclusive?: boolean;
	priority?: number;
	timeout?: number;
}

export interface ManifestRouteEntry {
	name: string;
	public?: boolean;
	permission?: string;
	cacheControl?: string;
}

export type PluginJsonSchema = Record<string, unknown>;

export interface ManifestMcpTool {
	name: string;
	description: string;
	route: string;
	permission: string;
	destructive: boolean;
	inputSchema: PluginJsonSchema;
	outputSchema?: PluginJsonSchema;
}

export interface PluginMcpManifestConfig {
	tools: ManifestMcpTool[];
}

export interface StorageCollectionConfig {
	indexes: Array<string | string[]>;
	uniqueIndexes?: Array<string | string[]>;
}

export type PluginStorageConfig = Record<string, StorageCollectionConfig>;

export interface PluginAdminConfig {
	settingsSchema?: unknown;
	pages?: Array<unknown>;
	widgets?: Array<unknown>;
	entry?: string;
	portableTextBlocks?: Array<unknown>;
}

export interface PluginManifest {
	id: string;
	version: string;
	declaredAccess?: DeclaredAccess;
	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: PluginStorageConfig;
	hooks: Array<ManifestHookEntry | string>;
	routes: Array<ManifestRouteEntry | string>;
	mcp?: PluginMcpManifestConfig;
	admin: PluginAdminConfig;
}

const SLASH_RE = /\//g;
const LEADING_AT_RE = /^@/;

export const PLUGIN_SLUG_RE = /^[a-z][a-z0-9_-]*$/;
export const PLUGIN_SLUG_MAX_LENGTH = 64;

export const PLUGIN_VERSION_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
export const PLUGIN_VERSION_MAX_LENGTH = 64;

export function deriveSlugFromId(id: string): string {
	return id.replace(LEADING_AT_RE, "").replace(SLASH_RE, "-");
}

export function isPluginSlug(value: string): boolean {
	return value.length > 0 && value.length <= PLUGIN_SLUG_MAX_LENGTH && PLUGIN_SLUG_RE.test(value);
}

export function isPluginVersion(value: string): boolean {
	return (
		value.length > 0 && value.length <= PLUGIN_VERSION_MAX_LENGTH && PLUGIN_VERSION_RE.test(value)
	);
}

export {
	CURRENT_PLUGIN_CAPABILITIES,
	DEPRECATED_PLUGIN_CAPABILITIES,
	HOOK_NAMES,
	normalizeManifestHook,
	normalizeManifestRoute,
	PLUGIN_CAPABILITIES,
	pluginManifestSchema,
	reconcileManifestAccess,
} from "./manifest-schema.js";
export type { ValidatedPluginManifest } from "./manifest-schema.js";
export {
	canonicalizeDeclaredAccess,
	declaredAccessDigestInput,
	declaredAccessEqual,
	diffDeclaredAccess,
	isDeclaredAccessEscalation,
} from "./declared-access.js";
export type {
	AccessChange,
	AccessChangeKind,
	AccessDiff,
	CanonicalAccessConstraints,
	CanonicalDeclaredAccess,
	CanonicalJsonValue,
} from "./declared-access.js";
