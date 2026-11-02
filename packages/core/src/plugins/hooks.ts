import { PluginContextFactory, type PluginContextFactoryOptions } from "./context.js";
import type {
	ResolvedPlugin,
	ResolvedHook,
	PluginContext,
	ContentHookEvent,
	ContentDeleteEvent,
	ContentStateChangeEvent,
	MediaUploadEvent,
	MediaAfterUploadEvent,
	LifecycleEvent,
	UninstallEvent,
	CronEvent,
	EmailBeforeSendEvent,
	EmailBeforeSendHandler,
	EmailDeliverHandler,
	EmailAfterSendHandler,
	ContentBeforeSaveHandler,
	ContentAfterSaveHandler,
	ContentBeforeDeleteHandler,
	ContentAfterDeleteHandler,
	ContentAfterPublishHandler,
	ContentAfterRestoreHandler,
	ContentAfterScheduleHandler,
	ContentAfterUnpublishHandler,
	ContentAfterUnscheduleHandler,
	MediaBeforeUploadHandler,
	MediaAfterUploadHandler,
	LifecycleHandler,
	UninstallHandler,
	CronHandler,
	EmailMessage,
	CommentBeforeCreateEvent,
	CommentBeforeCreateHandler,
	CommentModerateHandler,
	CommentAfterCreateEvent,
	CommentAfterCreateHandler,
	CommentAfterModerateEvent,
	CommentAfterModerateHandler,
	PageMetadataEvent,
	PageMetadataHandler,
	PageMetadataContribution,
	PageFragmentEvent,
	PageFragmentHandler,
	PageFragmentContribution,
} from "./types.js";

type HookNameV2 =
	| "plugin:install"
	| "plugin:activate"
	| "plugin:deactivate"
	| "plugin:uninstall"
	| "content:beforeSave"
	| "content:afterSave"
	| "content:beforeDelete"
	| "content:afterDelete"
	| "content:afterPublish"
	| "content:afterUnpublish"
	| "content:afterRestore"
	| "content:afterSchedule"
	| "content:afterUnschedule"
	| "media:beforeUpload"
	| "media:afterUpload"
	| "cron"
	| "email:beforeSend"
	| "email:deliver"
	| "email:afterSend"
	| "comment:beforeCreate"
	| "comment:moderate"
	| "comment:afterCreate"
	| "comment:afterModerate"
	| "page:metadata"
	| "page:fragments";

type ContentStateChangeHookName =
	| "content:afterPublish"
	| "content:afterUnpublish"
	| "content:afterRestore"
	| "content:afterSchedule"
	| "content:afterUnschedule";

interface HookHandlerMap {
	"plugin:install": LifecycleHandler;
	"plugin:activate": LifecycleHandler;
	"plugin:deactivate": LifecycleHandler;
	"plugin:uninstall": UninstallHandler;
	"content:beforeSave": ContentBeforeSaveHandler;
	"content:afterSave": ContentAfterSaveHandler;
	"content:beforeDelete": ContentBeforeDeleteHandler;
	"content:afterDelete": ContentAfterDeleteHandler;
	"content:afterPublish": ContentAfterPublishHandler;
	"content:afterUnpublish": ContentAfterUnpublishHandler;
	"content:afterRestore": ContentAfterRestoreHandler;
	"content:afterSchedule": ContentAfterScheduleHandler;
	"content:afterUnschedule": ContentAfterUnscheduleHandler;
	"media:beforeUpload": MediaBeforeUploadHandler;
	"media:afterUpload": MediaAfterUploadHandler;
	cron: CronHandler;
	"email:beforeSend": EmailBeforeSendHandler;
	"email:deliver": EmailDeliverHandler;
	"email:afterSend": EmailAfterSendHandler;
	"comment:beforeCreate": CommentBeforeCreateHandler;
	"comment:moderate": CommentModerateHandler;
	"comment:afterCreate": CommentAfterCreateHandler;
	"comment:afterModerate": CommentAfterModerateHandler;
	"page:metadata": PageMetadataHandler;
	"page:fragments": PageFragmentHandler;
}

