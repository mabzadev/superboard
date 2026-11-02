import type { PluginDescriptor } from "../astro/integration/runtime.js";
import type { RouteEntry, RouteHandler, SandboxedPlugin } from "../plugin-types.js";
import { PLUGIN_CAPABILITIES, HOOK_NAMES } from "./manifest-schema.js";
import { normalizeCapabilities } from "./types.js";
import type {
	ResolvedPlugin,
	ResolvedPluginHooks,
	ResolvedHook,
	PluginRoute,
	PluginCapability,
	PluginStorageConfig,
	PluginAdminConfig,
} from "./types.js";

// eslint-disable-next-line typescript-eslint/no-explicit-any -- must accept handlers with specific event types across all hook names
type AnyHookHandler = (...args: any[]) => Promise<any>;
type AnyHookEntry =
	| AnyHookHandler
	| {
			handler: AnyHookHandler;
			priority?: number;
			timeout?: number;
			dependencies?: string[];
			errorPolicy?: "continue" | "abort";
			exclusive?: boolean;
	  };

const DEFAULT_PRIORITY = 100;
const DEFAULT_TIMEOUT = 5000;
const DEFAULT_ERROR_POLICY = "abort" as const;

function isHookConfig(entry: AnyHookEntry): entry is Exclude<AnyHookEntry, AnyHookHandler> {
	return typeof entry === "object" && entry !== null && "handler" in entry;
}

function resolveSandboxedHook(entry: AnyHookEntry, pluginId: string): ResolvedHook<AnyHookHandler> {
	if (isHookConfig(entry)) {
		return {
			priority: entry.priority ?? DEFAULT_PRIORITY,
			timeout: entry.timeout ?? DEFAULT_TIMEOUT,
			dependencies: entry.dependencies ?? [],
			errorPolicy: entry.errorPolicy ?? DEFAULT_ERROR_POLICY,
			exclusive: entry.exclusive ?? false,
			handler: entry.handler,
			pluginId,
		};
	}

	return {
		priority: DEFAULT_PRIORITY,
		timeout: DEFAULT_TIMEOUT,
		dependencies: [],
		errorPolicy: DEFAULT_ERROR_POLICY,
		exclusive: false,
		handler: entry,
		pluginId,
	};
}

function normalizeRouteEntry(entry: RouteEntry): {
	handler: RouteHandler;
	public?: boolean;
	cacheControl?: string;
	input?: PluginRoute["input"];
	permission?: PluginRoute["permission"];
} {
	if (typeof entry === "function") {
		return { handler: entry };
	}
	return {
		handler: entry.handler,
		public: entry.public,
		permission: entry.permission,
		cacheControl: entry.cacheControl,
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- RouteEntry.input is intentionally `unknown` (sandboxed plugins) and validated by the runtime at invocation time
		input: entry.input as PluginRoute["input"],
	};
}

const VALID_CAPABILITIES_SET = new Set<string>(PLUGIN_CAPABILITIES);

const VALID_HOOK_NAMES_SET = new Set<string>(HOOK_NAMES);

