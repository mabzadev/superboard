import { env, exports } from "cloudflare:workers";
import {
	createSandboxRouteError,
	getSandboxRouteErrorEnvelope,
	getI18nConfig,
	normalizeCapabilities,
	type SandboxRunner,
	type SandboxedPluginInstance,
	type SandboxEmailSendCallback,
	type SandboxOptions,
	type SandboxRunnerFactory,
	type SerializedRequest,
	type PluginManifest,
	type I18nConfig,
} from "emdash";

import { setEmailSendCallback } from "./bridge.js";
import type { WorkerLoader, WorkerStub, PluginBridgeBinding, WorkerLoaderLimits } from "./types.js";
import { generatePluginWrapper } from "./wrapper.js";

const DEFAULT_LIMITS = {
	cpuMs: 50,
	memoryMb: 128,
	subrequests: 10,
	wallTimeMs: 30_000,
} as const;

export interface PluginBridgeProps {
	pluginId: string;
	pluginVersion: string;
	capabilities: string[];
	allowedHosts: string[];
	storageCollections: string[];
	i18nConfig?: I18nConfig | null;
	storageConfig?: Record<
		string,
		{ indexes?: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> }
	>;
}

function getLoader(): WorkerLoader | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker Loader binding accessed from untyped env object
	return (env as Record<string, unknown>).LOADER as WorkerLoader | null;
}

function getPluginBridge(): ((opts: { props: PluginBridgeProps }) => PluginBridgeBinding) | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- PluginBridge accessed from untyped cloudflare:workers exports
	return (exports as Record<string, unknown>).PluginBridge as
		| ((opts: { props: PluginBridgeProps }) => PluginBridgeBinding)
		| null;
}

interface ResolvedLimits {
	cpuMs: number;
	memoryMb: number;
	subrequests: number;
	wallTimeMs: number;
}

function resolveLimits(limits?: SandboxOptions["limits"]): ResolvedLimits {
	return {
		cpuMs: limits?.cpuMs ?? DEFAULT_LIMITS.cpuMs,
		memoryMb: limits?.memoryMb ?? DEFAULT_LIMITS.memoryMb,
		subrequests: limits?.subrequests ?? DEFAULT_LIMITS.subrequests,
		wallTimeMs: limits?.wallTimeMs ?? DEFAULT_LIMITS.wallTimeMs,
	};
}

export class CloudflareSandboxRunner implements SandboxRunner {
	private plugins = new Map<string, CloudflareSandboxedPlugin>();
	private options: SandboxOptions;
	private resolvedLimits: ResolvedLimits;
	private siteInfo?: {
		name: string;
		url: string;
		locale: string;
		trailingSlash?: "always" | "never" | "ignore";
	};

	constructor(options: SandboxOptions) {
		this.options = options;
		this.resolvedLimits = resolveLimits(options.limits);
		this.siteInfo = options.siteInfo;

		setEmailSendCallback(options.emailSend ?? null);
	}

	setEmailSend(callback: SandboxEmailSendCallback | null): void {
		setEmailSendCallback(callback);
	}

	isAvailable(): boolean {
		return !!getLoader() && !!getPluginBridge();
	}

	isHealthy(): boolean {
		return this.isAvailable();
	}

	async load(manifest: PluginManifest, code: string): Promise<SandboxedPluginInstance> {
		const pluginId = `${manifest.id}:${manifest.version}`;

		const existing = this.plugins.get(pluginId);
		if (existing) return existing;

		const loader = getLoader();
		const pluginBridge = getPluginBridge();

		if (!loader) {
			throw new Error(
				"Worker Loader not available. Add worker_loaders binding to wrangler config.",
			);
		}

		if (!pluginBridge) {
			throw new Error(
				"PluginBridge not available. Export PluginBridge from your worker entrypoint.",
			);
		}

		const plugin = new CloudflareSandboxedPlugin(
			manifest,
			code,
			loader,
			pluginBridge,
			this.resolvedLimits,
			this.siteInfo,
		);

		this.plugins.set(pluginId, plugin);
		return plugin;
	}

	async terminateAll(): Promise<void> {
		for (const plugin of this.plugins.values()) {
			await plugin.terminate();
		}
		this.plugins.clear();
	}
}