export interface HookResult<T> {
	success: boolean;
	value?: T;
	error?: Error;
	pluginId: string;
	duration: number;
}

export class HookPipeline {
	private hooks: Map<HookNameV2, Array<ResolvedHook<unknown>>> = new Map();
	private pluginMap: Map<string, ResolvedPlugin> = new Map();
	private contextFactory: PluginContextFactory | null = null;
	private contextFactoryOptions: Partial<PluginContextFactoryOptions> = {};

	private exclusiveHookNames: Set<string> = new Set();

	private exclusiveSelections: Map<string, string> = new Map();

	constructor(plugins: ResolvedPlugin[], factoryOptions?: PluginContextFactoryOptions) {
		if (factoryOptions) {
			this.contextFactory = new PluginContextFactory(factoryOptions);
			this.contextFactoryOptions = { ...factoryOptions };
		}

		for (const plugin of plugins) {
			this.pluginMap.set(plugin.id, plugin);
		}
		this.registerPlugins(plugins);
	}

	setContextFactory(options: Partial<PluginContextFactoryOptions>): void {
		const merged = { ...this.contextFactoryOptions, ...options };
		this.contextFactory = new PluginContextFactory(merged as PluginContextFactoryOptions);
		this.contextFactoryOptions = merged;
	}

	private getContext(pluginId: string): PluginContext {
		const plugin = this.pluginMap.get(pluginId);
		if (!plugin) {
			throw new Error(`Plugin "${pluginId}" not found`);
		}
		if (!this.contextFactory) {
			throw new Error("Context factory not initialized - call setContextFactory first");
		}
		return this.contextFactory.createContext(plugin);
	}

	private getTypedHooks<N extends HookNameV2>(name: N): Array<ResolvedHook<HookHandlerMap[N]>> {
		const all = (this.hooks.get(name) ?? []) as Array<ResolvedHook<HookHandlerMap[N]>>;

		if (this.exclusiveSelections.has(name)) {
			return all.filter((h) => !h.exclusive);
		}

		return all;
	}

	private registerPlugins(plugins: ResolvedPlugin[]): void {
		for (const plugin of plugins) {
			this.registerPluginHook(plugin, "plugin:install");
			this.registerPluginHook(plugin, "plugin:activate");
			this.registerPluginHook(plugin, "plugin:deactivate");
			this.registerPluginHook(plugin, "plugin:uninstall");
			this.registerPluginHook(plugin, "content:beforeSave");
			this.registerPluginHook(plugin, "content:afterSave");
			this.registerPluginHook(plugin, "content:beforeDelete");
			this.registerPluginHook(plugin, "content:afterDelete");
			this.registerPluginHook(plugin, "content:afterPublish");
			this.registerPluginHook(plugin, "content:afterUnpublish");
			this.registerPluginHook(plugin, "content:afterRestore");
			this.registerPluginHook(plugin, "content:afterSchedule");
			this.registerPluginHook(plugin, "content:afterUnschedule");
			this.registerPluginHook(plugin, "media:beforeUpload");
			this.registerPluginHook(plugin, "media:afterUpload");
			this.registerPluginHook(plugin, "cron");
			this.registerPluginHook(plugin, "email:beforeSend");
			this.registerPluginHook(plugin, "email:deliver");
			this.registerPluginHook(plugin, "email:afterSend");
			this.registerPluginHook(plugin, "comment:beforeCreate");
			this.registerPluginHook(plugin, "comment:moderate");
			this.registerPluginHook(plugin, "comment:afterCreate");
			this.registerPluginHook(plugin, "comment:afterModerate");
			this.registerPluginHook(plugin, "page:metadata");
			this.registerPluginHook(plugin, "page:fragments");
		}

		for (const [hookName, hooks] of this.hooks) {
			this.hooks.set(hookName, this.sortHooks(hooks));
		}
	}

