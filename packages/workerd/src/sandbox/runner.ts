import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	SandboxRunner,
	SandboxedPluginInstance,
	SandboxEmailSendCallback,
	SandboxOptions,
	SandboxRunnerFactory,
	SerializedRequest,
} from "emdash";
import type { PluginManifest } from "emdash";
// @ts-ignore -- SandboxUnavailableError is a class export, not type-only
import {
	createSandboxRouteError,
	getSandboxRouteErrorEnvelope,
	SandboxUnavailableError,
} from "emdash";

import { createBackingServiceHandler } from "./backing-service.js";
import type { BackingServiceHandler } from "./backing-service.js";
import { generateCapnpConfig } from "./capnp.js";
import { MiniflareDevRunner } from "./dev-runner.js";
import { generatePluginWrapper } from "./wrapper.js";

const SAFE_ID_RE = /[^a-z0-9_-]/gi;

const EMDASH_SHIM = "export const definePlugin = (d) => d;\n";
const EMDASH_SHIM_FILE = "emdash-shim.js";

export function minimalWorkerdEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	const ALLOW = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];
	for (const k of ALLOW) {
		const v = process.env[k];
		if (v !== undefined) env[k] = v;
	}
	const passthrough = process.env.EMDASH_WORKERD_PASSTHROUGH_ENV;
	if (passthrough) {
		for (const k of passthrough.split(",")) {
			const trimmed = k.trim();
			if (!trimmed) continue;
			const v = process.env[trimmed];
			if (v !== undefined) env[trimmed] = v;
		}
	}
	return env;
}

const USE_UNIX_SOCKET = process.platform !== "win32";

const PLUGIN_PORT_BLOCK_SIZE = 128;
const PLUGIN_PORT_BLOCK_COUNT = 200;
const PROCESS_PLUGIN_PORT_BASE =
	18_788 + (process.pid % PLUGIN_PORT_BLOCK_COUNT) * PLUGIN_PORT_BLOCK_SIZE;

async function findAvailablePluginPort(start: number): Promise<number> {
	for (let port = start; port <= 65_535; port += 1) {
		if (await canBindPluginPort(port)) return port;
	}
	throw new Error("No TCP port is available for a workerd plugin listener");
}

function canBindPluginPort(port: number): Promise<boolean> {
	return new Promise((resolveAvailability) => {
		const probe = createServer();
		probe.unref();
		probe.once("error", () => resolveAvailability(false));
		probe.listen(port, "127.0.0.1", () => {
			probe.close(() => resolveAvailability(true));
		});
	});
}

const activeRunners = new Set<WorkerdSandboxRunner>();
let sigHandlerRegistered = false;

function registerSigHandler(runner: WorkerdSandboxRunner): void {
	activeRunners.add(runner);
	if (!sigHandlerRegistered) {
		sigHandlerRegistered = true;
		process.on("SIGTERM", () => {
			for (const r of activeRunners) {
				r["shuttingDown"] = true;
				void r.terminateAll();
			}
		});
	}
}

function unregisterSigHandler(runner: WorkerdSandboxRunner): void {
	activeRunners.delete(runner);
}

const DEFAULT_LIMITS = {
	cpuMs: 50,
	memoryMb: 128,
	subrequests: 10,
	wallTimeMs: 30_000,
} as const;

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

interface LoadedPlugin {
	manifest: PluginManifest;
	code: string;
	port: number;
	token: string;
}

export async function probeAllReady(
	plugins: Iterable<{ port: number }>,
	invokeToken: string,
	perProbeTimeoutMs = 1000,
): Promise<boolean> {
	const targets = [...plugins];
	if (targets.length === 0) return true;
	const checks = targets.map((p) =>
		fetch(`http://127.0.0.1:${p.port}/__ready`, {
			signal: AbortSignal.timeout(perProbeTimeoutMs),
			headers: { Authorization: `Bearer ${invokeToken}` },
		})
			.then((r) => r.ok)
			.catch(() => false),
	);
	const results = await Promise.all(checks);
	return results.every(Boolean);
}

