import { normalizeCapabilities } from "./types.js";
import type {
	PluginDefinition,
	ResolvedPlugin,
	PluginHooks,
	ResolvedPluginHooks,
	ResolvedHook,
	HookConfig,
	PluginCapability,
	PluginStorageConfig,
} from "./types.js";

const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function definePlugin<TStorage extends PluginStorageConfig>(
	definition: PluginDefinition<TStorage>,
): ResolvedPlugin<TStorage> {
	if (typeof definition.id !== "string" || definition.id.length === 0) {
		throw new Error(
			`definePlugin() requires \`id\` (got ${typeof definition.id}). ` +
				"For native plugins, make sure your definition has both `id` and " +
				"`version`. For sandboxed plugins, drop `definePlugin()` entirely " +
				"and `export default { hooks, routes } satisfies SandboxedPlugin` " +
				'from "emdash/plugin" — identity comes from `emdash-plugin.jsonc`.',
		);
	}
	return defineNativePlugin(definition);
}

function defineNativePlugin<TStorage extends PluginStorageConfig>(
	definition: PluginDefinition<TStorage>,
): ResolvedPlugin<TStorage> {
	// oxlint-disable-next-line e18e/prefer-static-regex -- call-time on purpose (see #1370)
	const SIMPLE_ID = /^[a-z0-9-]+$/;
	// oxlint-disable-next-line e18e/prefer-static-regex -- call-time on purpose (see #1370)
	const SCOPED_ID = /^@[a-z0-9-]+\/[a-z0-9-]+$/;
	// oxlint-disable-next-line e18e/prefer-static-regex -- call-time on purpose (see #1370)
	const SEMVER_PATTERN = /^\d+\.\d+\.\d+/;

	const {
		id,
		version,
		capabilities = [],
		allowedHosts = [],
		hooks = {},
		routes = {},
		mcp = { tools: {} },
		admin = {},
	} = definition;

	const storage = (definition.storage ?? {}) as TStorage;

	if (!SIMPLE_ID.test(id) && !SCOPED_ID.test(id)) {
		throw new Error(
			`Invalid plugin id "${id}". Must be lowercase alphanumeric with dashes (e.g., "my-plugin" or "@scope/my-plugin").`,
		);
	}

	if (!SEMVER_PATTERN.test(version)) {
		throw new Error(`Invalid plugin version "${version}". Must be semver format (e.g., "1.0.0").`);
	}

	for (const [name, tool] of Object.entries(mcp.tools)) {
		if (!MCP_TOOL_NAME_PATTERN.test(name)) {
			throw new Error(`Invalid MCP tool name "${name}" in plugin "${id}".`);
		}
		const route = routes[tool.route];
		if (!route) throw new Error(`MCP tool "${name}" references unknown route "${tool.route}".`);
		if (route.public) throw new Error(`MCP tool "${name}" cannot reference a public route.`);
		if (!route.permission) {
			throw new Error(`MCP route "${tool.route}" must declare a permission.`);
		}
	}

	const validCapabilities = new Set<string>([
		"network:request",
		"network:request:unrestricted",
		"content:read",
		"content:write",
		"taxonomies:read",
		"media:read",
		"media:write",
		"users:read",
		"email:send",
		"hooks.email-transport:register",
		"hooks.email-events:register",
		"hooks.page-fragments:register",
		"network:fetch",
		"network:fetch:any",
		"read:content",
		"write:content",
		"read:media",
		"write:media",
		"read:users",
		"email:provide",
		"email:intercept",
		"page:inject",
	]);
	for (const cap of capabilities) {
		if (!validCapabilities.has(cap)) {
			throw new Error(`Invalid capability "${cap}" in plugin "${id}".`);
		}
	}

	const canonical = normalizeCapabilities(capabilities) as PluginCapability[];

	const normalizedCapabilities: PluginCapability[] = [...canonical];
	if (canonical.includes("content:write") && !canonical.includes("content:read")) {
		normalizedCapabilities.push("content:read");
	}
	if (canonical.includes("media:write") && !canonical.includes("media:read")) {
		normalizedCapabilities.push("media:read");
	}
	if (
		canonical.includes("network:request:unrestricted") &&
		!canonical.includes("network:request")
	) {
		normalizedCapabilities.push("network:request");
	}

	const resolvedHooks = resolveHooks(hooks, id);

	return {
		id,
		version,
		capabilities: normalizedCapabilities,
		allowedHosts,
		storage,
		hooks: resolvedHooks,
		routes,
		mcp,
		admin,
	};
}

function resolveHooks(hooks: PluginHooks, pluginId: string): ResolvedPluginHooks {
	const resolved: ResolvedPluginHooks = {};

	for (const key of Object.keys(hooks) as Array<keyof PluginHooks>) {
		const hook = hooks[key];
		if (hook) {
			(resolved as Record<string, unknown>)[key] = resolveHook(hook, pluginId);
		}
	}

	return resolved;
}

function isHookConfig<THandler>(
	hook: HookConfig<THandler> | THandler,
): hook is HookConfig<THandler> {
	return typeof hook === "object" && hook !== null && "handler" in hook;
}

function resolveHook<THandler>(
	hook: HookConfig<THandler> | THandler,
	pluginId: string,
): ResolvedHook<THandler> {
	if (isHookConfig(hook)) {
		if (hook.exclusive !== undefined && typeof hook.exclusive !== "boolean") {
			throw new Error(
				`Invalid "exclusive" value in hook config for plugin "${pluginId}". Must be boolean.`,
			);
		}
		return {
			priority: hook.priority ?? 100,
			timeout: hook.timeout ?? 5000,
			dependencies: hook.dependencies ?? [],
			errorPolicy: hook.errorPolicy ?? "abort",
			exclusive: hook.exclusive ?? false,
			handler: hook.handler,
			pluginId,
		};
	}

	return {
		priority: 100,
		timeout: 5000,
		dependencies: [],
		errorPolicy: "abort",
		exclusive: false,
		handler: hook,
		pluginId,
	};
}

export default definePlugin;
