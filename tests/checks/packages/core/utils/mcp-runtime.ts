import type { RoleLevel } from "@emdash-cms/auth";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Kysely } from "kysely";

import type { EmDashConfig } from "../../../../../packages/core/src/astro/integration/runtime.js";
import type { EmDashHandlers } from "../../../../../packages/core/src/astro/types.js";
import type { Database } from "../../../../../packages/core/src/database/types.js";
import { EmDashRuntime } from "../../../../../packages/core/src/emdash-runtime.js";
import { createMcpServer } from "../../../../../packages/core/src/mcp/server.js";
import { createHookPipeline } from "../../../../../packages/core/src/plugins/hooks.js";
import type { ResolvedPlugin } from "../../../../../packages/core/src/plugins/types.js";
import { invalidateUrlPatternCache } from "../../../../../packages/core/src/query.js";

class AuthInjectingTransport extends InMemoryTransport {
	constructor(private authInfo: Record<string, unknown>) {
		super();
	}

	override async send(
		message: Parameters<InMemoryTransport["send"]>[0],
		options?: Parameters<InMemoryTransport["send"]>[1],
	): Promise<void> {
		const existingExtra =
			options?.authInfo && typeof options.authInfo === "object" && "extra" in options.authInfo
				? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by typeof + 'in' check
					(options.authInfo.extra as Record<string, unknown>)
				: {};
		return super.send(message, {
			...options,
			authInfo: {
				token: "",
				clientId: "test",
				scopes: [],
				...options?.authInfo,
				extra: {
					...this.authInfo,
					...existingExtra,
				},
			},
		});
	}
}

function createAuthenticatedPair(authInfo: {
	emdash: EmDashHandlers;
	userId: string;
	userRole: RoleLevel;
	tokenScopes?: string[];
}): [AuthInjectingTransport, InMemoryTransport] {
	const clientTransport = new AuthInjectingTransport(authInfo);
	const serverTransport = new InMemoryTransport();
	(clientTransport as unknown as Record<string, unknown>)._otherTransport = serverTransport;
	(serverTransport as unknown as Record<string, unknown>)._otherTransport = clientTransport;
	return [clientTransport, serverTransport];
}

export interface TestRuntimeOptions {
	plugins?: ResolvedPlugin[];
	config?: Partial<EmDashConfig>;
}

export function createTestRuntime(
	db: Kysely<Database>,
	opts: TestRuntimeOptions = {},
): EmDashRuntime {
	const plugins = opts.plugins ?? [];
	const config: EmDashConfig = { ...opts.config };

	const pipelineFactoryOptions = { db } as const;
	const hooks = createHookPipeline(plugins, pipelineFactoryOptions);
	const pipelineRef = { current: hooks };

	const runtimeDeps = {
		config,
		plugins,
		// eslint-disable-next-line typescript/no-explicit-any -- match RuntimeDependencies signature
		createDialect: (() => {
			throw new Error("createDialect not available in test runtime");
		}) as any,
		createStorage: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	};

	return new EmDashRuntime({
		db,
		storage: null,
		configuredPlugins: plugins,
		sandboxedPlugins: new Map(),
		sandboxedPluginEntries: [],
		hooks,
		enabledPlugins: new Set(plugins.map((p) => p.id)),
		pluginStates: new Map(),
		config,
		mediaProviders: new Map(),
		mediaProviderEntries: [],
		cronExecutor: null,
		cronScheduler: null,
		emailPipeline: null,
		allPipelinePlugins: plugins,
		pipelineFactoryOptions,
		runtimeDeps,
		pipelineRef,
	});
}

