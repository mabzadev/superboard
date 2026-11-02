import type { Kysely } from "kysely";
import { sql } from "kysely";

import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import type { Storage } from "../storage/types.js";
import type { PluginContextFactoryOptions } from "./context.js";
import { setCronTasksEnabled } from "./cron.js";
import { definePlugin } from "./define-plugin.js";
import type { EmailPipeline } from "./email.js";
import {
	HookPipeline,
	type HookResult,
	resolveExclusiveHooks as resolveExclusiveHooksShared,
} from "./hooks.js";
import { PluginRouteRegistry, type RouteResult, type InvokeRouteOptions } from "./routes.js";
import type {
	PluginDefinition,
	ResolvedPlugin,
	PluginStorageConfig,
	MediaItem,
	CronEvent,
} from "./types.js";

const EXCLUSIVE_HOOK_KEY_PREFIX = "emdash:exclusive_hook:";

export type PluginState = "registered" | "installed" | "active" | "inactive";

interface PluginEntry {
	plugin: ResolvedPlugin;
	state: PluginState;
}

export interface PluginManagerOptions {
	db: Kysely<Database>;
	storage?: Storage;
	getUploadUrl?: (
		filename: string,
		contentType: string,
	) => Promise<{ uploadUrl: string; mediaId: string }>;
	trustedProxyHeaders?: string[];
}

export class PluginManager {
	private plugins: Map<string, PluginEntry> = new Map();
	private hookPipeline: HookPipeline | null = null;
	private routeRegistry: PluginRouteRegistry | null = null;
	private factoryOptions: PluginContextFactoryOptions;
	private initialized = false;

	constructor(private options: PluginManagerOptions) {
		this.factoryOptions = {
			db: options.db,
			storage: options.storage,
			getUploadUrl: options.getUploadUrl,
			trustedProxyHeaders: options.trustedProxyHeaders,
		};
	}

	setEmailPipeline(pipeline: EmailPipeline): void {
		this.factoryOptions.emailPipeline = pipeline;
		if (this.initialized) {
			this.reinitialize();
		}
	}

	register<TStorage extends PluginStorageConfig>(
		definition: PluginDefinition<TStorage>,
	): ResolvedPlugin<TStorage> {
		const resolved = definePlugin(definition);

		if (this.plugins.has(resolved.id)) {
			throw new Error(`Plugin "${resolved.id}" is already registered`);
		}

		this.plugins.set(resolved.id, {
			plugin: resolved,
			state: "registered",
		});

		this.initialized = false;

		return resolved;
	}

	registerAll(definitions: PluginDefinition[]): void {
		for (const def of definitions) {
			this.register(def);
		}
	}

	unregister(pluginId: string): boolean {
		const entry = this.plugins.get(pluginId);
		if (!entry) return false;

		if (entry.state === "active") {
			throw new Error(`Cannot unregister active plugin "${pluginId}". Deactivate it first.`);
		}

		this.plugins.delete(pluginId);
		this.initialized = false;
		return true;
	}

	async install(pluginId: string): Promise<HookResult<void>[]> {
		const entry = this.plugins.get(pluginId);
		if (!entry) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}

		if (entry.state !== "registered") {
			throw new Error(`Plugin "${pluginId}" is already installed (state: ${entry.state})`);
		}

		this.ensureInitialized();

		const results = await this.hookPipeline!.runPluginInstall(pluginId);

		const failed = results.find((r) => !r.success);
		if (failed) {
			throw new Error(`Plugin install failed: ${failed.error?.message ?? "Unknown error"}`);
		}