	private static readonly HOOK_REQUIRED_CAPABILITY: ReadonlyMap<string, string> = new Map([
		["email:beforeSend", "hooks.email-events:register"],
		["email:afterSend", "hooks.email-events:register"],
		["email:deliver", "hooks.email-transport:register"],
		["content:beforeSave", "content:write"],
		["content:afterSave", "content:read"],
		["content:beforeDelete", "content:read"],
		["content:afterDelete", "content:read"],
		["content:afterPublish", "content:read"],
		["content:afterUnpublish", "content:read"],
		["content:afterRestore", "content:read"],
		["content:afterSchedule", "content:read"],
		["content:afterUnschedule", "content:read"],
		["media:beforeUpload", "media:write"],
		["media:afterUpload", "media:read"],
		["comment:beforeCreate", "users:read"],
		["comment:moderate", "users:read"],
		["comment:afterCreate", "users:read"],
		["comment:afterModerate", "users:read"],
		["page:fragments", "hooks.page-fragments:register"],
	]);

	private registerPluginHook(plugin: ResolvedPlugin, name: HookNameV2): void {
		const hook = plugin.hooks[name];
		if (!hook) return;

		const requiredCapability = HookPipeline.HOOK_REQUIRED_CAPABILITY.get(name);
		if (requiredCapability && !plugin.capabilities.includes(requiredCapability as never)) {
			console.warn(
				`[hooks] Plugin "${plugin.id}" declares ${name} hook without ${requiredCapability} capability — skipping`,
			);
			return;
		}

		if (hook.exclusive) {
			this.exclusiveHookNames.add(name);
		}

		this.registerHook(name, hook);
	}

	private registerHook(name: HookNameV2, hook: ResolvedHook<unknown>): void {
		const existing = this.hooks.get(name) || [];
		existing.push(hook);
		this.hooks.set(name, existing);
	}

	private sortHooks(hooks: Array<ResolvedHook<unknown>>): Array<ResolvedHook<unknown>> {
		const sorted: Array<ResolvedHook<unknown>> = [];
		const remaining = [...hooks];

		while (remaining.length > 0) {
			const ready = remaining.filter((hook) =>
				hook.dependencies.every((dep) => sorted.some((s) => s.pluginId === dep)),
			);

			if (ready.length === 0) {
				const pluginIds = remaining.map((h) => h.pluginId).join(", ");
				console.warn(
					`[hooks] Hook dependency cycle or missing dependency detected among plugins: ${pluginIds}. Falling back to priority order.`,
				);
				remaining.sort((a, b) => a.priority - b.priority);
				sorted.push(...remaining);
				break;
			}

			ready.sort((a, b) => a.priority - b.priority);
			const next = ready[0];
			sorted.push(next);
			remaining.splice(remaining.indexOf(next), 1);
		}

		return sorted;
	}

