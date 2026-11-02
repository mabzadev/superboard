import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import type {
	SandboxRunner,
	SandboxedPluginInstance,
	SandboxEmailSendCallback,
	SandboxOptions,
	SerializedRequest,
} from "emdash";
import { createSandboxRouteError, getI18nConfig, getSandboxRouteErrorEnvelope } from "emdash";

const DEFAULT_WALL_TIME_MS = 30_000;
import type { PluginManifest } from "emdash";

import { createBridgeHandler } from "./bridge-handler.js";
import { generatePluginWrapper } from "./wrapper.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SAFE_ID_RE = /[^a-z0-9_-]/gi;

const EMDASH_SHIM = "export const definePlugin = (d) => d;\n";

export class MiniflareDevRunner implements SandboxRunner {
	private options: SandboxOptions;
	private siteInfo?: {
		name: string;
		url: string;
		locale: string;
		trailingSlash?: "always" | "never" | "ignore";
	};
	private emailSendCallback: SandboxEmailSendCallback | null = null;

	private mf: InstanceType<typeof import("miniflare").Miniflare> | null = null;

	private plugins = new Map<string, { manifest: PluginManifest; code: string }>();

	private running = false;

	private devInvokeToken: string;

	constructor(options: SandboxOptions) {
		this.options = options;
		this.siteInfo = options.siteInfo;
		this.emailSendCallback = options.emailSend ?? null;
		this.devInvokeToken = randomBytes(32).toString("hex");
	}

	get wallTimeMs(): number {
		return this.options.limits?.wallTimeMs ?? DEFAULT_WALL_TIME_MS;
	}

	get invokeAuthToken() {
		return this.devInvokeToken;
	}

	isAvailable(): boolean {
		try {
			const esmRequire = createRequire(import.meta.url);
			esmRequire.resolve("miniflare");
			return true;
		} catch {
			return false;
		}
	}

	isHealthy(): boolean {
		return this.running;
	}

	setEmailSend(callback: SandboxEmailSendCallback | null): void {
		this.emailSendCallback = callback;
	}

	async load(manifest: PluginManifest, code: string): Promise<SandboxedPluginInstance> {
		const pluginId = `${manifest.id}:${manifest.version}`;
		this.plugins.set(pluginId, { manifest, code });

		await this.rebuild();

		return new MiniflareDevPlugin(pluginId, manifest, this);
	}

	async terminateAll(): Promise<void> {
		if (this.mf) {
			await this.mf.dispose();
			this.mf = null;
		}
		this.plugins.clear();
		this.running = false;
	}

	async unloadPlugin(pluginId: string): Promise<void> {
		if (this.plugins.delete(pluginId)) {
			await this.rebuild();
		}
	}

	private async rebuild(): Promise<void> {
		if (this.mf) {
			await this.mf.dispose();
			this.mf = null;
		}

		if (this.plugins.size === 0) {
			this.running = false;
			return;
		}

		const { Miniflare } = await import("miniflare");

		const workerConfigs = [];

		for (const [pluginId, { manifest, code }] of this.plugins) {
			const bridgeHandler = createBridgeHandler({
				pluginId: manifest.id,
				version: manifest.version || "0.0.0",
				capabilities: manifest.capabilities || [],
				allowedHosts: manifest.allowedHosts || [],
				storageCollections: Object.keys(manifest.storage || {}),
				storageConfig: manifest.storage,
				i18nConfig: getI18nConfig(),
				db: this.options.db,
				beforeContentWrite: this.options.beforeContentWrite,
				emailSend: () => this.emailSendCallback,
				storage: this.options.mediaStorage,
			});

			const wrapperCode = generatePluginWrapper(manifest, {
				site: this.siteInfo,
				backingServiceUrl: "http://bridge",
				authToken: "dev-mode",
				invokeToken: this.devInvokeToken,
			});

			workerConfigs.push({
				name: pluginId.replace(SAFE_ID_RE, "_"),
				modulesRoot: "/",
				modules: [
					{ type: "ESModule" as const, path: "worker.js", contents: wrapperCode },
					{ type: "ESModule" as const, path: "sandbox-plugin.js", contents: code },
					{ type: "ESModule" as const, path: "emdash", contents: EMDASH_SHIM },
				],
				outboundService: async (request: Request) => {
					const url = new URL(request.url);
					if (url.hostname === "bridge") {
						return bridgeHandler(request);
					}
					return new Response(
						`Direct fetch() blocked in sandbox. Plugin "${manifest.id}" must use ctx.http.fetch() (requires network:fetch capability).`,
						{ status: 403 },
					);
				},
			});
		}

		this.mf = new Miniflare({ workers: workerConfigs });
		this.running = true;
	}