export function adaptSandboxEntry(
	definition: SandboxedPlugin,
	descriptor: PluginDescriptor,
): ResolvedPlugin {
	const pluginId = descriptor.id;
	const version = descriptor.version;

	if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
		throw new Error(
			`Plugin "${pluginId}" default export must be an object with ` +
				`\`hooks\` and/or \`routes\` (got ${
					Array.isArray(definition) ? "array" : typeof definition
				}). Did you forget \`export default {...} satisfies SandboxedPlugin\`?`,
		);
	}

	const resolvedHooks: ResolvedPluginHooks = {};
	if (definition.hooks) {
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- widening the strict mapped type to a string-keyed record for iteration; entries still match AnyHookEntry
		const hookMap = definition.hooks as Record<string, AnyHookEntry>;
		for (const [hookName, entry] of Object.entries(hookMap)) {
			if (!VALID_HOOK_NAMES_SET.has(hookName)) {
				throw new Error(
					`Plugin "${pluginId}" declares unknown hook "${hookName}". ` +
						`Valid hooks: ${[...VALID_HOOK_NAMES_SET].join(", ")}`,
				);
			}
			// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- bridging untyped map to typed interface
			(resolvedHooks as Record<string, unknown>)[hookName] = resolveSandboxedHook(entry, pluginId);
		}
	}

	const usesPublicRouteContext = "id" in definition && typeof definition.id === "string";
	const resolvedRoutes: Record<string, PluginRoute> = {};
	if (definition.routes) {
		for (const [routeName, rawEntry] of Object.entries(definition.routes)) {
			const normalized = normalizeRouteEntry(rawEntry);
			const {
				handler,
				public: publicFlag,
				cacheControl,
				input: inputSchema,
				permission,
			} = normalized;
			resolvedRoutes[routeName] = {
				input: inputSchema,
				public: publicFlag,
				permission,
				cacheControl,
				handler: async (ctx) => {
					if (usesPublicRouteContext) {
						// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- standard-format handlers are authored against the public single-arg PluginRoute contract; the sandbox RouteHandler type on `normalized` is the wider authoring union
						return (handler as unknown as PluginRoute["handler"])(ctx);
					}
					const headers: Record<string, string> = {};
					ctx.request.headers.forEach((value, name) => {
						headers[name] = value;
					});
					const requestShape = {
						url: ctx.request.url,
						method: ctx.request.method,
						headers,
					};
					const routeCtx = {
						input: ctx.input,
						request: requestShape,
						requestMeta: ctx.requestMeta,
						user: ctx.user,
					};
					const { input: _, request: __, requestMeta: ___, user: ____, ...pluginCtx } = ctx;
					return handler(routeCtx, pluginCtx);
				},
			};
		}
	}

	const rawCapabilities = descriptor.capabilities ?? [];
	for (const cap of rawCapabilities) {
		if (!VALID_CAPABILITIES_SET.has(cap)) {
			throw new Error(
				`Invalid capability "${cap}" in plugin "${pluginId}". ` +
					`Valid capabilities: ${[...VALID_CAPABILITIES_SET].join(", ")}`,
			);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated above; normalizeCapabilities only returns capabilities from the union
	const capabilities = normalizeCapabilities(rawCapabilities) as PluginCapability[];
	const allowedHosts = descriptor.allowedHosts ?? [];

	if (capabilities.includes("content:write") && !capabilities.includes("content:read")) {
		capabilities.push("content:read");
	}
	if (capabilities.includes("media:write") && !capabilities.includes("media:read")) {
		capabilities.push("media:read");
	}
	if (
		capabilities.includes("network:request:unrestricted") &&
		!capabilities.includes("network:request")
	) {
		capabilities.push("network:request");
	}

	const rawStorage = descriptor.storage ?? {};
	const storage: PluginStorageConfig = {};
	for (const [name, config] of Object.entries(rawStorage)) {
		storage[name] = {
			indexes: config.indexes ?? [],
			uniqueIndexes: config.uniqueIndexes,
		};
	}

	const admin: PluginAdminConfig = {};
	if (descriptor.adminPages) {
		admin.pages = descriptor.adminPages;
	}
	if (descriptor.adminWidgets) {
		admin.widgets = descriptor.adminWidgets;
	}
	if (descriptor.settingsSchema) {
		admin.settingsSchema = descriptor.settingsSchema;
	}
	if (descriptor.portableTextBlocks) {
		admin.portableTextBlocks = descriptor.portableTextBlocks;
	}
	if (descriptor.fieldWidgets) {
		admin.fieldWidgets = descriptor.fieldWidgets;
	}

	return {
		id: pluginId,
		version,
		capabilities,
		allowedHosts,
		storage,
		hooks: resolvedHooks,
		routes: resolvedRoutes,
		mcp: {
			tools: Object.fromEntries(
				Object.entries(definition.mcp?.tools ?? {}).map(([name, tool]) => [
					name,
					{
						description: tool.description,
						route: tool.route,
						input: tool.input,
						output: tool.output,
						destructive: tool.destructive,
					},
				]),
			),
		},
		admin,
	};
}