export type ExitHandlerHost = {
	workerdProcess: ChildProcess | null;
	healthy: boolean;
	shuttingDown: boolean;
	intentionalStop: boolean;
	scheduleRestart(): void;
};

export function makeWorkerdExitHandler(
	host: ExitHandlerHost,
	proc: ChildProcess,
): (code: number | null, signal: NodeJS.Signals | null) => void {
	return (code, signal) => {
		if (host.workerdProcess !== proc) return;
		host.healthy = false;
		host.workerdProcess = null;
		if (host.shuttingDown) return;
		if (host.intentionalStop) {
			host.intentionalStop = false;
			return;
		}
		if ((code !== 0 && code !== null) || signal) {
			const reason = signal ? `signal ${signal}` : `code ${code}`;
			console.error(`[emdash:workerd] workerd exited with ${reason}`);
			host.scheduleRestart();
		}
	};
}

export function waitForProcessExit(proc: ChildProcess, timeoutMs = 5000): Promise<void> {
	let killTimer: ReturnType<typeof setTimeout> | null = null;
	const exitPromise = new Promise<void>((resolve) => {
		proc.once("exit", () => {
			if (killTimer !== null) {
				clearTimeout(killTimer);
				killTimer = null;
			}
			resolve();
		});
	});
	proc.kill("SIGTERM");
	killTimer = setTimeout(() => {
		killTimer = null;
		if (proc.exitCode === null) proc.kill("SIGKILL");
	}, timeoutMs);
	return exitPromise;
}

export interface PluginTokenClaims {
	pluginId: string;
	version: string;
	capabilities: string[];
	allowedHosts: string[];
	storageCollections: string[];
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTokenClaims(value: unknown): value is PluginTokenClaims {
	if (!isRecord(value)) return false;
	return (
		typeof value.pluginId === "string" &&
		typeof value.version === "string" &&
		isStringArray(value.capabilities) &&
		isStringArray(value.allowedHosts) &&
		isStringArray(value.storageCollections)
	);
}

export class WorkerdSandboxRunner implements SandboxRunner {
	private options: SandboxOptions;
	private limits: ResolvedLimits;
	private siteInfo?: {
		name: string;
		url: string;
		locale: string;
		trailingSlash?: "always" | "never" | "ignore";
	};

	private plugins = new Map<string, LoadedPlugin>();

	private backingServer: Server | null = null;
	private backingPort = 0;
	private backingService: BackingServiceHandler | null = null;
	private backingSocketPath: string | null = null;
	private eagerStartTimer: ReturnType<typeof setTimeout> | null = null;

	private workerdProcess: ChildProcess | null = null;

	private masterSecret = randomBytes(32).toString("hex");

	private invokeToken = randomBytes(32).toString("hex");

	private configDir: string | null = null;

	private emailSendCallback: SandboxEmailSendCallback | null = null;

	private epoch = 0;

	private nextPluginPort = PROCESS_PLUGIN_PORT_BASE;

	private freePorts: number[] = [];

	private healthy = false;

	private needsRestart = false;

	private startupPromise: Promise<void> | null = null;

	private crashCount = 0;
	private crashWindowStart = 0;
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private shuttingDown = false;

	private intentionalStop = false;

	constructor(options: SandboxOptions) {
		this.options = options;
		this.limits = resolveLimits(options.limits);
		this.siteInfo = options.siteInfo;
		this.emailSendCallback = options.emailSend ?? null;

		if (
			options.limits &&
			(options.limits.cpuMs !== undefined ||
				options.limits.memoryMb !== undefined ||
				options.limits.subrequests !== undefined)
		) {
			console.warn(
				"[emdash:workerd] cpuMs, memoryMb, and subrequests limits are not enforced " +
					"by standalone workerd. Only wallTimeMs is enforced on the Node path. " +
					"For full resource isolation, deploy on Cloudflare Workers.",
			);
		}

		registerSigHandler(this);
	}