	private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
		let timer: ReturnType<typeof setTimeout>;
		const timeoutPromise = new Promise<T>(
			(_, reject) =>
				(timer = setTimeout(() => reject(new Error(`Hook timeout after ${timeout}ms`)), timeout)),
		);
		try {
			return await Promise.race([fn(), timeoutPromise]);
		} finally {
			clearTimeout(timer!);
		}
	}

	async runPluginInstall(pluginId: string): Promise<HookResult<void>[]> {
		return this.runLifecycleHook("plugin:install", pluginId);
	}

	async runPluginActivate(pluginId: string): Promise<HookResult<void>[]> {
		return this.runLifecycleHook("plugin:activate", pluginId);
	}

	async runPluginDeactivate(pluginId: string): Promise<HookResult<void>[]> {
		return this.runLifecycleHook("plugin:deactivate", pluginId);
	}

	async runPluginUninstall(pluginId: string, deleteData: boolean): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks("plugin:uninstall");
		const results: HookResult<void>[] = [];

		const hook = hooks.find((h) => h.pluginId === pluginId);
		if (!hook) return results;

		const { handler } = hook;
		const event: UninstallEvent = { deleteData };
		const ctx = this.getContext(pluginId);
		const start = Date.now();

		try {
			await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			results.push({
				success: true,
				pluginId: hook.pluginId,
				duration: Date.now() - start,
			});
		} catch (error) {
			results.push({
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
				pluginId: hook.pluginId,
				duration: Date.now() - start,
			});
		}

		return results;
	}

	private async runLifecycleHook(
		hookName: "plugin:install" | "plugin:activate" | "plugin:deactivate",
		pluginId: string,
	): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks(hookName);
		const results: HookResult<void>[] = [];

		const hook = hooks.find((h) => h.pluginId === pluginId);
		if (!hook) return results;

		const { handler } = hook;
		const event: LifecycleEvent = {};
		const ctx = this.getContext(pluginId);
		const start = Date.now();

		try {
			await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			results.push({
				success: true,
				pluginId: hook.pluginId,
				duration: Date.now() - start,
			});
		} catch (error) {
			results.push({
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
				pluginId: hook.pluginId,
				duration: Date.now() - start,
			});
		}

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
		const hooks = this.getTypedHooks("content:beforeSave");
		const results: HookResult<Record<string, unknown>>[] = [];
		let currentContent = content;

		for (const hook of hooks) {
			const { handler } = hook;
			const event: ContentHookEvent = {
				content: currentContent,
				collection,
				isNew,
			};
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				const result = await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				if (result !== undefined) {
					currentContent = result;
				}
				results.push({
					success: true,
					value: currentContent,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return { content: currentContent, results };
	}

	async runContentAfterSave(
		content: Record<string, unknown>,
		collection: string,
		isNew: boolean,
	): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks("content:afterSave");
		const results: HookResult<void>[] = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const event: ContentHookEvent = { content, collection, isNew };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				results.push({
					success: true,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return results;
	}

	async runContentBeforeDelete(
		id: string,
		collection: string,
	): Promise<{ allowed: boolean; results: HookResult<boolean>[] }> {
		const hooks = this.getTypedHooks("content:beforeDelete");
		const results: HookResult<boolean>[] = [];
		let allowed = true;

		for (const hook of hooks) {
			const { handler } = hook;
			const event: ContentDeleteEvent = { id, collection, permanent: false };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				const result = await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				if (result === false) {
					allowed = false;
				}
				results.push({
					success: true,
					value: result !== false,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return { allowed, results };
	}

	async runContentAfterDelete(
		id: string,
		collection: string,
		permanent: boolean,
	): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks("content:afterDelete");
		const results: HookResult<void>[] = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const event: ContentDeleteEvent = { id, collection, permanent };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				results.push({
					success: true,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return results;
	}

	private async runContentStateChangeHook(
		name: ContentStateChangeHookName,
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks(name);
		const results: HookResult<void>[] = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const event: ContentStateChangeEvent = { content, collection };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				results.push({
					success: true,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return results;
	}

	async runContentAfterPublish(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		return this.runContentStateChangeHook("content:afterPublish", content, collection);
	}

	async runContentAfterUnpublish(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		return this.runContentStateChangeHook("content:afterUnpublish", content, collection);
	}

	async runContentAfterRestore(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		return this.runContentStateChangeHook("content:afterRestore", content, collection);
	}

	async runContentAfterSchedule(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		return this.runContentStateChangeHook("content:afterSchedule", content, collection);
	}

	async runContentAfterUnschedule(
		content: Record<string, unknown>,
		collection: string,
	): Promise<HookResult<void>[]> {
		return this.runContentStateChangeHook("content:afterUnschedule", content, collection);
	}

	async runMediaBeforeUpload(file: { name: string; type: string; size: number }): Promise<{
		file: { name: string; type: string; size: number };
		results: HookResult<{ name: string; type: string; size: number }>[];
	}> {
		const hooks = this.getTypedHooks("media:beforeUpload");
		const results: HookResult<{
			name: string;
			type: string;
			size: number;
		}>[] = [];
		let currentFile = file;

		for (const hook of hooks) {
			const { handler } = hook;
			const event: MediaUploadEvent = { file: currentFile };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				const result = await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				if (result !== undefined) {
					currentFile = result;
				}
				results.push({
					success: true,
					value: currentFile,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return { file: currentFile, results };
	}

	async runMediaAfterUpload(media: {
		id: string;
		filename: string;
		mimeType: string;
		size: number | null;
		url: string;
		createdAt: string;
	}): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks("media:afterUpload");
		const results: HookResult<void>[] = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const event: MediaAfterUploadEvent = { media };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				results.push({
					success: true,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return results;
	}

	async invokeCronHook(pluginId: string, event: CronEvent): Promise<HookResult<void>> {
		const hooks = this.getTypedHooks("cron");
		const hook = hooks.find((h) => h.pluginId === pluginId);

		if (!hook) {
			return {
				success: false,
				error: new Error(`Plugin "${pluginId}" has no cron hook registered`),
				pluginId,
				duration: 0,
			};
		}

		const { handler } = hook;
		const ctx = this.getContext(pluginId);
		const start = Date.now();

		try {
			await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			return {
				success: true,
				pluginId,
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
				pluginId,
				duration: Date.now() - start,
			};
		}
	}

	async runEmailBeforeSend(
		message: EmailMessage,
		source: string,
	): Promise<{ message: EmailMessage | false; results: HookResult<EmailMessage | false>[] }> {
		const hooks = this.getTypedHooks("email:beforeSend");
		const results: HookResult<EmailMessage | false>[] = [];
		let currentMessage: EmailMessage = message;

		for (const hook of hooks) {
			const { handler } = hook;
			const event: EmailBeforeSendEvent = { message: { ...currentMessage }, source };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				const result = await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);

				if (result === false) {
					results.push({
						success: true,
						value: false,
						pluginId: hook.pluginId,
						duration: Date.now() - start,
					});
					return { message: false, results };
				}

				if (result && typeof result === "object") {
					currentMessage = result;
				}

				results.push({
					success: true,
					value: currentMessage,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return { message: currentMessage, results };
	}

	async runEmailAfterSend(message: EmailMessage, source: string): Promise<HookResult<void>[]> {
		const hooks = this.getTypedHooks("email:afterSend");
		const results: HookResult<void>[] = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const event = { message, source };
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
				results.push({
					success: true,
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			} catch (error) {
				console.error(
					`[email:afterSend] Plugin "${hook.pluginId}" error:`,
					error instanceof Error ? error.message : error,
				);
				results.push({
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					pluginId: hook.pluginId,
					duration: Date.now() - start,
				});
			}
		}

		return results;
	}

	async runCommentBeforeCreate(
		event: CommentBeforeCreateEvent,
	): Promise<CommentBeforeCreateEvent | false> {
		const hooks = this.getTypedHooks("comment:beforeCreate");
		let currentEvent = event;

		for (const hook of hooks) {
			const { handler } = hook;
			const ctx = this.getContext(hook.pluginId);
			const start = Date.now();

			try {
				const result = await this.executeWithTimeout(
					() => handler({ ...currentEvent }, ctx),
					hook.timeout,
				);

				if (result === false) {
					return false;
				}

				if (result && typeof result === "object") {
					currentEvent = result;
				}
			} catch (error) {
				console.error(
					`[comment:beforeCreate] Plugin "${hook.pluginId}" error (${Date.now() - start}ms):`,
					error instanceof Error ? error.message : error,
				);

				if (hook.errorPolicy === "abort") {
					throw error;
				}
			}
		}

		return currentEvent;
	}

	async runCommentAfterCreate(event: CommentAfterCreateEvent): Promise<void> {
		const hooks = this.getTypedHooks("comment:afterCreate");

		for (const hook of hooks) {
			const { handler } = hook;
			const ctx = this.getContext(hook.pluginId);

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			} catch (error) {
				console.error(
					`[comment:afterCreate] Plugin "${hook.pluginId}" error:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
	}

	async runCommentAfterModerate(event: CommentAfterModerateEvent): Promise<void> {
		const hooks = this.getTypedHooks("comment:afterModerate");

		for (const hook of hooks) {
			const { handler } = hook;
			const ctx = this.getContext(hook.pluginId);

			try {
				await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			} catch (error) {
				console.error(
					`[comment:afterModerate] Plugin "${hook.pluginId}" error:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
	}

	async runPageMetadata(
		event: PageMetadataEvent,
	): Promise<Array<{ pluginId: string; contributions: PageMetadataContribution[] }>> {
		const hooks = this.getTypedHooks("page:metadata");
		const results: Array<{ pluginId: string; contributions: PageMetadataContribution[] }> = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const ctx = this.getContext(hook.pluginId);

			try {
				const result = await this.executeWithTimeout(
					() => Promise.resolve(handler(event, ctx)),
					hook.timeout,
				);

				if (result != null) {
					const contributions = Array.isArray(result) ? result : [result];
					results.push({ pluginId: hook.pluginId, contributions });
				}
			} catch (error) {
				console.error(
					`[page:metadata] Plugin "${hook.pluginId}" error:`,
					error instanceof Error ? error.message : error,
				);
			}
		}

		return results;
	}

	async runPageFragments(
		event: PageFragmentEvent,
	): Promise<Array<{ pluginId: string; contributions: PageFragmentContribution[] }>> {
		const hooks = this.getTypedHooks("page:fragments");
		const results: Array<{ pluginId: string; contributions: PageFragmentContribution[] }> = [];

		for (const hook of hooks) {
			const { handler } = hook;
			const ctx = this.getContext(hook.pluginId);

			try {
				const result = await this.executeWithTimeout(
					() => Promise.resolve(handler(event, ctx)),
					hook.timeout,
				);

				if (result != null) {
					const contributions = Array.isArray(result) ? result : [result];
					results.push({ pluginId: hook.pluginId, contributions });
				}
			} catch (error) {
				console.error(
					`[page:fragments] Plugin "${hook.pluginId}" error:`,
					error instanceof Error ? error.message : error,
				);
			}
		}

		return results;
	}

	hasHooks(name: HookNameV2): boolean {
		const hooks = this.hooks.get(name);
		return hooks !== undefined && hooks.length > 0;
	}

	getHookCount(name: HookNameV2): number {
		return this.hooks.get(name)?.length || 0;
	}

	getRegisteredHooks(): HookNameV2[] {
		return [...this.hooks.keys()];
	}

	getRegisteredExclusiveHooks(): string[] {
		return [...this.exclusiveHookNames];
	}

	isExclusiveHook(name: string): boolean {
		return this.exclusiveHookNames.has(name);
	}

	setExclusiveSelection(hookName: string, pluginId: string): void {
		this.exclusiveSelections.set(hookName, pluginId);
	}

	clearExclusiveSelection(hookName: string): void {
		this.exclusiveSelections.delete(hookName);
	}

	getExclusiveSelection(hookName: string): string | undefined {
		return this.exclusiveSelections.get(hookName);
	}

	getExclusiveHookProviders(hookName: string): Array<{ pluginId: string }> {
		const hooks = this.hooks.get(hookName as HookNameV2) ?? [];
		return hooks.filter((h) => h.exclusive).map((h) => ({ pluginId: h.pluginId }));
	}

	getHookProviders(hookName: string): Array<{ pluginId: string }> {
		const hooks = this.hooks.get(hookName as HookNameV2) ?? [];
		return hooks.filter((h) => !h.exclusive).map((h) => ({ pluginId: h.pluginId }));
	}

	async invokeExclusiveHook(
		hookName: string,
		event: unknown,
	): Promise<{ result: unknown; pluginId: string; error?: Error; duration: number } | null> {
		const selectedPluginId = this.exclusiveSelections.get(hookName);
		if (!selectedPluginId) return null;

		const hooks = this.hooks.get(hookName as HookNameV2) ?? [];
		const hook = hooks.find((h) => h.pluginId === selectedPluginId && h.exclusive);
		if (!hook) return null;

		const start = Date.now();
		try {
			const ctx = this.getContext(selectedPluginId);
			const handler = hook.handler as (event: unknown, ctx: PluginContext) => Promise<unknown>;
			const result = await this.executeWithTimeout(() => handler(event, ctx), hook.timeout);
			return { result, pluginId: selectedPluginId, duration: Date.now() - start };
		} catch (error) {
			return {
				result: undefined,
				pluginId: selectedPluginId,
				error: error instanceof Error ? error : new Error(String(error)),
				duration: Date.now() - start,
			};
		}
	}
}

export function createHookPipeline(
	plugins: ResolvedPlugin[],
	factoryOptions?: PluginContextFactoryOptions,
): HookPipeline {
	return new HookPipeline(plugins, factoryOptions);
}

export interface ExclusiveHookResolutionOptions {
	pipeline: HookPipeline;
	isActive: (pluginId: string) => boolean;
	getOption: (key: string) => Promise<string | null>;
	getOptions?: (keys: string[]) => Promise<ReadonlyMap<string, string>>;
	setOption: (key: string, value: string) => Promise<void>;
	deleteOption: (key: string) => Promise<void>;
	preferredHints?: Map<string, string[]>;
}

const EXCLUSIVE_HOOK_KEY_PREFIX = "emdash:exclusive_hook:";

export async function resolveExclusiveHooks(opts: ExclusiveHookResolutionOptions): Promise<void> {
	const { pipeline, isActive, getOption, getOptions, setOption, deleteOption, preferredHints } =
		opts;
	const exclusiveHookNames = pipeline.getRegisteredExclusiveHooks();
	if (exclusiveHookNames.length === 0) return;

	let batchedSelections: ReadonlyMap<string, string> | undefined;
	if (getOptions) {
		try {
			batchedSelections = await getOptions(
				exclusiveHookNames.map((hookName) => `${EXCLUSIVE_HOOK_KEY_PREFIX}${hookName}`),
			);
		} catch {
			return;
		}
	}

	for (const hookName of exclusiveHookNames) {
		const providers = pipeline.getExclusiveHookProviders(hookName);
		const activeProviderIds = new Set(
			providers.map((p) => p.pluginId).filter((id) => isActive(id)),
		);

		const key = `${EXCLUSIVE_HOOK_KEY_PREFIX}${hookName}`;
		let currentSelection: string | null = null;
		if (batchedSelections) {
			currentSelection = batchedSelections.get(key) ?? null;
		} else {
			try {
				currentSelection = await getOption(key);
			} catch {
				continue;
			}
		}

		if (currentSelection && activeProviderIds.has(currentSelection)) {
			pipeline.setExclusiveSelection(hookName, currentSelection);
			continue;
		}

		if (currentSelection) {
			try {
				await deleteOption(key);
			} catch {}
		}

		if (activeProviderIds.size === 1) {
			const [onlyProvider] = activeProviderIds;
			try {
				await setOption(key, onlyProvider);
			} catch {}
			pipeline.setExclusiveSelection(hookName, onlyProvider);
			continue;
		}

		if (preferredHints) {
			let found = false;
			for (const [pluginId, hooks] of preferredHints) {
				if (hooks.includes(hookName) && activeProviderIds.has(pluginId)) {
					try {
						await setOption(key, pluginId);
					} catch {}
					pipeline.setExclusiveSelection(hookName, pluginId);
					found = true;
					break;
				}
			}
			if (found) continue;
		}

		pipeline.clearExclusiveSelection(hookName);
	}
}