export function handlersFromRuntime(runtime: EmDashRuntime): EmDashHandlers {
	const handlers: EmDashHandlers = {
		handleContentList: runtime.handleContentList.bind(runtime),
		handleContentGet: runtime.handleContentGet.bind(runtime),
		handleContentGetIncludingTrashed: runtime.handleContentGetIncludingTrashed.bind(runtime),
		handleContentCreate: runtime.handleContentCreate.bind(runtime),
		handleContentUpdate: runtime.handleContentUpdate.bind(runtime),
		handleContentDelete: runtime.handleContentDelete.bind(runtime),
		handleContentDuplicate: runtime.handleContentDuplicate.bind(runtime),
		handleContentRestore: runtime.handleContentRestore.bind(runtime),
		handleContentPermanentDelete: runtime.handleContentPermanentDelete.bind(runtime),
		handleContentListTrashed: runtime.handleContentListTrashed.bind(runtime),
		handleContentCountTrashed: runtime.handleContentCountTrashed.bind(runtime),
		handleContentPublish: runtime.handleContentPublish.bind(runtime),
		handleContentUnpublish: runtime.handleContentUnpublish.bind(runtime),
		handleContentSchedule: runtime.handleContentSchedule.bind(runtime),
		handleContentUnschedule: runtime.handleContentUnschedule.bind(runtime),
		handleContentCountScheduled: runtime.handleContentCountScheduled.bind(runtime),
		handleContentDiscardDraft: runtime.handleContentDiscardDraft.bind(runtime),
		handleContentCompare: runtime.handleContentCompare.bind(runtime),
		handleContentTranslations: runtime.handleContentTranslations.bind(runtime),

		handleMediaList: runtime.handleMediaList.bind(runtime),
		handleMediaGet: runtime.handleMediaGet.bind(runtime),
		handleMediaCreate: runtime.handleMediaCreate.bind(runtime),
		handleMediaUpdate: runtime.handleMediaUpdate.bind(runtime),
		handleMediaDelete: runtime.handleMediaDelete.bind(runtime),

		handleRevisionList: runtime.handleRevisionList.bind(runtime),
		handleRevisionGet: runtime.handleRevisionGet.bind(runtime),
		handleRevisionRestore: runtime.handleRevisionRestore.bind(runtime),

		storage: runtime.storage,
		db: runtime.db,
		hooks: runtime.hooks,
		email: runtime.email,
		configuredPlugins: runtime.configuredPlugins,
		sandboxedPluginEntries: runtime.sandboxedPluginEntries,
		config: runtime.config,
		getManifest: runtime.getManifest.bind(runtime),
		invalidateUrlPatternCache,

		handlePluginApiRoute: () => {
			throw new Error("handlePluginApiRoute not implemented in test runtime");
		},
		handlePublicPluginApiRoute: () => {
			throw new Error("handlePublicPluginApiRoute not implemented in test runtime");
		},
		getPluginRouteMeta: () => null,
		getMediaProvider: runtime.getMediaProvider.bind(runtime),
		getMediaProviderList: runtime.getMediaProviderList.bind(runtime),
		getSandboxRunner: runtime.getSandboxRunner.bind(runtime),
		syncMarketplacePlugins: () => Promise.resolve(),
		setPluginStatus: runtime.setPluginStatus.bind(runtime),
		collectPageMetadata: runtime.collectPageMetadata.bind(runtime),
		collectPageFragments: runtime.collectPageFragments.bind(runtime),
		ensureSearchHealthy: runtime.ensureSearchHealthy.bind(runtime),
	};
	return handlers;
}

export interface McpHarness {
	client: Client;
	runtime: EmDashRuntime;
	handlers: EmDashHandlers;
	cleanup: () => Promise<void>;
}

export interface ConnectMcpOptions {
	db: Kysely<Database>;
	userId: string;
	userRole: RoleLevel;
	tokenScopes?: string[];
	runtimeOptions?: TestRuntimeOptions;
}

export async function connectMcpHarness(opts: ConnectMcpOptions): Promise<McpHarness> {
	const runtime = createTestRuntime(opts.db, opts.runtimeOptions);
	const handlers = handlersFromRuntime(runtime);

	const server = createMcpServer();
	const [clientTransport, serverTransport] = createAuthenticatedPair({
		emdash: handlers,
		userId: opts.userId,
		userRole: opts.userRole,
		tokenScopes: opts.tokenScopes,
	});

	const client = new Client({ name: "test", version: "1.0" });

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return {
		client,
		runtime,
		handlers,
		cleanup: async () => {
			await client.close();
			await server.close();
		},
	};
}

interface ToolResult {
	content?: Array<{ type: string; text?: string }>;
	isError?: boolean;
	[key: string]: unknown;
}

export function extractText(result: unknown): string {
	const r = result as ToolResult;
	const block = r.content?.[0];
	return typeof block?.text === "string" ? block.text : "";
}

export function extractJson<T = unknown>(result: unknown): T {
	const r = result as ToolResult;
	if (r.isError) {
		throw new Error(`Expected success but got error: ${extractText(result)}`);
	}
	const text = extractText(result);
	if (!text) {
		throw new Error("Tool result had no text content");
	}
	return JSON.parse(text) as T;
}

export function isErrorResult(result: unknown): boolean {
	return (result as ToolResult).isError === true;
}