	isAvailable(): boolean {
		try {
			const bin = this.resolveWorkerdBinary();
			execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 5000 });
			return true;
		} catch {
			return false;
		}
	}

	private resolveWorkerdBinary(): string {
		try {
			const esmRequire = createRequire(import.meta.url);
			const workerdMain = esmRequire.resolve("workerd");
			const pkgDir = join(workerdMain, "..", "..");
			const binName = process.platform === "win32" ? "workerd.exe" : "workerd";
			return join(pkgDir, "bin", binName);
		} catch {
			return "workerd";
		}
	}

	isHealthy(): boolean {
		if (this.needsRestart) return false;
		return this.healthy && this.workerdProcess !== null && !this.workerdProcess.killed;
	}

	async ensureRunning(): Promise<void> {
		if (this.startupPromise) {
			await this.startupPromise;
			return;
		}
		if (!this.needsRestart) return;

		this.startupPromise = this.restart();
		try {
			await this.startupPromise;
			this.needsRestart = false;
		} finally {
			this.startupPromise = null;
		}
	}

	setEmailSend(callback: SandboxEmailSendCallback | null): void {
		this.emailSendCallback = callback;
	}

	async load(manifest: PluginManifest, code: string): Promise<SandboxedPluginInstance> {
		const pluginId = `${manifest.id}:${manifest.version}`;

		const existing = this.plugins.get(pluginId);
		if (existing) {
			return new WorkerdSandboxedPlugin(pluginId, manifest, existing.port, this.limits, this);
		}

		const preferredPort = this.freePorts.pop() ?? this.nextPluginPort;
		const port = await findAvailablePluginPort(preferredPort);
		this.nextPluginPort = Math.max(this.nextPluginPort, port + 1);
		const token = this.generatePluginToken(manifest);

		this.plugins.set(pluginId, { manifest, code, port, token });

		this.needsRestart = true;
		this.scheduleEagerStart();

		return new WorkerdSandboxedPlugin(pluginId, manifest, port, this.limits, this);
	}

	unloadPlugin(pluginId: string): void {
		const entry = this.plugins.get(pluginId);
		if (!entry) return;
		this.plugins.delete(pluginId);
		this.freePorts.push(entry.port);
		this.backingService?.removePlugin(pluginId);
		if (this.plugins.size === 0) {
			void this.stopWorkerd();
		} else {
			this.needsRestart = true;
			this.scheduleEagerStart();
		}
	}

	private scheduleEagerStart(): void {
		if (this.eagerStartTimer) clearTimeout(this.eagerStartTimer);
		this.eagerStartTimer = setTimeout(() => {
			this.eagerStartTimer = null;
			this.ensureRunning().catch((err) => {
				console.error("[emdash:workerd] eager start failed:", err);
				this.scheduleRestart();
			});
		}, 50);
	}

	async terminateAll(): Promise<void> {
		this.shuttingDown = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}
		if (this.eagerStartTimer) {
			clearTimeout(this.eagerStartTimer);
			this.eagerStartTimer = null;
		}
		unregisterSigHandler(this);
		this.plugins.clear();
		await this.stopWorkerd();
		await this.stopBackingServer();
		if (this.configDir) {
			await rm(this.configDir, { recursive: true, force: true }).catch(() => {});
			this.configDir = null;
		}
	}

	private scheduleRestart(): void {
		if (this.shuttingDown || this.plugins.size === 0) return;

		const now = Date.now();

		if (now - this.crashWindowStart > 60_000) {
			this.crashCount = 0;
			this.crashWindowStart = now;
		}

		this.crashCount++;

		if (this.crashCount > 5) {
			console.error(
				"[emdash:workerd] workerd crashed 5 times in 60 seconds, giving up. " +
					"Plugins will run unsandboxed. Restart the server to retry.",
			);
			return;
		}

		const delayMs = Math.min(1000 * 2 ** (this.crashCount - 1), 30_000);
		console.warn(`[emdash:workerd] restarting in ${delayMs}ms (attempt ${this.crashCount}/5)`);

		this.restartTimer = setTimeout(() => {
			this.restartTimer = null;
			this.needsRestart = true;
		}, delayMs);
	}

	private generatePluginToken(manifest: PluginManifest): string {
		const payload = JSON.stringify({
			pluginId: manifest.id,
			version: manifest.version,
			capabilities: manifest.capabilities || [],
			allowedHosts: manifest.allowedHosts || [],
			storageCollections: Object.keys(manifest.storage || {}),
		});
		const payloadB64 = Buffer.from(payload).toString("base64url");
		const hmac = createHmac("sha256", this.masterSecret).update(payload).digest("base64url");
		return `${payloadB64}.${hmac}`;
	}

	validateToken(token: string): {
		pluginId: string;
		version: string;
		capabilities: string[];
		allowedHosts: string[];
		storageCollections: string[];
	} | null {
		const parts = token.split(".");
		if (parts.length !== 2) return null;

		const [payloadB64, hmacB64] = parts;
		if (!payloadB64 || !hmacB64) return null;

		const payload = Buffer.from(payloadB64, "base64url").toString();
		const expectedHmac = createHmac("sha256", this.masterSecret)
			.update(payload)
			.digest("base64url");

		const a = Buffer.from(hmacB64);
		const b = Buffer.from(expectedHmac);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			return null;
		}
		if (!isTokenClaims(parsed)) return null;
		return parsed;
	}

	private async restart(): Promise<void> {
		await this.stopWorkerd();

		if (!this.backingServer) {
			await this.startBackingServer();
		}

		if (!this.configDir) {
			this.configDir = join(tmpdir(), `emdash-workerd-${process.pid}-${Date.now()}`);
			await mkdir(this.configDir, { recursive: true });
		}

		await writeFile(join(this.configDir, EMDASH_SHIM_FILE), EMDASH_SHIM);

		for (const [pluginId, plugin] of this.plugins) {
			const safeId = pluginId.replace(SAFE_ID_RE, "_");
			const wrapperCode = generatePluginWrapper(plugin.manifest, {
				site: this.siteInfo,
				backingServiceUrl: this.backingServiceUrl,
				authToken: plugin.token,
				invokeToken: this.invokeToken,
			});
			await writeFile(join(this.configDir, `${safeId}-wrapper.js`), wrapperCode);
			await writeFile(join(this.configDir, `${safeId}-plugin.js`), plugin.code);
		}

		const capnpConfig = generateCapnpConfig({
			plugins: this.plugins,
			backingServiceAddress: this.backingServiceAddress,
			configDir: this.configDir,
			emdashShimFile: EMDASH_SHIM_FILE,
		});

		const configPath = join(this.configDir, "workerd.capnp");
		await writeFile(configPath, capnpConfig);

		const workerdBin = this.resolveWorkerdBinary();
		const proc = spawn(workerdBin, ["serve", configPath], {
			stdio: ["ignore", "pipe", "pipe"],
			env: minimalWorkerdEnv(),
		});
		this.workerdProcess = proc;

		this.epoch++;

		proc.stdout?.on("data", (chunk: Buffer) => {
			process.stdout.write(`[emdash:workerd] ${chunk.toString()}`);
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			process.stderr.write(`[emdash:workerd] ${chunk.toString()}`);
		});

		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- runner satisfies ExitHandlerHost structurally; cast bypasses TS's nominal handling of private members
		proc.on("exit", makeWorkerdExitHandler(this as unknown as ExitHandlerHost, proc));

		await this.waitForReady();
		this.healthy = true;
	}

	private async waitForReady(): Promise<void> {
		const startTime = Date.now();
		const timeout = 10_000;

		if (this.plugins.size === 0) {
			this.healthy = true;
			return;
		}

		while (Date.now() - startTime < timeout) {
			if (await probeAllReady(this.plugins.values(), this.invokeToken)) {
				return;
			}
			await new Promise((r) => setTimeout(r, 100));
		}

		throw new Error("[emdash:workerd] workerd failed to start within 10 seconds");
	}

	private async stopWorkerd(): Promise<void> {
		if (!this.workerdProcess) return;
		this.healthy = false;
		this.intentionalStop = true;

		const proc = this.workerdProcess;
		this.workerdProcess = null;

		if (proc.exitCode !== null) {
			return;
		}

		return waitForProcessExit(proc);
	}

	private async startBackingServer(): Promise<void> {
		this.backingService = createBackingServiceHandler(this);

		return new Promise((resolve, reject) => {
			this.backingServer = createServer(this.backingService!.handler);

			if (USE_UNIX_SOCKET) {
				const socketPath = join(tmpdir(), `emdash-sandbox-${process.pid}-${Date.now()}.sock`);
				this.backingSocketPath = socketPath;
				this.backingServer.listen(socketPath, () => {
					resolve();
				});
			} else {
				this.backingServer.listen(0, "127.0.0.1", () => {
					const addr = this.backingServer!.address();
					if (addr && typeof addr === "object") {
						this.backingPort = addr.port;
					}
					resolve();
				});
			}

			this.backingServer.on("error", reject);
		});
	}

	get backingServiceAddress(): string {
		if (USE_UNIX_SOCKET && this.backingSocketPath) {
			return `unix:${this.backingSocketPath}`;
		}
		return `127.0.0.1:${this.backingPort}`;
	}

	get backingServiceUrl(): string {
		if (USE_UNIX_SOCKET && this.backingSocketPath) {
			return "http://emdash-backing";
		}
		return `http://127.0.0.1:${this.backingPort}`;
	}

	private async stopBackingServer(): Promise<void> {
		if (!this.backingServer) return;
		const socketPath = this.backingSocketPath;
		return new Promise<void>((resolve) => {
			this.backingServer!.close(() => {
				if (socketPath) {
					unlink(socketPath).catch(() => {});
					this.backingSocketPath = null;
				}
				resolve();
			});
			this.backingServer = null;
		});
	}

	get db() {
		return this.options.db;
	}

	get beforeContentWrite() {
		return this.options.beforeContentWrite;
	}

	get emailSend() {
		return this.emailSendCallback;
	}

	get mediaStorage() {
		return this.options.mediaStorage ?? null;
	}

	get invokeAuthToken() {
		return this.invokeToken;
	}

	getPluginStorageConfig(pluginId: string, version: string): PluginManifest["storage"] | undefined {
		const plugin = this.plugins.get(`${pluginId}:${version}`);
		if (plugin) {
			return plugin.manifest.storage;
		}
		return undefined;
	}

	get currentEpoch() {
		return this.epoch;
	}
}