class CloudflareSandboxedPlugin implements SandboxedPluginInstance {
	readonly id: string;
	readonly manifest: PluginManifest;
	private loader: WorkerLoader;
	private createBridge: (opts: { props: PluginBridgeProps }) => PluginBridgeBinding;
	private code: string;
	private wrapperCode: string | null = null;
	private limits: ResolvedLimits;
	private siteInfo?: {
		name: string;
		url: string;
		locale: string;
		trailingSlash?: "always" | "never" | "ignore";
	};

	constructor(
		manifest: PluginManifest,
		code: string,
		loader: WorkerLoader,
		createBridge: (opts: { props: PluginBridgeProps }) => PluginBridgeBinding,
		limits: ResolvedLimits,
		siteInfo?: {
			name: string;
			url: string;
			locale: string;
			trailingSlash?: "always" | "never" | "ignore";
		},
	) {
		this.id = `${manifest.id}:${manifest.version}`;
		this.manifest = manifest;
		this.code = code;
		this.loader = loader;
		this.createBridge = createBridge;
		this.limits = limits;
		this.siteInfo = siteInfo;
	}

	private createWorker(): WorkerStub {
		if (!this.wrapperCode) {
			this.wrapperCode = generatePluginWrapper(this.manifest, {
				site: this.siteInfo,
			});
		}

		const bridgeBinding = this.createBridge({
			props: {
				pluginId: this.manifest.id,
				pluginVersion: this.manifest.version || "0.0.0",
				capabilities: normalizeCapabilities(this.manifest.capabilities || []),
				allowedHosts: this.manifest.allowedHosts || [],
				storageCollections: Object.keys(this.manifest.storage || {}),
				i18nConfig: getI18nConfig(),
				storageConfig: this.manifest.storage,
			},
		});

		const loaderLimits: WorkerLoaderLimits = {
			cpuMs: this.limits.cpuMs,
			subRequests: this.limits.subrequests,
		};

		return this.loader.get(this.id, () => ({
			compatibilityDate: "2026-04-01",
			mainModule: "plugin.js",
			modules: {
				"plugin.js": { js: this.wrapperCode! },
				"sandbox-plugin.js": { js: this.code },
			},
			globalOutbound: null,
			limits: loaderLimits,
			env: {
				PLUGIN_ID: this.manifest.id,
				PLUGIN_VERSION: this.manifest.version || "0.0.0",
				BRIDGE: bridgeBinding,
			},
		}));
	}

	private async withWallTimeLimit<T>(operation: string, fn: () => Promise<T>): Promise<T> {
		const wallTimeMs = this.limits.wallTimeMs;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => {
				reject(
					new Error(
						`Plugin ${this.manifest.id} exceeded wall-time limit of ${wallTimeMs}ms during ${operation}`,
					),
				);
			}, wallTimeMs);
		});

		try {
			return await Promise.race([fn(), timeout]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	async invokeHook(hookName: string, event: unknown): Promise<unknown> {
		return this.withWallTimeLimit(`hook:${hookName}`, () => {
			const worker = this.createWorker();
			const entrypoint = worker.getEntrypoint<PluginEntrypoint>("default");
			return entrypoint.invokeHook(hookName, event);
		});
	}

	async invokeRoute(
		routeName: string,
		input: unknown,
		request: SerializedRequest,
	): Promise<unknown> {
		return this.withWallTimeLimit(`route:${routeName}`, async () => {
			const worker = this.createWorker();
			const entrypoint = worker.getEntrypoint<PluginEntrypoint>("default");
			const result = await entrypoint.invokeRoute(routeName, input, request);
			const envelope = getSandboxRouteErrorEnvelope(result);
			if (envelope) throw createSandboxRouteError(envelope.error.code);
			return result;
		});
	}

	async terminate(): Promise<void> {
		this.wrapperCode = null;
	}
}

interface PluginEntrypoint {
	invokeHook(hookName: string, event: unknown): Promise<unknown>;
	invokeRoute(routeName: string, input: unknown, request: SerializedRequest): Promise<unknown>;
}

export const createSandboxRunner: SandboxRunnerFactory = (options) => {
	return new CloudflareSandboxRunner(options);
};