	async dispatchToPlugin(pluginId: string, url: string, init?: RequestInit): Promise<Response> {
		if (!this.mf) {
			throw new Error(`Miniflare not running, cannot dispatch to ${pluginId}`);
		}
		const workerName = pluginId.replace(SAFE_ID_RE, "_");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Miniflare's Request_2 value exposes fetch at runtime, and this boundary only accepts the shared subset documented above.
		const worker = (await this.mf.getWorker(workerName)) as unknown as {
			fetch(input: string, init?: never): Promise<Response>;
		};
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- miniflare's Response_2 / RequestInit_2 are structurally compatible with the global types we use here. See JSDoc above.
		return worker.fetch(url, init as never);
	}
}

class MiniflareDevPlugin implements SandboxedPluginInstance {
	readonly id: string;
	private manifest: PluginManifest;
	private runner: MiniflareDevRunner;

	constructor(id: string, manifest: PluginManifest, runner: MiniflareDevRunner) {
		this.id = id;
		this.manifest = manifest;
		this.runner = runner;
	}

	async invokeHook(hookName: string, event: unknown): Promise<unknown> {
		if (!this.runner.isHealthy()) {
			throw new Error(`Dev sandbox unavailable for ${this.id}`);
		}
		return this.withWallTimeLimit(`hook:${hookName}`, async () => {
			const res = await this.runner.dispatchToPlugin(this.id, `http://plugin/hook/${hookName}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.runner.invokeAuthToken}`,
				},
				body: JSON.stringify({ event }),
			});
			if (!res.ok) {
				const text = await res.text();
				throw new Error(`Plugin ${this.id} hook ${hookName} failed: ${text}`);
			}
			const result: unknown = await res.json();
			if (!isRecord(result)) {
				throw new Error(`Plugin ${this.id} hook ${hookName} returned a non-object response`);
			}
			return result.value;
		});
	}

	async invokeRoute(
		routeName: string,
		input: unknown,
		request: SerializedRequest,
	): Promise<unknown> {
		if (!this.runner.isHealthy()) {
			throw new Error(`Dev sandbox unavailable for ${this.id}`);
		}
		return this.withWallTimeLimit(`route:${routeName}`, async () => {
			const res = await this.runner.dispatchToPlugin(this.id, `http://plugin/route/${routeName}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.runner.invokeAuthToken}`,
				},
				body: JSON.stringify({ input, request }),
			});
			if (!res.ok) {
				const text = await res.text();
				let envelope = null;
				try {
					envelope = getSandboxRouteErrorEnvelope(JSON.parse(text));
				} catch {}
				if (envelope) {
					throw createSandboxRouteError(envelope.error.code);
				}
				throw new Error(`Plugin ${this.id} route ${routeName} failed: ${text}`);
			}
			return res.json();
		});
	}

	private async withWallTimeLimit<T>(operation: string, fn: () => Promise<T>): Promise<T> {
		const wallTimeMs = this.runner.wallTimeMs;
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

	async terminate(): Promise<void> {
		await this.runner.unloadPlugin(this.id);
	}
}