class WorkerdSandboxedPlugin implements SandboxedPluginInstance {
	readonly id: string;
	private manifest: PluginManifest;
	private port: number;
	private limits: ResolvedLimits;
	private runner: WorkerdSandboxRunner;
	constructor(
		id: string,
		manifest: PluginManifest,
		port: number,
		limits: ResolvedLimits,
		runner: WorkerdSandboxRunner,
	) {
		this.id = id;
		this.manifest = manifest;
		this.port = port;
		this.limits = limits;
		this.runner = runner;
	}

	private async ensureReady(): Promise<void> {
		await this.runner.ensureRunning();
		if (!this.runner.isHealthy()) {
			throw new SandboxUnavailableError(this.id, "workerd is not running");
		}
	}

	async invokeHook(hookName: string, event: unknown): Promise<unknown> {
		await this.ensureReady();
		return this.withWallTimeLimit(`hook:${hookName}`, async () => {
			const res = await fetch(`http://127.0.0.1:${this.port}/hook/${hookName}`, {
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
		await this.ensureReady();
		return this.withWallTimeLimit(`route:${routeName}`, async () => {
			const res = await fetch(`http://127.0.0.1:${this.port}/route/${routeName}`, {
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

	async terminate(): Promise<void> {
		this.runner.unloadPlugin(this.id);
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
}

export const createSandboxRunner: SandboxRunnerFactory = (options) => {
	const isDev = process.env.EMDASH_SANDBOX_DEV === "1" || process.env.NODE_ENV === "development";

	if (isDev) {
		const devRunner = new MiniflareDevRunner(options);
		if (devRunner.isAvailable()) {
			return devRunner;
		}
	}

	return new WorkerdSandboxRunner(options);
};