		entry.state = "installed";
		return results;
	}

	async activate(pluginId: string): Promise<HookResult<void>[]> {
		const entry = this.plugins.get(pluginId);
		if (!entry) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}

		if (entry.state === "active") {
			return [];
		}

		if (entry.state === "registered") {
			await this.install(pluginId);
		}

		this.ensureInitialized();

		const results = await this.hookPipeline!.runPluginActivate(pluginId);

		const failed = results.find((r) => !r.success);
		if (failed) {
			throw new Error(`Plugin activation failed: ${failed.error?.message ?? "Unknown error"}`);
		}

		entry.state = "active";

		await setCronTasksEnabled(this.options.db, pluginId, true);

		this.reinitialize();

		await this.resolveExclusiveHooks();

		return results;
	}

	async deactivate(pluginId: string): Promise<HookResult<void>[]> {
		const entry = this.plugins.get(pluginId);
		if (!entry) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}

		if (entry.state !== "active") {
			return [];
		}

		this.ensureInitialized();

		const results = await this.hookPipeline!.runPluginDeactivate(pluginId);

		await setCronTasksEnabled(this.options.db, pluginId, false);

		entry.state = "inactive";

		this.reinitialize();

		await this.resolveExclusiveHooks();

		return results;
	}

	async uninstall(pluginId: string, deleteData: boolean = false): Promise<HookResult<void>[]> {
		const entry = this.plugins.get(pluginId);
		if (!entry) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}

		if (entry.state === "active") {
			await this.deactivate(pluginId);
		}

		this.ensureInitialized();

		const results = await this.hookPipeline!.runPluginUninstall(pluginId, deleteData);

		await this.deleteCronTasks(pluginId);

		this.plugins.delete(pluginId);
		this.initialized = false;

		await this.resolveExclusiveHooks();

		return results;
	}

	async runContentBeforeSave(
		content: Record<string, unknown>,
		collection: string,
		isNew: boolean,
	): Promise<{
		content: Record<string, unknown>;
		results: HookResult<Record<string, unknown>>[];
	}> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentBeforeSave(content, collection, isNew);
	}

	async runContentAfterSave(
		content: Record<string, unknown>,
		collection: string,
		isNew: boolean,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterSave(content, collection, isNew);
	}

	async runContentBeforeDelete(
		id: string,
		collection: string,
	): Promise<{ allowed: boolean; results: HookResult<boolean>[] }> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentBeforeDelete(id, collection);
	}

	async runContentAfterDelete(
		id: string,
		collection: string,
		permanent: boolean,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterDelete(id, collection, permanent);
	}

	async runContentAfterPublish(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterPublish(content, collection);
	}

	async runContentAfterUnpublish(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterUnpublish(content, collection);
	}

	async runContentAfterRestore(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterRestore(content, collection);
	}

	async runContentAfterSchedule(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterSchedule(content, collection);
	}

	async runContentAfterUnschedule(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runContentAfterUnschedule(content, collection);
	}

	async runMediaBeforeUpload(file: { name: string; type: string; size: number }): Promise<{
		file: { name: string; type: string; size: number };
		results: HookResult<{ name: string; type: string; size: number }>[];
	}> {
		this.ensureInitialized();
		return this.hookPipeline!.runMediaBeforeUpload(file);
	}

	async runMediaAfterUpload(media: MediaItem): Promise<HookResult<void>[]> {
		this.ensureInitialized();
		return this.hookPipeline!.runMediaAfterUpload(media);
	}

	async invokeCronHook(pluginId: string, event: CronEvent): Promise<void> {
		this.ensureInitialized();
		const result = await this.hookPipeline!.invokeCronHook(pluginId, event);
		if (!result.success && result.error) {
			throw result.error;
		}
	}

	async invokeRoute(
		pluginId: string,
		routeName: string,
		options: InvokeRouteOptions,
	): Promise<RouteResult> {
		this.ensureInitialized();
		return this.routeRegistry!.invoke(pluginId, routeName, options);
	}

	getPluginRoutes(pluginId: string): string[] {
		this.ensureInitialized();
		return this.routeRegistry!.getRoutes(pluginId);
	}

	getPlugin(pluginId: string): ResolvedPlugin | undefined {
		return this.plugins.get(pluginId)?.plugin;
	}

	getPluginState(pluginId: string): PluginState | undefined {
		return this.plugins.get(pluginId)?.state;
	}

	getAllPlugins(): Array<{ plugin: ResolvedPlugin; state: PluginState }> {
		return Array.from(this.plugins.values(), (entry) => ({
			plugin: entry.plugin,
			state: entry.state,
		}));
	}

	getActivePlugins(): ResolvedPlugin[] {
		return [...this.plugins.values()]
			.filter((entry) => entry.state === "active")
			.map((entry) => entry.plugin);
	}

	hasPlugin(pluginId: string): boolean {
		return this.plugins.has(pluginId);
	}

	isActive(pluginId: string): boolean {
		return this.plugins.get(pluginId)?.state === "active";
	}

	getExclusiveHookProviders(hookName: string): Array<{ pluginId: string; pluginName: string }> {
		this.ensureInitialized();
		return this.hookPipeline!.getExclusiveHookProviders(hookName).map((p) => {
			const plugin = this.plugins.get(p.pluginId);
			return {
				pluginId: p.pluginId,
				pluginName: plugin?.plugin.id ?? p.pluginId,
			};
		});
	}

	async getExclusiveHookSelection(hookName: string): Promise<string | null> {
		const optionsRepo = new OptionsRepository(this.options.db);
		return optionsRepo.get<string>(`${EXCLUSIVE_HOOK_KEY_PREFIX}${hookName}`);
	}

	async setExclusiveHookSelection(hookName: string, pluginId: string | null): Promise<void> {
		const optionsRepo = new OptionsRepository(this.options.db);
		const key = `${EXCLUSIVE_HOOK_KEY_PREFIX}${hookName}`;

		if (pluginId === null) {
			await optionsRepo.delete(key);
			this.hookPipeline?.clearExclusiveSelection(hookName);
			return;
		}

		const entry = this.plugins.get(pluginId);
		if (!entry) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}
		if (entry.state !== "active") {
			throw new Error(`Plugin "${pluginId}" is not active`);
		}

		await optionsRepo.set(key, pluginId);
		this.hookPipeline?.setExclusiveSelection(hookName, pluginId);
	}

	async resolveExclusiveHooks(preferredHints?: Map<string, string[]>): Promise<void> {
		this.ensureInitialized();

		const optionsRepo = new OptionsRepository(this.options.db);

		await resolveExclusiveHooksShared({
			pipeline: this.hookPipeline!,
			isActive: (pluginId) => this.isActive(pluginId),
			getOption: (key) => optionsRepo.get<string>(key),
			getOptions: (keys) => optionsRepo.getMany<string>(keys),
			setOption: (key, value) => optionsRepo.set(key, value),
			deleteOption: async (key) => {
				await optionsRepo.delete(key);
			},
			preferredHints,
		});
	}

	async getExclusiveHooksInfo(): Promise<
		Array<{
			hookName: string;
			providers: Array<{ pluginId: string }>;
			selectedPluginId: string | null;
		}>
	> {
		this.ensureInitialized();
		const exclusiveHookNames = this.hookPipeline!.getRegisteredExclusiveHooks();
		const result = [];

		for (const hookName of exclusiveHookNames) {
			const providers = this.hookPipeline!.getExclusiveHookProviders(hookName);
			const selection = await this.getExclusiveHookSelection(hookName);
			result.push({
				hookName,
				providers,
				selectedPluginId: selection,
			});
		}

		return result;
	}

	private ensureInitialized(): void {
		if (this.initialized) return;

		const activePlugins = this.getActivePlugins();

		this.hookPipeline = new HookPipeline(activePlugins, this.factoryOptions);

		this.routeRegistry = new PluginRouteRegistry(this.factoryOptions);

		for (const plugin of activePlugins) {
			this.routeRegistry.register(plugin);
		}

		this.initialized = true;
	}

	reinitialize(): void {
		this.initialized = false;
		this.ensureInitialized();
	}

	private async deleteCronTasks(pluginId: string): Promise<void> {
		try {
			await sql`
				DELETE FROM _emdash_cron_tasks
				WHERE plugin_id = ${pluginId}
			`.execute(this.options.db);
		} catch {}
	}
}

export function createPluginManager(options: PluginManagerOptions): PluginManager {
	return new PluginManager(options);
}
