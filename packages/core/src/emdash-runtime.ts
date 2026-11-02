import { Permissions } from "@emdash-cms/auth";
import type { Element } from "@emdash-cms/blocks";
import { Kysely, type Dialect } from "kysely";
import virtualConfig from "virtual:emdash/config";
import { z } from "zod";

import { assertMediaUsageActivationWriteAllowed } from "./api/media-usage-write-fence.js";
import { validateRev } from "./api/rev.js";
import type {
	EmDashConfig,
	PluginAdminPage,
	PluginDashboardWidget,
} from "./astro/integration/runtime.js";
import type { EmDashManifest, ManifestCollection } from "./astro/types.js";
import { getAuthMode } from "./auth/mode.js";
import { getTrustedProxyHeaders } from "./auth/trusted-proxy.js";
import type { ContentFieldFilters } from "./content-list-query.js";
import { isSqlite } from "./database/dialect-helpers.js";
import { kyselyLogOption } from "./database/instrumentation.js";
import {
	enforceRuntimeMigrationPolicy,
	PendingMigrationsError,
	type RuntimeMigrationMode,
} from "./database/migrations/policy.js";
import {
	ConcurrentMigrationTimeoutError,
	MIGRATION_RACE_WAIT_MS,
} from "./database/migrations/runner.js";
import { AuditRepository } from "./database/repositories/audit.js";
import { ContentRepository } from "./database/repositories/content.js";
import { RevisionRepository } from "./database/repositories/revision.js";
import { ContentMutationConflictError } from "./database/repositories/types.js";
import type {
	ContentItem as ContentItemInternal,
	ContentDateField,
} from "./database/repositories/types.js";
import { getI18nConfig } from "./i18n/config.js";
import { repairLocaleCasing } from "./i18n/repair-locale-casing.js";
import { warnAboutUnconfiguredTaxonomyLocales } from "./i18n/taxonomy-locale-diagnostic.js";
import { normalizeMediaValue } from "./media/normalize.js";
import type { MediaProvider, MediaProviderCapabilities } from "./media/types.js";
import { activateMediaUsageCapture } from "./media/usage/activation.js";
import {
	deleteContentMediaUsage,
	findNonTranslatableSiblingContentIds,
	markContentMediaUsageCollectionStale,
	refreshContentMediaUsageAfterWrite,
} from "./media/usage/content-refresh.js";
import { processMediaUsageWorkAfterWrite } from "./media/usage/work-processor.js";
import { createSandboxRunnerOptions } from "./plugins/sandbox/runner-options.js";
import { getSandboxRouteErrorDetails } from "./plugins/sandbox/types.js";
import type {
	SandboxedPluginInstance,
	SandboxRunner,
	SandboxRunnerFactory,
} from "./plugins/sandbox/types.js";
import type {
	ResolvedPlugin,
	MediaItem,
	PluginManifest,
	PluginCapability,
	PluginStorageConfig,
	PluginMcpManifestConfig,
	PublicPageContext,
	PageMetadataContribution,
	PageFragmentContribution,
	PortableTextBlockConfig,
	FieldWidgetConfig,
	SettingField,
	UserInfo,
} from "./plugins/types.js";
import { recordSchedulerHeartbeatSafely } from "./scheduler-health.js";
import { MAX_COLLECTION_LIST_COLUMNS, type FieldType } from "./schema/types.js";
import { isMissingTableError } from "./utils/db-errors.js";
import { hashString } from "./utils/hash.js";
import { createInitLock, type InitLock, initWithLock } from "./utils/init-lock.js";
import { createSingleFlightCache, singleFlightCached } from "./utils/single-flight-cache.js";
import { COMMIT, VERSION } from "./version.js";

const LEADING_SLASH_PATTERN = /^\//;
const LOCALE_CASING_REPAIR_OPTION = "emdash:repair_locale_casing";

function getLocaleCasingRepairVersion(locales: readonly string[]): string | null {
	if (locales.length === 0) return null;
	return `1:${locales.toSorted().join(",")}`;
}

function parseStringArray(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((v): v is string => typeof v === "string");
}

interface PageContributions {
	metadata: PageMetadataContribution[];
	fragments: PageFragmentContribution[];
}

const VALID_METADATA_KINDS = new Set(["meta", "property", "link", "jsonld"]);

const VALID_LINK_REL = new Set([
	"canonical",
	"alternate",
	"author",
	"license",
	"nlweb",
	"site.standard.document",
]);

function isValidMetadataContribution(c: unknown): c is PageMetadataContribution {
	if (!c || typeof c !== "object" || !("kind" in c)) return false;
	const obj = c as Record<string, unknown>;
	if (typeof obj.kind !== "string" || !VALID_METADATA_KINDS.has(obj.kind)) return false;

	switch (obj.kind) {
		case "meta":
			return typeof obj.name === "string" && typeof obj.content === "string";
		case "property":
			return typeof obj.property === "string" && typeof obj.content === "string";
		case "link":
			return (
				typeof obj.href === "string" && typeof obj.rel === "string" && VALID_LINK_REL.has(obj.rel)
			);
		case "jsonld":
			return obj.graph != null && typeof obj.graph === "object";
		default:
			return false;
	}
}

import { after } from "./after.js";
import { maybeRunScheduledBackup } from "./api/handlers/backup.js";
import { loadBundleFromR2 } from "./api/handlers/marketplace.js";
import { runSystemCleanup } from "./cleanup.js";
import {
	DEFAULT_COMMENT_MODERATOR_PLUGIN_ID,
	defaultCommentModerate,
} from "./comments/moderator.js";
import { validateEncryptionKeyAtStartup } from "./config/secrets.js";
import { OptionsRepository } from "./database/repositories/options.js";
import {
	handleContentList,
	handleContentAuthors,
	handleContentGet,
	handleContentGetIncludingTrashed,
	handleContentCreate,
	handleContentUpdate,
	handleContentDelete,
	handleContentDuplicate,
	handleContentRestore,
	handleContentPermanentDelete,
	handleContentListTrashed,
	handleContentCountTrashed,
	handleContentPublish,
	handleContentUnpublish,
	handleContentSchedule,
	handleContentUnschedule,
	handleContentCountScheduled,
	handleContentDiscardDraft,
	handleContentCompare,
	handleContentTranslations,
	handleMediaList,
	handleMediaGet,
	handleMediaCreate,
	handleMediaUpdate,
	handleMediaDelete,
	handleRevisionList,
	handleRevisionGet,
	handleRevisionRestore,
	SchemaRegistry,
	type Database,
	type Storage,
} from "./index.js";
import { getDb } from "./loader.js";
import { isRecord } from "./plugin-utils.js";
import { CronExecutor, setCronTasksEnabled, type InvokeCronHookFn } from "./plugins/cron.js";
import { definePlugin } from "./plugins/define-plugin.js";
import { DEV_CONSOLE_EMAIL_PLUGIN_ID, devConsoleEmailDeliver } from "./plugins/email-console.js";
import { EmailPipeline } from "./plugins/email.js";
import {
	createHookPipeline,
	resolveExclusiveHooks as resolveExclusiveHooksShared,
	type HookPipeline,
} from "./plugins/hooks.js";
import { normalizeManifestRoute } from "./plugins/manifest-schema.js";
import { extractRequestMeta, sanitizeHeadersForSandbox } from "./plugins/request-meta.js";
import {
	buildRouteMeta,
	parseRouteInput,
	PluginRouteRegistry,
	toRouteCallerInfo,
	type RouteCallerInput,
	type RouteMeta,
} from "./plugins/routes.js";
import type { CronScheduler } from "./plugins/scheduler/types.js";
import { isPluginStateEnabled, PluginStateRepository } from "./plugins/state.js";
import { syncDeclaredStorageIndexes } from "./plugins/storage-indexes.js";
import { normalizeRegistryConfig } from "./registry/config.js";
import { requestCached } from "./request-cache.js";
import { getRequestContext } from "./request-context.js";
import { publishDueContent, type PublishedRef } from "./scheduled-publish.js";
import { FTSManager } from "./search/fts-manager.js";
import { invalidateSiteSettingsCache } from "./settings/index.js";

const FIELD_TYPE_TO_KIND: Record<FieldType, string> = {
	string: "string",
	slug: "string",
	url: "url",
	text: "richText",
	number: "number",
	integer: "number",
	boolean: "boolean",
	datetime: "datetime",
	select: "select",
	multiSelect: "multiSelect",
	portableText: "portableText",
	image: "image",
	file: "file",
	reference: "reference",
	json: "json",
	repeater: "repeater",
};

const DRAFT_ONLY_UPDATE_KEYS = new Set(["data", "slug", "locale", "skipRevision"]);
const MAX_DRAFT_STAGE_ATTEMPTS = 32;

const LIST_COLUMN_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
	"string",
	"number",
	"integer",
	"boolean",
	"datetime",
	"select",
	"multiSelect",
]);

export interface SandboxedPluginEntry {
	id: string;
	version: string;
	defaultEnabled?: boolean;
	lifecycleManaged?: boolean;
	lifecycleEnablePath?: string;
	lifecycleDisablePath?: string;
	options: Record<string, unknown>;
	code: string;
	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: PluginStorageConfig;
	mcp?: PluginMcpManifestConfig;
	routes?: PluginManifest["routes"];
	hooks?: PluginManifest["hooks"];
	adminPages?: Array<{ path: string; label?: string; icon?: string }>;
	adminWidgets?: Array<{ id: string; title?: string; size?: string }>;
	settingsSchema?: Record<string, SettingField>;
	portableTextBlocks?: PortableTextBlockConfig[];
	fieldWidgets?: FieldWidgetConfig[];
	adminEntry?: string;
	preferred?: string[];
}

export interface MediaProviderEntry {
	id: string;
	name: string;
	icon?: string;
	capabilities: MediaProviderCapabilities;
	createProvider: (ctx: MediaProviderContext) => MediaProvider;
}

export interface MediaProviderContext {
	db: Kysely<Database>;
	getDb?: () => Kysely<Database>;
	storage: Storage | null;
}

export type CreateSchedulerFn = (executor: CronExecutor) => CronScheduler;

export interface RuntimeDependencies {
	config: EmDashConfig;
	migrationMode?: RuntimeMigrationMode;
	plugins: ResolvedPlugin[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createDialect: (config: any) => Dialect;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createCoalescingDialect?: (config: any) => Dialect | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createStorage: ((config: any) => Storage) | null;
	sandboxEnabled: boolean;
	sandboxBypassed?: boolean;
	createScheduler?: CreateSchedulerFn | null;
	mediaProviderEntries?: MediaProviderEntry[];
	sandboxedPluginEntries: SandboxedPluginEntry[];
	createSandboxRunner: SandboxRunnerFactory | null;
}

export interface EmDashRuntimeParts {
	db: Kysely<Database>;
	storage: Storage | null;
	configuredPlugins: ResolvedPlugin[];
	sandboxedPlugins: Map<string, SandboxedPluginInstance>;
	sandboxedPluginEntries: SandboxedPluginEntry[];
	hooks: HookPipeline;
	enabledPlugins: Set<string>;
	pluginStates: Map<string, string>;
	config: EmDashConfig;
	mediaProviders: Map<string, MediaProvider>;
	mediaProviderEntries: MediaProviderEntry[];
	cronExecutor: CronExecutor | null;
	cronScheduler: CronScheduler | null;
	emailPipeline: EmailPipeline | null;
	allPipelinePlugins: ResolvedPlugin[];
	pipelineFactoryOptions: {
		db: Kysely<Database>;
		getDb?: () => Kysely<Database>;
		beforeContentWrite?: () => Promise<void>;
		storage?: Storage;
		siteInfo?: {
			siteName?: string;
			siteUrl?: string;
			locale?: string;
			trailingSlash?: "always" | "never" | "ignore";
		};
	};
	runtimeDeps: RuntimeDependencies;
	pipelineRef: { current: HookPipeline };
}

function contentItemToRecord(item: ContentItemInternal): Record<string, unknown> {
	return { ...item };
}

export const DB_INIT_DEADLINE_MS = MIGRATION_RACE_WAIT_MS + 20_000;

const DB_HOLDER_KEY = Symbol.for("emdash:db-cache");
interface DbHolder {
	cache: Map<string, Kysely<Database>>;
	lock: InitLock;
	failures: Map<string, { at: number; message: string }>;
}
const globalSymbolStore = globalThis as Record<symbol, unknown>;
function getDbHolder(): DbHolder {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis symbol slot, written only below
	let holder = globalSymbolStore[DB_HOLDER_KEY] as DbHolder | undefined;
	if (!holder) {
		holder = {
			cache: new Map<string, Kysely<Database>>(),
			lock: createInitLock(),
			failures: new Map(),
		};
		globalSymbolStore[DB_HOLDER_KEY] = holder;
	}
	holder.failures ??= new Map();
	return holder;
}

const DB_INIT_FAILURE_BACKOFF_MS = 30_000;

const SEED_HOLDER_KEY = Symbol.for("emdash:seed-state");
interface SeedHolder {
	done: Set<string>;
	lock: InitLock;
}
function getSeedHolder(): SeedHolder {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis symbol slot, written only below
	let holder = globalSymbolStore[SEED_HOLDER_KEY] as SeedHolder | undefined;
	if (!holder) {
		holder = { done: new Set<string>(), lock: createInitLock() };
		globalSymbolStore[SEED_HOLDER_KEY] = holder;
	}
	return holder;
}
const storageCache = new Map<string, Storage>();
const sandboxedPluginCache = new Map<string, SandboxedPluginInstance>();
const marketplacePluginKeys = new Set<string>();
const registryPluginKeys = new Set<string>();
const marketplaceManifestCache = new Map<
	string,
	{
		id: string;
		version: string;
		admin?: {
			pages?: PluginAdminPage[];
			widgets?: PluginDashboardWidget[];
			settingsSchema?: Record<string, SettingField>;
		};
		mcp?: PluginMcpManifestConfig;
		storage?: PluginManifest["storage"];
	}
>();
const sandboxedRouteMetaCache = new Map<string, Map<string, RouteMeta>>();
let sandboxRunner: SandboxRunner | null = null;

export class EmDashRuntime {
	private readonly _db: Kysely<Database>;
	readonly storage: Storage | null;
	readonly configuredPlugins: ResolvedPlugin[];
	readonly sandboxedPlugins: Map<string, SandboxedPluginInstance>;
	readonly sandboxedPluginEntries: SandboxedPluginEntry[];
	get schemaRegistry(): SchemaRegistry {
		return new SchemaRegistry(this.db);
	}
	private _hooks!: HookPipeline;
	readonly config: EmDashConfig;
	readonly mediaProviders: Map<string, MediaProvider>;
	readonly mediaProviderEntries: MediaProviderEntry[];
	readonly cronExecutor: CronExecutor | null;
	readonly email: EmailPipeline | null;

	private cronScheduler: CronScheduler | null;
	private enabledPlugins: Set<string>;
	private pluginStates: Map<string, string>;

	private readonly _searchHealthCache = createSingleFlightCache<void>();

	get hooks(): HookPipeline {
		return this._hooks;
	}

	private allPipelinePlugins: ResolvedPlugin[];
	private storageIndexesSynced = false;
	private pipelineFactoryOptions: {
		db: Kysely<Database>;
		getDb?: () => Kysely<Database>;
		beforeContentWrite?: () => Promise<void>;
		storage?: Storage;
		siteInfo?: {
			siteName?: string;
			siteUrl?: string;
			locale?: string;
			trailingSlash?: "always" | "never" | "ignore";
		};
	};
	private runtimeDeps: RuntimeDependencies;
	private pipelineRef!: { current: HookPipeline };

	get db(): Kysely<Database> {
		const ctx = getRequestContext();
		if (ctx?.db) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- db in context is set by middleware with correct type
			return ctx.db as Kysely<Database>;
		}
		return this._db;
	}

	constructor(parts: EmDashRuntimeParts) {
		this._db = parts.db;
		this.storage = parts.storage;
		this.configuredPlugins = parts.configuredPlugins;
		this.sandboxedPlugins = parts.sandboxedPlugins;
		this.sandboxedPluginEntries = parts.sandboxedPluginEntries;
		this._hooks = parts.hooks;
		this.enabledPlugins = parts.enabledPlugins;
		this.pluginStates = parts.pluginStates;
		this.config = parts.config;
		this.mediaProviders = parts.mediaProviders;
		this.mediaProviderEntries = parts.mediaProviderEntries;
		this.cronExecutor = parts.cronExecutor;
		this.cronScheduler = parts.cronScheduler;
		this.email = parts.emailPipeline;
		this.allPipelinePlugins = parts.allPipelinePlugins;
		this.pipelineFactoryOptions = parts.pipelineFactoryOptions;
		this.runtimeDeps = parts.runtimeDeps;
		this.pipelineRef = parts.pipelineRef;
	}

	getSandboxRunner(): SandboxRunner | null {
		return sandboxRunner;
	}

	isSandboxBypassed(): boolean {
		return this.runtimeDeps.sandboxBypassed === true;
	}

	async publishScheduled(): Promise<PublishedRef[]> {
		return this.publishScheduledWithFence();
	}

	private async publishScheduledWithFence(
		onPublished?: (refs: PublishedRef[]) => Promise<void>,
	): Promise<PublishedRef[]> {
		await assertMediaUsageActivationWriteAllowed(this.db);
		return publishDueContent(this.db, {
			publish: (collection, id, options) => this.handleContentPublish(collection, id, options),
			onPublished,
		});
	}

	async runScheduledTasks(
		options: {
			onPublished?: (refs: PublishedRef[]) => Promise<void>;
		} = {},
	): Promise<{ published: PublishedRef[] }> {
		if (this.cronExecutor) {
			try {
				await this.cronExecutor.tick();
			} catch (error) {
				console.error("[cron] Tick failed:", error);
			}
			try {
				await this.cronExecutor.recoverStaleLocks();
			} catch (error) {
				console.error("[cron] Stale lock recovery failed:", error);
			}
		}

		let published: PublishedRef[] = [];
		try {
			published = await this.publishScheduledWithFence(options.onPublished);
		} catch (error) {
			console.error("[scheduled-publish] Sweep failed:", error);
		}

		try {
			await runSystemCleanup(this.db, this.storage ?? undefined);
		} catch (error) {
			console.error("[cleanup] System cleanup failed:", error);
		}

		try {
			await this.syncPluginStorageIndexesOnce();
		} catch (error) {
			console.error("[plugins] Storage index sync failed:", error);
		}

		await maybeRunScheduledBackup(this.db, this.storage ?? undefined);
		await recordSchedulerHeartbeatSafely(this.db);

		return { published };
	}

	async syncPluginStorageIndexesOnce(): Promise<void> {
		if (this.storageIndexesSynced) return;
		this.storageIndexesSynced = true;
		await syncDeclaredStorageIndexes(this.db, [
			...this.allPipelinePlugins,
			...marketplaceManifestCache.values(),
		]);
	}

	async stopCron(): Promise<void> {
		if (this.cronScheduler) {
			await this.cronScheduler.stop();
		}
	}

	async setPluginStatus(pluginId: string, status: "active" | "inactive"): Promise<void> {
		const wasEnabled = this.enabledPlugins.has(pluginId);
		const previousStatus = this.pluginStates.get(pluginId);
		if (previousStatus === status && wasEnabled === (status === "active")) {
			await setCronTasksEnabled(this.db, pluginId, status === "active");
			return;
		}
		try {
			if (status === "active") {
				this.enabledPlugins.add(pluginId);
				await this.rebuildHookPipeline();
				const failed = (await this._hooks.runPluginActivate(pluginId)).find(
					(result) => !result.success,
				);
				if (failed) throw failed.error ?? new Error(`Plugin activation failed: ${pluginId}`);
			} else {
				const failed = (await this._hooks.runPluginDeactivate(pluginId)).find(
					(result) => !result.success,
				);
				if (failed) throw failed.error ?? new Error(`Plugin deactivation failed: ${pluginId}`);
				this.enabledPlugins.delete(pluginId);
				await this.rebuildHookPipeline();
			}
			await setCronTasksEnabled(this.db, pluginId, status === "active");
			this.pluginStates.set(pluginId, status);
		} catch (error) {
			let cleanupError: Error | undefined;
			if (status === "active" && !wasEnabled) {
				const failed = (await this._hooks.runPluginDeactivate(pluginId)).find(
					(result) => !result.success,
				);
				cleanupError = failed?.error;
			}
			if (wasEnabled) this.enabledPlugins.add(pluginId);
			else this.enabledPlugins.delete(pluginId);
			if (previousStatus === undefined) this.pluginStates.delete(pluginId);
			else this.pluginStates.set(pluginId, previousStatus);
			await this.rebuildHookPipeline();
			await setCronTasksEnabled(this.db, pluginId, wasEnabled);
			if (cleanupError)
				// oxlint-disable-next-line preserve-caught-error -- AggregateError accepts cause in its third argument.
				throw new AggregateError(
					[error, cleanupError],
					`Plugin lifecycle cleanup failed: ${pluginId}`,
					{ cause: error },
				);
			throw error;
		}
	}

	private async rebuildHookPipeline(): Promise<void> {
		const enabledList = this.allPipelinePlugins.filter((p) => this.enabledPlugins.has(p.id));
		const newPipeline = createHookPipeline(enabledList, this.pipelineFactoryOptions);

		await EmDashRuntime.resolveExclusiveHooks(newPipeline, this.db, this.runtimeDeps);

		if (this.email) {
			newPipeline.setContextFactory({ emailPipeline: this.email });
		}
		newPipeline.setContextFactory({
			cronReschedule: () => this.cronScheduler?.reschedule(),
		});

		if (this.email) {
			this.email.setPipeline(newPipeline);
		}

		this.pipelineRef.current = newPipeline;

		this._hooks = newPipeline;
	}

	async syncMarketplacePlugins(): Promise<void> {
		if (!this.config.marketplace) return;

		if (this.runtimeDeps.sandboxBypassed) {
			await this.syncMarketplacePluginsBypassed();
			return;
		}

		await this.syncSandboxedSourcePlugins("marketplace");
	}

	async syncRegistryPlugins(): Promise<void> {
		if (!this.config.experimental?.registry) return;
		await this.syncSandboxedSourcePlugins("registry");
	}

	private async syncSandboxedSourcePlugins(source: "marketplace" | "registry"): Promise<void> {
		if (!this.storage) return;
		if (!sandboxRunner || !sandboxRunner.isAvailable()) return;

		const keySet = source === "marketplace" ? marketplacePluginKeys : registryPluginKeys;

		try {
			const stateRepo = new PluginStateRepository(this.db);
			const states =
				source === "marketplace"
					? await stateRepo.getMarketplacePlugins()
					: await stateRepo.getRegistryPlugins();

			const desired = new Map<string, string>();
			for (const state of states) {
				this.pluginStates.set(state.pluginId, state.status);
				if (state.status === "active") {
					this.enabledPlugins.add(state.pluginId);
				} else {
					this.enabledPlugins.delete(state.pluginId);
				}
				if (state.status !== "active") continue;
				const desiredVersion =
					source === "marketplace" ? (state.marketplaceVersion ?? state.version) : state.version;
				desired.set(state.pluginId, desiredVersion);
			}

			const keysToRemove: string[] = [];
			for (const key of keySet) {
				const [pluginId] = key.split(":");
				if (!pluginId) continue;
				const desiredVersion = desired.get(pluginId);
				if (desiredVersion && key === `${pluginId}:${desiredVersion}`) continue;
				keysToRemove.push(key);
			}

			for (const key of keysToRemove) {
				const [pluginId] = key.split(":");
				if (!pluginId) continue;
				const desiredVersion = desired.get(pluginId);
				if (!desiredVersion) {
					this.pluginStates.delete(pluginId);
					this.enabledPlugins.delete(pluginId);
				}

				const existing = sandboxedPluginCache.get(key);
				if (existing) {
					try {
						await existing.terminate();
					} catch (error) {
						console.warn(`EmDash: Failed to terminate sandboxed plugin ${key}:`, error);
					}
				}

				sandboxedPluginCache.delete(key);
				this.sandboxedPlugins.delete(key);
				keySet.delete(key);
				if (pluginId) {
					sandboxedRouteMetaCache.delete(pluginId);
					marketplaceManifestCache.delete(pluginId);
				}
			}

			for (const [pluginId, version] of desired) {
				const key = `${pluginId}:${version}`;
				if (sandboxedPluginCache.has(key)) {
					keySet.add(key);
					continue;
				}

				const bundle = await loadBundleFromR2(this.storage, pluginId, version, source);
				if (!bundle) {
					console.warn(`EmDash: ${source} plugin ${pluginId}@${version} not found in R2`);
					continue;
				}

				const loaded = await sandboxRunner.load(bundle.manifest, bundle.backendCode);
				sandboxedPluginCache.set(key, loaded);
				this.sandboxedPlugins.set(key, loaded);
				keySet.add(key);

				marketplaceManifestCache.set(pluginId, {
					id: bundle.manifest.id,
					version: bundle.manifest.version,
					admin: bundle.manifest.admin,
					mcp: bundle.manifest.mcp,
					storage: bundle.manifest.storage,
				});

				if (bundle.manifest.routes.length > 0) {
					const routeMetaMap = new Map<string, RouteMeta>();
					for (const entry of bundle.manifest.routes) {
						const normalized = normalizeManifestRoute(entry);
						routeMetaMap.set(normalized.name, buildRouteMeta(normalized));
					}
					sandboxedRouteMetaCache.set(pluginId, routeMetaMap);
				} else {
					sandboxedRouteMetaCache.delete(pluginId);
				}
			}
		} catch (error) {
			console.error(`EmDash: Failed to sync ${source} plugins:`, error);
		}
	}

	private removePluginFromLists(pluginId: string): void {
		const allIdx = this.allPipelinePlugins.findIndex((p) => p.id === pluginId);
		if (allIdx !== -1) this.allPipelinePlugins.splice(allIdx, 1);
		const configIdx = this.configuredPlugins.findIndex((p) => p.id === pluginId);
		if (configIdx !== -1) this.configuredPlugins.splice(configIdx, 1);
	}

	private async syncMarketplacePluginsBypassed(): Promise<void> {
		if (!this.storage) return;
		try {
			const stateRepo = new PluginStateRepository(this.db);
			const marketplaceStates = await stateRepo.getMarketplacePlugins();

			const desired = new Map<string, string>();
			for (const state of marketplaceStates) {
				this.pluginStates.set(state.pluginId, state.status);
				if (state.status === "active") {
					this.enabledPlugins.add(state.pluginId);
				} else {
					this.enabledPlugins.delete(state.pluginId);
				}
				if (state.status !== "active") continue;
				desired.set(state.pluginId, state.marketplaceVersion ?? state.version);
			}

			const toRemove: string[] = [];
			for (const pluginId of marketplaceManifestCache.keys()) {
				if (!desired.has(pluginId)) toRemove.push(pluginId);
			}
			for (const pluginId of toRemove) {
				const resolved = this.allPipelinePlugins.find((p) => p.id === pluginId);
				if (resolved) {
					try {
						const deactivateHook = resolved.hooks?.["plugin:deactivate"];
						if (deactivateHook) {
							const handler =
								typeof deactivateHook === "function" ? deactivateHook : deactivateHook.handler;
							if (typeof handler === "function") {
								// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- best-effort cleanup; see comment above
								await handler({ pluginId }, {} as never);
							}
						}
					} catch (err) {
						console.warn(`[emdash] plugin:deactivate hook failed for ${pluginId}:`, err);
					}
				}
				marketplaceManifestCache.delete(pluginId);
				sandboxedRouteMetaCache.delete(pluginId);
				this.removePluginFromLists(pluginId);
				this.enabledPlugins.delete(pluginId);
			}

			const { adaptSandboxEntry } = await import("./plugins/adapt-sandbox-entry.js");
			const newPlugins: ResolvedPlugin[] = [];
			for (const [pluginId, version] of desired) {
				const bundle = await loadBundleFromR2(this.storage, pluginId, version);
				if (!bundle) {
					console.warn(`EmDash: Marketplace plugin ${pluginId}@${version} not found in R2`);
					continue;
				}
				marketplaceManifestCache.set(pluginId, {
					id: bundle.manifest.id,
					version: bundle.manifest.version,
					admin: bundle.manifest.admin,
					mcp: bundle.manifest.mcp,
					storage: bundle.manifest.storage,
				});
				if (bundle.manifest.routes.length > 0) {
					const routeMetaMap = new Map<string, RouteMeta>();
					for (const entry of bundle.manifest.routes) {
						const normalized = normalizeManifestRoute(entry);
						routeMetaMap.set(normalized.name, buildRouteMeta(normalized));
					}
					sandboxedRouteMetaCache.set(pluginId, routeMetaMap);
				} else {
					sandboxedRouteMetaCache.delete(pluginId);
				}

				const existing = this.allPipelinePlugins.find((p) => p.id === pluginId);
				if (existing && existing.version === bundle.manifest.version) continue;

				if (existing) {
					this.removePluginFromLists(pluginId);
				}

				try {
					const dataUrl = `data:text/javascript;base64,${Buffer.from(bundle.backendCode).toString("base64")}`;
					// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- dynamic module from trusted bundle
					const pluginModule = (await import(/* @vite-ignore */ dataUrl)) as Record<
						string,
						unknown
					>;
					const pluginDef = (pluginModule.default ?? pluginModule) as Parameters<
						typeof adaptSandboxEntry
					>[0];
					const adapted = adaptSandboxEntry(pluginDef, {
						id: bundle.manifest.id,
						version: bundle.manifest.version,
						entrypoint: "",
						capabilities: bundle.manifest.capabilities ?? [],
						allowedHosts: bundle.manifest.allowedHosts ?? [],
						// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- adaptSandboxEntry copies storage through
						storage: (bundle.manifest.storage ?? {}) as never,
						adminPages: bundle.manifest.admin?.pages,
						adminWidgets: bundle.manifest.admin?.widgets?.map((w) => ({
							id: w.id,
							title: w.title,
							size:
								w.size === "full" || w.size === "half" || w.size === "third" ? w.size : undefined,
						})),
						settingsSchema: bundle.manifest.admin?.settingsSchema,
					});
					newPlugins.push(adapted);
					this.allPipelinePlugins.push(adapted);
					this.configuredPlugins.push(adapted);
					this.enabledPlugins.add(adapted.id);
				} catch (error) {
					console.error(
						`EmDash: Failed to load marketplace plugin ${pluginId}@${version} in-process:`,
						error,
					);
				}
			}

			if (toRemove.length > 0 || newPlugins.length > 0) {
				await this.rebuildHookPipeline();
			}
		} catch (error) {
			console.error("EmDash: Failed to sync marketplace plugins (bypass):", error);
		}
	}

	static async create(
		deps: RuntimeDependencies,
		timings?: Array<{ name: string; dur: number; desc?: string }>,
	): Promise<EmDashRuntime> {
		const phase = async <T>(name: string, desc: string, fn: () => Promise<T>): Promise<T> => {
			if (!timings) return fn();
			const t0 = performance.now();
			try {
				return await fn();
			} finally {
				timings.push({ name, dur: performance.now() - t0, desc });
			}
		};

		const db = await phase("rt.db", "DB init + migration policy", () =>
			EmDashRuntime.getDatabase(deps),
		);

		const resolveDb = (): Kysely<Database> => {
			const ctx = getRequestContext();
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- ALS db is typed unknown to avoid a circular import; middleware always sets a Kysely<Database>
			return (ctx?.db as Kysely<Database> | undefined) ?? db;
		};

		await phase("rt.secrets", "Validate encryption key", () => validateEncryptionKeyAtStartup());

		const storage = EmDashRuntime.getStorage(deps);

		let pluginStates: Map<string, string> = new Map();
		const configuredLocales: string[] =
			virtualConfig?.i18n?.locales ?? getI18nConfig()?.locales ?? [];
		const localeCasingRepairVersion = getLocaleCasingRepairVersion(configuredLocales);
		let storedLocaleCasingRepairVersion: string | undefined;
		let siteInfo:
			| {
					siteName?: string;
					siteUrl?: string;
					locale?: string;
					trailingSlash?: "always" | "never" | "ignore";
			  }
			| undefined;
		let seedGate = { collectionCount: 1, setupDone: true };

		const reqCtx = getRequestContext();
		const ownsConfiguredDb = !!deps.config.database && !(reqCtx?.dbIsIsolated && reqCtx.db);

		let readDb = db;
		let readDbDisposable: Kysely<Database> | undefined;
		const disposeReadDb = async () => {
			const disposable = readDbDisposable;
			readDbDisposable = undefined;
			if (!disposable) return;
			try {
				await disposable.destroy();
			} catch {}
		};
		if (ownsConfiguredDb && deps.createCoalescingDialect && deps.config.database) {
			try {
				const dialect = deps.createCoalescingDialect(deps.config.database.config);
				if (dialect) {
					readDb = new Kysely<Database>({ dialect, log: kyselyLogOption() });
					readDbDisposable = readDb;
				}
			} catch {
				readDb = db;
			}
		}
		const optionsRepo = new OptionsRepository(readDb);
		let missingManualSchemaError: unknown;
		const captureMissingManualSchema = (error: unknown) => {
			if ((deps.migrationMode ?? "auto") === "manual" && isMissingTableError(error)) {
				missingManualSchemaError ??= error;
			}
		};

		const readSiteInfo = async () => {
			const siteOpts = await optionsRepo.getMany<string>([
				"emdash:site_title",
				"emdash:site_url",
				"emdash:locale",
				LOCALE_CASING_REPAIR_OPTION,
			]);
			storedLocaleCasingRepairVersion = siteOpts.get(LOCALE_CASING_REPAIR_OPTION);
			return {
				siteName: siteOpts.get("emdash:site_title") ?? undefined,
				siteUrl: siteOpts.get("emdash:site_url") ?? undefined,
				locale: siteOpts.get("emdash:locale") ?? undefined,
				trailingSlash: virtualConfig?.trailingSlash,
			};
		};

		const coldStartReads: Array<Promise<void>> = [
			phase("rt.plugins", "Plugin states", async () => {
				try {
					const states = await readDb
						.selectFrom("_plugin_state")
						.select(["plugin_id", "status"])
						.execute();
					pluginStates = new Map(states.map((s) => [s.plugin_id, s.status]));
				} catch (error) {
					captureMissingManualSchema(error);
				}
			}),
			phase("rt.site", "Site info options", async () => {
				try {
					siteInfo = await readSiteInfo();
				} catch (error) {
					captureMissingManualSchema(error);
				}
			}),
		];

		if (ownsConfiguredDb) {
			coldStartReads.push(
				phase("rt.seedcheck", "Auto-seed gate", async () => {
					try {
						const [collectionCount, setupOption] = await Promise.all([
							readDb
								.selectFrom("_emdash_collections")
								.select((eb) => eb.fn.countAll<number>().as("count"))
								.executeTakeFirstOrThrow(),
							readDb
								.selectFrom("options")
								.select("value")
								.where("name", "=", "emdash:setup_complete")
								.executeTakeFirst(),
						]);
						const setupDone = (() => {
							try {
								return !!setupOption && JSON.parse(setupOption.value) === true;
							} catch {
								return false;
							}
						})();
						seedGate = { collectionCount: collectionCount.count, setupDone };
					} catch (error) {
						captureMissingManualSchema(error);
					}
				}),
			);
		}

		await Promise.all(coldStartReads);
		if (missingManualSchemaError) {
			await disposeReadDb();
			throw missingManualSchemaError;
		}

		if (
			localeCasingRepairVersion &&
			(configuredLocales.some(
				(locale) => locale.includes("-") || locale !== locale.toLowerCase(),
			) ||
				storedLocaleCasingRepairVersion !== undefined) &&
			storedLocaleCasingRepairVersion !== localeCasingRepairVersion
		) {
			await phase("rt.locale", "Repair locale casing", async () => {
				await repairLocaleCasing(db, configuredLocales);
				await new OptionsRepository(db).set(LOCALE_CASING_REPAIR_OPTION, localeCasingRepairVersion);
			});
		}

		if (seedGate.collectionCount === 0 && !seedGate.setupDone) {
			try {
				const activation = await activateMediaUsageCapture(db, { writersDrained: true });
				if (activation.outcome !== "active") {
					throw new Error("Fresh-site media usage activation did not complete");
				}
			} catch (error) {
				await disposeReadDb();
				throw error;
			}
			const seedKey = deps.config.database?.entrypoint ?? "default";
			const seedHolder = getSeedHolder();
			try {
				await initWithLock(
					seedHolder.lock,
					() => (seedHolder.done.has(seedKey) ? true : undefined),
					async () => {
						const { applySeed } = await import("./seed/apply.js");
						const { loadSeed } = await import("./seed/load.js");
						const { validateSeed } = await import("./seed/validate.js");

						const seed = await loadSeed();
						const validation = validateSeed(seed);
						if (validation.valid) {
							await applySeed(db, seed, { onConflict: "skip" });
							console.log("Auto-seeded default collections");
						}
						seedHolder.done.add(seedKey);
						return true;
					},
					{ deadlineMs: DB_INIT_DEADLINE_MS, anchor: (promise) => after(() => promise) },
				);
				try {
					siteInfo = await readSiteInfo();
				} catch {}
			} catch {}
		}

		await disposeReadDb();

		const enabledPlugins = new Set<string>();
		for (const plugin of deps.plugins) {
			const status = pluginStates.get(plugin.id);
			if (status === undefined || status === "active") {
				enabledPlugins.add(plugin.id);
			}
		}

		const allPipelinePlugins: ResolvedPlugin[] = [...deps.plugins];

		const bypassedPluginsList: ResolvedPlugin[] = [];

		if (import.meta.env.DEV) {
			try {
				const devConsolePlugin = definePlugin({
					id: DEV_CONSOLE_EMAIL_PLUGIN_ID,
					version: "0.0.0",
					capabilities: ["hooks.email-transport:register"],
					hooks: {
						"email:deliver": {
							exclusive: true,
							handler: devConsoleEmailDeliver,
						},
					},
				});
				allPipelinePlugins.push(devConsolePlugin);
				enabledPlugins.add(devConsolePlugin.id);
			} catch (error) {
				console.warn("[email] Failed to register dev console email provider:", error);
			}
		}

		try {
			const defaultModeratorPlugin = definePlugin({
				id: DEFAULT_COMMENT_MODERATOR_PLUGIN_ID,
				version: "0.0.0",
				capabilities: ["users:read"],
				hooks: {
					"comment:moderate": {
						exclusive: true,
						handler: defaultCommentModerate,
					},
				},
			});
			allPipelinePlugins.push(defaultModeratorPlugin);
			enabledPlugins.add(defaultModeratorPlugin.id);
		} catch (error) {
			console.warn("[comments] Failed to register default moderator:", error);
		}

		if (deps.sandboxBypassed && deps.sandboxedPluginEntries.length > 0) {
			const isCfWorkers =
				typeof navigator !== "undefined" &&
				typeof navigator.userAgent === "string" &&
				navigator.userAgent.includes("Cloudflare-Workers");
			if (isCfWorkers) {
				throw new Error(
					"sandbox: false is not supported in Cloudflare Workers. " +
						"Remove the sandbox: false option or use the Cloudflare sandbox runner.",
				);
			}
			console.info(
				"EmDash: Sandbox disabled (sandbox: false). " +
					"Sandboxed plugins will run in-process without isolation.",
			);
			const bypassedPlugins = await EmDashRuntime.loadBypassedPlugins(deps.sandboxedPluginEntries);
			for (const plugin of bypassedPlugins) {
				allPipelinePlugins.push(plugin);
				bypassedPluginsList.push(plugin);
				const status = pluginStates.get(plugin.id);
				const configured = deps.sandboxedPluginEntries.find((entry) => entry.id === plugin.id);
				if (isPluginStateEnabled(status, configured?.defaultEnabled)) {
					enabledPlugins.add(plugin.id);
				}
			}
		}

		if (deps.sandboxBypassed && deps.config.marketplace && storage) {
			const marketplaceBypassed = await EmDashRuntime.loadMarketplacePluginsBypassed(db, storage);
			for (const plugin of marketplaceBypassed) {
				allPipelinePlugins.push(plugin);
				bypassedPluginsList.push(plugin);
				const status = pluginStates.get(plugin.id);
				if (status === undefined || status === "active") {
					enabledPlugins.add(plugin.id);
				}
			}
		}

		const enabledPluginList = allPipelinePlugins.filter((p) => enabledPlugins.has(p.id));

		const pipelineFactoryOptions = {
			db,
			getDb: resolveDb,
			beforeContentWrite: () => assertMediaUsageActivationWriteAllowed(resolveDb()),
			storage: storage ?? undefined,
			siteInfo,
		};
		const pipeline = createHookPipeline(enabledPluginList, pipelineFactoryOptions);

		const sandboxedPlugins = await phase("rt.sandbox", "Sandboxed plugins", () =>
			EmDashRuntime.loadSandboxedPlugins(deps, db, storage, siteInfo),
		);

		const installedTierPhases: Promise<void>[] = [];
		if (deps.config.marketplace && storage && !deps.sandboxBypassed) {
			installedTierPhases.push(
				phase("rt.market", "Marketplace plugins", () =>
					EmDashRuntime.loadInstalledSandboxedPlugins(
						"marketplace",
						db,
						storage,
						deps,
						sandboxedPlugins,
						siteInfo,
					),
				),
			);
		}

		if (deps.config.experimental?.registry && storage) {
			installedTierPhases.push(
				phase("rt.registry", "Registry plugins", () =>
					EmDashRuntime.loadInstalledSandboxedPlugins(
						"registry",
						db,
						storage,
						deps,
						sandboxedPlugins,
						siteInfo,
					),
				),
			);
		}
		if (installedTierPhases.length > 0) {
			await Promise.all(installedTierPhases);
		}

		const mediaProviders = new Map<string, MediaProvider>();
		const mediaProviderEntries = deps.mediaProviderEntries ?? [];
		const providerContext: MediaProviderContext = { db, storage, getDb: resolveDb };

		for (const entry of mediaProviderEntries) {
			try {
				const provider = entry.createProvider(providerContext);
				mediaProviders.set(entry.id, provider);
			} catch (error) {
				console.warn(`Failed to initialize media provider "${entry.id}":`, error);
			}
		}

		await phase("rt.hooks", "Exclusive hook resolution", () =>
			EmDashRuntime.resolveExclusiveHooks(pipeline, db, deps),
		);

		const emailPipeline = new EmailPipeline(pipeline);

		if (sandboxRunner) {
			sandboxRunner.setEmailSend((message, pluginId) => emailPipeline.send(message, pluginId));
		}

		const pipelineRef = { current: pipeline };
		const invokeCronHook: InvokeCronHookFn = async (pluginId, event) => {
			const result = await pipelineRef.current.invokeCronHook(pluginId, event);
			if (!result.success && result.error) {
				throw result.error;
			}
		};

		pipeline.setContextFactory({ emailPipeline });

		let cronExecutor: CronExecutor | null = null;
		let cronScheduler: CronScheduler | null = null;
		const runtimeRef: { current: EmDashRuntime | null } = { current: null };

		await phase("rt.cron", "Cron init (recovery deferred post-response)", async () => {
			try {
				cronExecutor = new CronExecutor(resolveDb, invokeCronHook);
				pipeline.setContextFactory({
					cronReschedule: () => cronScheduler?.reschedule(),
				});

				const executorForRecovery = cronExecutor;
				after(async () => {
					try {
						const recovered = await executorForRecovery.recoverStaleLocks();
						if (recovered > 0) {
							console.log(`[cron] Recovered ${recovered} stale task lock(s)`);
						}
					} catch (error) {
						console.error("[cron] Failed to recover stale task locks:", error);
					}
				});

				if (deps.createScheduler) {
					const scheduler = deps.createScheduler(cronExecutor);
					cronScheduler = scheduler;

					scheduler.setSystemCleanup(async () => {
						try {
							const runtime = runtimeRef.current;
							if (runtime) {
								await runtime.publishScheduled();
							} else {
								await assertMediaUsageActivationWriteAllowed(db);
								await publishDueContent(db);
							}
						} catch (error) {
							console.error("[scheduled-publish] Sweep failed:", error);
						}
						try {
							await runSystemCleanup(db, storage ?? undefined);
						} catch (error) {
							console.error("[cleanup] System cleanup failed:", error);
						}
						try {
							await runtimeRef.current?.syncPluginStorageIndexesOnce();
						} catch (error) {
							console.error("[plugins] Storage index sync failed:", error);
						}
						await maybeRunScheduledBackup(db, storage ?? undefined);
						await recordSchedulerHeartbeatSafely(db);
					});
					void scheduler.start();
				}
			} catch (error) {
				console.warn("[cron] Failed to initialize cron system:", error);
			}
		});

		const runtime = new EmDashRuntime({
			db,
			storage,
			configuredPlugins: [...deps.plugins, ...bypassedPluginsList],
			sandboxedPlugins,
			sandboxedPluginEntries: deps.sandboxedPluginEntries,
			hooks: pipeline,
			enabledPlugins,
			pluginStates,
			config: deps.config,
			mediaProviders,
			mediaProviderEntries,
			cronExecutor,
			cronScheduler,
			emailPipeline,
			allPipelinePlugins,
			pipelineFactoryOptions,
			runtimeDeps: deps,
			pipelineRef,
		});
		runtimeRef.current = runtime;
		return runtime;
	}

	getMediaProvider(providerId: string): MediaProvider | undefined {
		return this.mediaProviders.get(providerId);
	}

	getMediaProviderList(): Array<{
		id: string;
		name: string;
		icon?: string;
		capabilities: MediaProviderCapabilities;
	}> {
		return this.mediaProviderEntries.map((e) => ({
			id: e.id,
			name: e.name,
			icon: e.icon,
			capabilities: e.capabilities,
		}));
	}

	private static async getDatabase(deps: RuntimeDependencies): Promise<Kysely<Database>> {
		const ctx = getRequestContext();
		if (ctx?.dbIsIsolated && ctx.db) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- db in context is typed as unknown to avoid circular deps
			return ctx.db as Kysely<Database>;
		}

		const dbConfig = deps.config.database;

		if (!dbConfig) {
			try {
				return await getDb();
			} catch {
				throw new Error(
					"EmDash database not configured. Either configure database in astro.config.mjs or use emdashLoader in live.config.ts",
				);
			}
		}

		const cacheKey = dbConfig.entrypoint;

		const holder = getDbHolder();

		const throwIfBackingOff = () => {
			const failure = holder.failures.get(cacheKey);
			if (!failure) return;
			if (Date.now() - failure.at < DB_INIT_FAILURE_BACKOFF_MS) {
				throw new Error(
					`Database initialization is backing off after a recent migration failure: ${failure.message}`,
				);
			}
			holder.failures.delete(cacheKey);
		};
		throwIfBackingOff();

		return initWithLock(
			holder.lock,
			() => holder.cache.get(cacheKey),
			async (isCurrentClaim) => {
				throwIfBackingOff();

				const dialect = deps.createDialect(dbConfig.config);
				const db = new Kysely<Database>({ dialect, log: kyselyLogOption() });

				try {
					await enforceRuntimeMigrationPolicy(db, deps.migrationMode ?? "auto");
				} catch (error) {
					if (
						!(error instanceof ConcurrentMigrationTimeoutError) &&
						!(error instanceof PendingMigrationsError)
					) {
						holder.failures.set(cacheKey, {
							at: Date.now(),
							message: error instanceof Error ? error.message : String(error),
						});
					}
					await db.destroy().catch(() => {});
					throw error;
				}
				holder.failures.delete(cacheKey);

				if (isCurrentClaim()) {
					holder.cache.set(cacheKey, db);
				}
				return db;
			},
			{
				deadlineMs: DB_INIT_DEADLINE_MS,
				anchor: (promise) => after(() => promise),
			},
		);
	}

	private static getStorage(deps: RuntimeDependencies): Storage | null {
		const storageConfig = deps.config.storage;
		if (!storageConfig || !deps.createStorage) {
			return null;
		}

		const cacheKey = storageConfig.entrypoint;
		const cached = storageCache.get(cacheKey);
		if (cached) {
			return cached;
		}

		const storage = deps.createStorage(storageConfig.config);
		storageCache.set(cacheKey, storage);
		return storage;
	}

	private static async loadBypassedPlugins(
		entries: SandboxedPluginEntry[],
	): Promise<ResolvedPlugin[]> {
		const { adaptSandboxEntry } = await import("./plugins/adapt-sandbox-entry.js");
		const plugins: ResolvedPlugin[] = [];
		for (const entry of entries) {
			try {
				const dataUrl = `data:text/javascript;base64,${Buffer.from(entry.code).toString("base64")}`;
				// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- dynamic module from trusted bundle (built by plugin-cli); adaptSandboxEntry validates required fields.
				const pluginModule = (await import(/* @vite-ignore */ dataUrl)) as Record<string, unknown>;
				const pluginDef = (pluginModule.default ?? pluginModule) as Parameters<
					typeof adaptSandboxEntry
				>[0];
				// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- adaptSandboxEntry copies storage through to PluginStorageConfig which supports composite indexes
				const adminPages = entry.adminPages?.map((p) => ({
					path: p.path,
					label: p.label ?? p.path,
					icon: p.icon,
				}));
				const adminWidgets:
					| Array<{
							id: string;
							title?: string;
							size?: "full" | "half" | "third";
					  }>
					| undefined = entry.adminWidgets?.map((w) => {
					const size: "full" | "half" | "third" | undefined =
						w.size === "full" || w.size === "half" || w.size === "third" ? w.size : undefined;
					return { id: w.id, title: w.title, size };
				});
				const resolved = adaptSandboxEntry(pluginDef, {
					id: entry.id,
					version: entry.version,
					entrypoint: "",
					capabilities: entry.capabilities,
					allowedHosts: entry.allowedHosts,
					// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- adaptSandboxEntry copies storage through
					storage: entry.storage as never,
					adminPages,
					adminWidgets,
					settingsSchema: entry.settingsSchema,
					portableTextBlocks: entry.portableTextBlocks,
					fieldWidgets: entry.fieldWidgets,
				});
				plugins.push(resolved);
				console.log(
					`EmDash: Loaded plugin ${entry.id}:${entry.version} in-process (sandbox bypassed)`,
				);
			} catch (error) {
				console.error(`EmDash: Failed to load sandboxed plugin ${entry.id} in-process:`, error);
			}
		}
		return plugins;
	}

	private static async loadSandboxedPlugins(
		deps: RuntimeDependencies,
		db: Kysely<Database>,
		mediaStorage?: Storage | null,
		siteInfo?: {
			siteName?: string;
			siteUrl?: string;
			locale?: string;
			trailingSlash?: "always" | "never" | "ignore";
		},
	): Promise<Map<string, SandboxedPluginInstance>> {
		if (sandboxedPluginCache.size > 0) {
			return sandboxedPluginCache;
		}

		if (!deps.sandboxEnabled) {
			return sandboxedPluginCache;
		}

		if (!sandboxRunner && deps.createSandboxRunner) {
			sandboxRunner = deps.createSandboxRunner(
				createSandboxRunnerOptions(
					{
						db,
						beforeContentWrite: () => assertMediaUsageActivationWriteAllowed(db),
						mediaStorage: mediaStorage
							? {
									upload: (opts) =>
										mediaStorage.upload({
											key: opts.key,
											body: opts.body,
											contentType: opts.contentType,
										}),
									delete: (key) => mediaStorage.delete(key),
								}
							: undefined,
					},
					siteInfo,
				),
			);
		}

		if (!sandboxRunner) {
			return sandboxedPluginCache;
		}

		if (!sandboxRunner.isAvailable()) {
			console.warn(
				"EmDash: Plugin sandbox is configured but not available on this platform. " +
					"Sandboxed plugins will not be loaded. " +
					"If using @emdash-cms/sandbox-workerd/sandbox, ensure workerd is installed.",
			);
			return sandboxedPluginCache;
		}

		if (deps.sandboxedPluginEntries.length === 0) {
			return sandboxedPluginCache;
		}

		if (deps.sandboxBypassed) {
			return sandboxedPluginCache;
		}

		for (const entry of deps.sandboxedPluginEntries) {
			const pluginKey = `${entry.id}:${entry.version}`;
			if (sandboxedPluginCache.has(pluginKey)) {
				continue;
			}

			try {
				const manifest: PluginManifest = {
					id: entry.id,
					version: entry.version,
					capabilities: entry.capabilities ?? [],
					allowedHosts: entry.allowedHosts ?? [],
					storage: entry.storage ?? {},
					hooks: entry.hooks ?? [],
					routes: entry.routes ?? [],
					admin: {},
					mcp: entry.mcp,
				};

				const plugin = await sandboxRunner.load(manifest, entry.code);
				sandboxedPluginCache.set(pluginKey, plugin);
				console.log(
					`EmDash: Loaded sandboxed plugin ${pluginKey} with capabilities: [${manifest.capabilities.join(", ")}]`,
				);

				if (manifest.routes.length > 0) {
					const routeMetaMap = new Map<string, RouteMeta>();
					for (const routeEntry of manifest.routes) {
						const normalized = normalizeManifestRoute(routeEntry);
						routeMetaMap.set(normalized.name, buildRouteMeta(normalized));
					}
					sandboxedRouteMetaCache.set(entry.id, routeMetaMap);
				} else {
					sandboxedRouteMetaCache.delete(entry.id);
				}
			} catch (error) {
				console.error(`EmDash: Failed to load sandboxed plugin ${entry.id}:`, error);
			}
		}

		return sandboxedPluginCache;
	}

	private static async loadInstalledSandboxedPlugins(
		source: "marketplace" | "registry",
		db: Kysely<Database>,
		storage: Storage,
		deps: RuntimeDependencies,
		cache: Map<string, SandboxedPluginInstance>,
		siteInfo?: {
			siteName?: string;
			siteUrl?: string;
			locale?: string;
			trailingSlash?: "always" | "never" | "ignore";
		},
	): Promise<void> {
		if (!sandboxRunner && deps.createSandboxRunner) {
			sandboxRunner = deps.createSandboxRunner(
				createSandboxRunnerOptions(
					{
						db,
						beforeContentWrite: () => assertMediaUsageActivationWriteAllowed(db),
						mediaStorage: {
							upload: (opts) =>
								storage.upload({
									key: opts.key,
									body: opts.body,
									contentType: opts.contentType,
								}),
							delete: (key) => storage.delete(key),
						},
					},
					siteInfo,
				),
			);
		}
		if (deps.sandboxBypassed) return;

		if (!sandboxRunner || !sandboxRunner.isAvailable()) {
			return;
		}

		const keySet = source === "marketplace" ? marketplacePluginKeys : registryPluginKeys;

		try {
			const stateRepo = new PluginStateRepository(db);
			const plugins =
				source === "marketplace"
					? await stateRepo.getMarketplacePlugins()
					: await stateRepo.getRegistryPlugins();

			for (const plugin of plugins) {
				if (plugin.status !== "active") continue;

				const version =
					source === "marketplace" ? (plugin.marketplaceVersion ?? plugin.version) : plugin.version;
				const pluginKey = `${plugin.pluginId}:${version}`;

				if (cache.has(pluginKey)) continue;

				try {
					const bundle = await loadBundleFromR2(storage, plugin.pluginId, version, source);
					if (!bundle) {
						console.warn(`EmDash: ${source} plugin ${plugin.pluginId}@${version} not found in R2`);
						continue;
					}

					const loaded = await sandboxRunner.load(bundle.manifest, bundle.backendCode);
					cache.set(pluginKey, loaded);
					keySet.add(pluginKey);

					marketplaceManifestCache.set(plugin.pluginId, {
						id: bundle.manifest.id,
						version: bundle.manifest.version,
						admin: bundle.manifest.admin,
						mcp: bundle.manifest.mcp,
						storage: bundle.manifest.storage,
					});

					if (bundle.manifest.routes.length > 0) {
						const routeMeta = new Map<string, RouteMeta>();
						for (const entry of bundle.manifest.routes) {
							const normalized = normalizeManifestRoute(entry);
							routeMeta.set(normalized.name, buildRouteMeta(normalized));
						}
						sandboxedRouteMetaCache.set(plugin.pluginId, routeMeta);
					}

					console.log(
						`EmDash: Loaded ${source} plugin ${pluginKey} with capabilities: [${bundle.manifest.capabilities.join(", ")}]`,
					);
				} catch (error) {
					console.error(`EmDash: Failed to load ${source} plugin ${plugin.pluginId}:`, error);
				}
			}
		} catch {}
	}

	private static async loadMarketplacePluginsBypassed(
		db: Kysely<Database>,
		storage: Storage,
	): Promise<ResolvedPlugin[]> {
		const resolved: ResolvedPlugin[] = [];
		try {
			const stateRepo = new PluginStateRepository(db);
			const marketplacePlugins = await stateRepo.getMarketplacePlugins();
			if (marketplacePlugins.length === 0) return resolved;

			console.info(
				"EmDash: Sandbox disabled (sandbox: false). " +
					"Marketplace plugins will run in-process without isolation.",
			);

			const { adaptSandboxEntry } = await import("./plugins/adapt-sandbox-entry.js");

			for (const plugin of marketplacePlugins) {
				if (plugin.status !== "active") continue;
				const version = plugin.marketplaceVersion ?? plugin.version;
				try {
					const bundle = await loadBundleFromR2(storage, plugin.pluginId, version);
					if (!bundle) {
						console.warn(
							`EmDash: Marketplace plugin ${plugin.pluginId}@${version} not found in R2`,
						);
						continue;
					}

					marketplaceManifestCache.set(plugin.pluginId, {
						id: bundle.manifest.id,
						version: bundle.manifest.version,
						admin: bundle.manifest.admin,
						mcp: bundle.manifest.mcp,
						storage: bundle.manifest.storage,
					});
					if (bundle.manifest.routes.length > 0) {
						const routeMeta = new Map<string, RouteMeta>();
						for (const entry of bundle.manifest.routes) {
							const normalized = normalizeManifestRoute(entry);
							routeMeta.set(normalized.name, buildRouteMeta(normalized));
						}
						sandboxedRouteMetaCache.set(plugin.pluginId, routeMeta);
					}

					const dataUrl = `data:text/javascript;base64,${Buffer.from(bundle.backendCode).toString("base64")}`;
					// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- dynamic module from trusted bundle (built by plugin-cli); adaptSandboxEntry validates required fields.
					const pluginModule = (await import(/* @vite-ignore */ dataUrl)) as Record<
						string,
						unknown
					>;
					const pluginDef = (pluginModule.default ?? pluginModule) as Parameters<
						typeof adaptSandboxEntry
					>[0];
					const adapted = adaptSandboxEntry(pluginDef, {
						id: bundle.manifest.id,
						version: bundle.manifest.version,
						entrypoint: "",
						capabilities: bundle.manifest.capabilities ?? [],
						allowedHosts: bundle.manifest.allowedHosts ?? [],
						// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- adaptSandboxEntry copies storage through
						storage: (bundle.manifest.storage ?? {}) as never,
						adminPages: bundle.manifest.admin?.pages,
						adminWidgets: bundle.manifest.admin?.widgets?.map((w) => ({
							id: w.id,
							title: w.title,
							size:
								w.size === "full" || w.size === "half" || w.size === "third" ? w.size : undefined,
						})),
						settingsSchema: bundle.manifest.admin?.settingsSchema,
					});
					resolved.push(adapted);
					console.log(
						`EmDash: Loaded marketplace plugin ${plugin.pluginId}@${version} in-process (sandbox bypassed)`,
					);
				} catch (error) {
					console.error(
						`EmDash: Failed to load marketplace plugin ${plugin.pluginId} in-process:`,
						error,
					);
				}
			}
		} catch {}
		return resolved;
	}

	private static async resolveExclusiveHooks(
		pipeline: HookPipeline,
		db: Kysely<Database>,
		deps: RuntimeDependencies,
	): Promise<void> {
		const exclusiveHookNames = pipeline.getRegisteredExclusiveHooks();
		if (exclusiveHookNames.length === 0) return;

		let optionsRepo: OptionsRepository;
		try {
			optionsRepo = new OptionsRepository(db);
		} catch {
			return;
		}

		const preferredHints = new Map<string, string[]>();
		for (const entry of deps.sandboxedPluginEntries) {
			if (entry.preferred && entry.preferred.length > 0) {
				preferredHints.set(entry.id, entry.preferred);
			}
		}

		await resolveExclusiveHooksShared({
			pipeline,
			isActive: () => true,
			getOption: (key) => optionsRepo.get<string>(key),
			getOptions: (keys) => optionsRepo.getMany<string>(keys),
			setOption: (key, value) => optionsRepo.set(key, value),
			deleteOption: async (key) => {
				await optionsRepo.delete(key);
			},
			preferredHints,
		});
	}

	getManifest(): Promise<EmDashManifest> {
		return requestCached("emdash:manifest", () => this._buildManifest());
	}

	private async _buildManifest(): Promise<EmDashManifest> {
		const manifestCollections: Record<string, ManifestCollection> = {};
		try {
			const registry = new SchemaRegistry(this.db);
			const dbCollections = await registry.listCollectionsWithFields();
			for (const collection of dbCollections) {
				const fields: Record<
					string,
					{
						kind: string;
						label?: string;
						required?: boolean;
						widget?: string;
						options?: Array<{ value: string; label: string }> | Record<string, unknown>;
						id?: string;
						validation?: Record<string, unknown>;
					}
				> = {};

				for (const field of collection.fields) {
					const entry: (typeof fields)[string] = {
						kind: FIELD_TYPE_TO_KIND[field.type] ?? "string",
						label: field.label,
						required: field.required,
					};
					entry.id = field.id;
					if (field.widget) entry.widget = field.widget;
					if (field.options) {
						entry.options = field.options;
					}
					if (field.validation?.options) {
						entry.options = field.validation.options.map((v) => ({
							value: v,
							label: v.charAt(0).toUpperCase() + v.slice(1),
						}));
					}
					if (
						(field.type === "repeater" || field.type === "file" || field.type === "image") &&
						field.validation
					) {
						entry.validation = { ...field.validation };
					}
					fields[field.slug] = entry;
				}

				const configuredListColumns = collection.admin?.listColumns ?? [];
				const fieldTypes = new Map(collection.fields.map((field) => [field.slug, field.type]));
				const listColumns: string[] = [];
				for (const slug of configuredListColumns) {
					if (listColumns.includes(slug)) continue;
					const fieldType = fieldTypes.get(slug);
					if (!fieldType || !LIST_COLUMN_FIELD_TYPES.has(fieldType)) {
						console.warn(
							`EmDash: Ignoring unsupported or unknown list column "${slug}" in collection "${collection.slug}".`,
						);
						continue;
					}
					if (listColumns.length >= MAX_COLLECTION_LIST_COLUMNS) {
						console.warn(
							`EmDash: Collection "${collection.slug}" declares more than ${MAX_COLLECTION_LIST_COLUMNS} list columns; extra columns are ignored.`,
						);
						break;
					}
					listColumns.push(slug);
				}

				manifestCollections[collection.slug] = {
					label: collection.label,
					labelSingular: collection.labelSingular || collection.label,
					supports: collection.supports || [],
					hasSeo: collection.hasSeo,
					urlPattern: collection.urlPattern,
					routable: collection.routable !== false,
					titleField: collection.titleField,
					dateField: collection.dateField,
					...(collection.hidden ? { hidden: true } : {}),
					listColumns: listColumns.length > 0 ? listColumns : undefined,
					fields,
				};
			}
		} catch (error) {
			console.debug("EmDash: Could not load database collections:", error);
		}

		const manifestPlugins: Record<
			string,
			{
				version?: string;
				enabled?: boolean;
				sandboxed?: boolean;
				adminMode?: "react" | "blocks" | "none";
				adminPages?: Array<{ path: string; label?: string; icon?: string }>;
				dashboardWidgets?: Array<{
					id: string;
					title?: string;
					size?: string;
				}>;
				portableTextBlocks?: Array<{
					type: string;
					label: string;
					icon?: string;
					description?: string;
					placeholder?: string;
					fields?: Element[];
					category?: string;
				}>;
				fieldWidgets?: Array<{
					name: string;
					label: string;
					fieldTypes: string[];
					elements?: Element[];
				}>;
			}
		> = {};

		for (const plugin of this.configuredPlugins) {
			const status = this.pluginStates.get(plugin.id);
			const enabled = status === undefined || status === "active";

			const hasAdminEntry = !!plugin.admin?.entry;
			const hasAdminPages = (plugin.admin?.pages?.length ?? 0) > 0;
			const hasWidgets = (plugin.admin?.widgets?.length ?? 0) > 0;
			let adminMode: "react" | "blocks" | "none" = "none";
			if (hasAdminEntry) {
				adminMode = "react";
			} else if (hasAdminPages || hasWidgets) {
				adminMode = "blocks";
			}

			manifestPlugins[plugin.id] = {
				version: plugin.version,
				enabled,
				adminMode,
				adminPages: plugin.admin?.pages ?? [],
				dashboardWidgets: plugin.admin?.widgets ?? [],
				portableTextBlocks: plugin.admin?.portableTextBlocks,
				fieldWidgets: plugin.admin?.fieldWidgets,
			};
		}

		for (const entry of this.sandboxedPluginEntries) {
			const status = this.pluginStates.get(entry.id);
			const enabled = isPluginStateEnabled(status, entry.defaultEnabled);

			const hasAdminPages = (entry.adminPages?.length ?? 0) > 0;
			const hasWidgets = (entry.adminWidgets?.length ?? 0) > 0;

			manifestPlugins[entry.id] = {
				version: entry.version,
				enabled,
				sandboxed: true,
				adminMode: hasAdminPages || hasWidgets ? "blocks" : "none",
				adminPages: entry.adminPages ?? [],
				dashboardWidgets: entry.adminWidgets ?? [],
				portableTextBlocks: entry.portableTextBlocks,
				fieldWidgets: entry.fieldWidgets,
			};
		}

		for (const [pluginId, meta] of marketplaceManifestCache) {
			if (manifestPlugins[pluginId]) continue;

			const status = this.pluginStates.get(pluginId);
			const enabled = status === "active";

			const pages = meta.admin?.pages;
			const widgets = meta.admin?.widgets;
			const hasAdminPages = (pages?.length ?? 0) > 0;
			const hasWidgets = (widgets?.length ?? 0) > 0;

			manifestPlugins[pluginId] = {
				version: meta.version,
				enabled,
				sandboxed: true,
				adminMode: hasAdminPages || hasWidgets ? "blocks" : "none",
				adminPages: pages ?? [],
				dashboardWidgets: widgets ?? [],
			};
		}

		let manifestTaxonomies: Array<{
			id: string;
			name: string;
			label: string;
			labelSingular?: string;
			hierarchical: boolean;
			collections: string[];
			locale: string;
			translationGroup: string;
		}> = [];
		let taxonomyDefinitionLocales: string[] = [];
		try {
			const rows = await this.db
				.selectFrom("_emdash_taxonomy_defs")
				.selectAll()
				.orderBy("name")
				.execute();
			taxonomyDefinitionLocales = rows.map((row) => row.locale);
			manifestTaxonomies = rows.map((row) => ({
				id: row.id,
				name: row.name,
				label: row.label,
				labelSingular: row.label_singular ?? undefined,
				hierarchical: row.hierarchical === 1,
				collections: parseStringArray(row.collections).toSorted(),
				locale: row.locale,
				translationGroup: row.translation_group ?? row.id,
			}));
		} catch (error) {
			console.debug("EmDash: Could not load taxonomy definitions:", error);
		}

		try {
			const configuredLocales = virtualConfig?.i18n?.locales ?? getI18nConfig()?.locales ?? [];
			await warnAboutUnconfiguredTaxonomyLocales(
				this.db,
				configuredLocales,
				taxonomyDefinitionLocales,
			);
		} catch (error) {
			console.warn("[i18n] taxonomy locale diagnostic failed:", error);
		}

		const manifestHash = await hashString(
			JSON.stringify(manifestCollections) +
				JSON.stringify(manifestPlugins) +
				JSON.stringify(manifestTaxonomies),
		);

		const authMode = getAuthMode(this.config);
		const authModeValue = authMode.type === "external" ? authMode.providerType : "passkey";

		const i18nConfig = virtualConfig?.i18n ?? getI18nConfig();
		const i18n =
			i18nConfig && i18nConfig.locales && i18nConfig.locales.length > 1
				? { defaultLocale: i18nConfig.defaultLocale, locales: i18nConfig.locales }
				: undefined;

		const registry = normalizeRegistryConfig(this.config.experimental?.registry) ?? undefined;

		return {
			version: VERSION,
			commit: COMMIT,
			astroVersion: this.config.astroVersion,
			hash: manifestHash,
			collections: manifestCollections,
			plugins: manifestPlugins,
			taxonomies: manifestTaxonomies,
			authMode: authModeValue,
			i18n,
			contentLocale: {
				defaultLocale: i18nConfig?.defaultLocale ?? "en",
				implicit: i18nConfig === null,
			},
			marketplace: !!this.config.marketplace,
			registry,
		};
	}

	async ensureSearchHealthy(): Promise<void> {
		if (!isSqlite(this._db)) return;
		try {
			await singleFlightCached(
				this._searchHealthCache,
				async () => {
					try {
						const ftsManager = new FTSManager(this._db);
						const repaired = await ftsManager.verifyAndRepairAll();
						if (repaired > 0) {
							console.log(`Repaired ${repaired} corrupted FTS index(es)`);
						}
					} catch {}
				},
				{ anchor: (promise) => after(() => promise), ownerTimeoutMs: 30_000 },
			);
		} catch {}
	}

	async handleContentList(
		collection: string,
		params: {
			cursor?: string;
			limit?: number;
			status?: string;
			orderBy?: string;
			order?: "asc" | "desc";
			locale?: string;
			q?: string;
			authorId?: string;
			dateField?: ContentDateField;
			dateFrom?: string;
			dateTo?: string;
			bylines?: string[];
			bylinesNone?: boolean;
			includeInferredBylines?: boolean;
			fieldFilters?: ContentFieldFilters;
		},
	) {
		return handleContentList(this.db, collection, params);
	}

	async handleContentAuthors(collection: string) {
		return handleContentAuthors(this.db, collection);
	}

	async handleContentGet(collection: string, id: string, locale?: string) {
		const result = await handleContentGet(this.db, collection, id, locale);
		return this.hydrateDraftData(result);
	}

	async handleContentGetIncludingTrashed(collection: string, id: string, locale?: string) {
		const result = await handleContentGetIncludingTrashed(this.db, collection, id, locale);
		return this.hydrateDraftData(result);
	}

	private async hydrateDraftData<T>(result: T): Promise<T> {
		if (!result || typeof result !== "object") return result;
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- shape probed below
		const r = result as {
			success?: boolean;
			data?: { item?: Record<string, unknown> };
		};
		if (!r.success || !r.data?.item) return result;
		const item = r.data.item;
		const draftRevisionId = typeof item.draftRevisionId === "string" ? item.draftRevisionId : null;
		if (!draftRevisionId) return result;
		try {
			const revision = await new RevisionRepository(this.db).findById(draftRevisionId);
			if (!revision) return result;
			const liveData =
				item.data && typeof item.data === "object"
					? // eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to object above
						(item.data as Record<string, unknown>)
					: {};
			const revisionData: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(revision.data)) {
				if (!key.startsWith("_")) revisionData[key] = value;
			}
			const mergedData = { ...liveData, ...revisionData };
			return {
				...result,
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- shape preserved; result has been narrowed to the {success,data:{item}} envelope
				data: {
					...r.data,
					item: { ...item, data: mergedData, liveData },
				},
			};
		} catch (error) {
			console.error("[emdash] draft hydration failed:", error);
			return result;
		}
	}

	async handleContentCreate(
		collection: string,
		body: {
			data: Record<string, unknown>;
			slug?: string | null;
			status?: string;
			authorId?: string;
			bylines?: Array<{ bylineId: string; roleLabel?: string | null }>;
			locale?: string;
			translationOf?: string;
			taxonomies?: Record<string, string[]>;
		},
	) {
		let processedData = body.data;
		if (this.hooks.hasHooks("content:beforeSave")) {
			const hookResult = await this.hooks.runContentBeforeSave(body.data, collection, true);
			processedData = hookResult.content;
		}

		processedData = await this.runSandboxedBeforeSave(processedData, collection, true);

		processedData = await this.normalizeMediaFields(collection, processedData);

		const { validateContentData } = await import("./api/handlers/validation.js");
		const validation = await validateContentData(this.db, collection, processedData, {
			partial: false,
		});
		if (!validation.ok) {
			return {
				success: false as const,
				error: validation.error,
			};
		}

		const result = await handleContentCreate(this.db, collection, {
			...body,
			data: processedData,
			authorId: body.authorId,
			bylines: body.bylines,
		});
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success && result.data) {
			this.runAfterSaveHooks(contentItemToRecord(result.data.item), collection, true);
		}

		return result;
	}

	async handleContentUpdate(
		collection: string,
		id: string,
		body: {
			data?: Record<string, unknown>;
			slug?: string | null;
			status?: string;
			authorId?: string | null;
			bylines?: Array<{ bylineId: string; roleLabel?: string | null }>;
			seo?: {
				title?: string | null;
				description?: string | null;
				image?: string | null;
				canonical?: string | null;
				noIndex?: boolean;
			};
			taxonomies?: Record<string, string[]>;
			publishedAt?: string | null;
			locale?: string;
			skipRevision?: boolean;
			_rev?: string;
		},
	) {
		const repo = new ContentRepository(this.db);
		const resolvedItem = await repo.findByIdOrSlug(collection, id, body.locale);
		const resolvedId = resolvedItem?.id ?? id;

		if (body._rev) {
			if (!resolvedItem) {
				return {
					success: false as const,
					error: { code: "NOT_FOUND", message: `Content item not found: ${id}` },
				};
			}
			const revCheck = validateRev(body._rev, resolvedItem);
			if (!revCheck.valid) {
				return {
					success: false as const,
					error: { code: "CONFLICT", message: revCheck.message },
				};
			}
		}
		const { _rev: _discardedRev, ...bodyWithoutRev } = body;

		let processedData = bodyWithoutRev.data;
		if (bodyWithoutRev.data) {
			if (this.hooks.hasHooks("content:beforeSave")) {
				const hookResult = await this.hooks.runContentBeforeSave(
					bodyWithoutRev.data,
					collection,
					false,
				);
				processedData = hookResult.content;
			}

			processedData = await this.runSandboxedBeforeSave(processedData!, collection, false);

			processedData = await this.normalizeMediaFields(collection, processedData);

			const { validateContentData } = await import("./api/handlers/validation.js");
			const validation = await validateContentData(this.db, collection, processedData, {
				partial: true,
			});
			if (!validation.ok) {
				return {
					success: false as const,
					error: validation.error,
				};
			}
		}

		let usesDraftRevisions = false;
		let draftStorageChanged = false;
		if (processedData) {
			const collectionInfo = await this.schemaRegistry.getCollectionWithFields(collection);
			if (collectionInfo?.supports?.includes("revisions")) {
				usesDraftRevisions = true;
				const revisionRepo = new RevisionRepository(this.db);
				let existing = await repo.findById(collection, resolvedId);

				for (let attempt = 0; existing && attempt < MAX_DRAFT_STAGE_ATTEMPTS; attempt++) {
					let baseData: Record<string, unknown>;
					if (existing.draftRevisionId) {
						const draftRevision = await revisionRepo.findById(existing.draftRevisionId);
						baseData = draftRevision?.data ?? existing.data;
					} else {
						baseData = existing.data;
					}

					const mergedData = { ...baseData, ...processedData };
					if (bodyWithoutRev.slug !== undefined) {
						mergedData._slug = bodyWithoutRev.slug;
					}

					const revision = await revisionRepo.create({
						collection,
						entryId: resolvedId,
						data: mergedData,
						authorId: bodyWithoutRev.authorId ?? undefined,
					});

					let staged: boolean;
					try {
						staged = await repo.replaceDraftRevision(collection, resolvedId, revision.id, existing);
					} catch (error) {
						try {
							await revisionRepo.deleteIfUnreferenced(collection, resolvedId, revision.id);
						} catch (cleanupError) {
							console.error(
								`[emdash] Failed to clean up unstaged revision ${revision.id}:`,
								cleanupError,
							);
						}
						throw error;
					}

					if (!staged) {
						try {
							await revisionRepo.deleteIfUnreferenced(collection, resolvedId, revision.id);
						} catch (cleanupError) {
							console.error(
								`[emdash] Failed to clean up unstaged revision ${revision.id}:`,
								cleanupError,
							);
						}
						if (body._rev || attempt === MAX_DRAFT_STAGE_ATTEMPTS - 1) {
							const error = new ContentMutationConflictError();
							return {
								success: false as const,
								error: { code: "CONFLICT", message: error.message },
							};
						}
						existing = await repo.findById(collection, resolvedId);
						continue;
					}

					draftStorageChanged = true;

					if (bodyWithoutRev.skipRevision && existing.draftRevisionId) {
						try {
							await revisionRepo.deleteIfUnreferenced(
								collection,
								resolvedId,
								existing.draftRevisionId,
							);
						} catch (error) {
							console.error(
								`[emdash] Failed to clean up superseded revision ${existing.draftRevisionId}:`,
								error,
							);
						}
					} else {
						after(async () => {
							try {
								await revisionRepo.pruneQueuedEntry(collection, resolvedId, revision.id, 50);
							} catch (error) {
								console.error(
									`[revisions] Failed to prune revisions for ${collection}/${resolvedId}:`,
									error,
								);
							}
						});
					}
					break;
				}
			}
		}

		const liveMetaTouched = Object.entries(bodyWithoutRev).some(
			([key, value]) => value !== undefined && !DRAFT_ONLY_UPDATE_KEYS.has(key),
		);

		const result =
			usesDraftRevisions && !liveMetaTouched
				? await handleContentGet(this.db, collection, resolvedId)
				: await handleContentUpdate(this.db, collection, resolvedId, {
						...bodyWithoutRev,
						data: usesDraftRevisions ? undefined : processedData,
						slug: usesDraftRevisions ? undefined : bodyWithoutRev.slug,
						authorId: bodyWithoutRev.authorId,
						bylines: bodyWithoutRev.bylines,
					});

		const liveContentChanged = usesDraftRevisions
			? liveMetaTouched
			: Boolean(processedData || bodyWithoutRev.slug !== undefined || liveMetaTouched);

		const hydrated = await this.hydrateDraftData(result);
		if (hydrated.success && hydrated.data) {
			const contentIdsToRefresh = [resolvedId];
			if (!usesDraftRevisions && processedData) {
				try {
					contentIdsToRefresh.push(
						...(await findNonTranslatableSiblingContentIds(
							this.db,
							collection,
							resolvedId,
							hydrated.data.item.translationGroup,
							processedData,
						)),
					);
				} catch (error) {
					console.error(
						`[media-usage] Failed to discover synced i18n siblings for ${collection}/${resolvedId}:`,
						error,
					);
					try {
						await markContentMediaUsageCollectionStale(
							this.db,
							collection,
							"CONTENT_USAGE_REFRESH_ERROR",
						);
					} catch (staleError) {
						console.error(`[media-usage] Failed to mark ${collection} stale:`, staleError);
					}
				}
			}
			await this.refreshContentUsageAfterSuccessfulWrite(collection, contentIdsToRefresh);
		} else if (draftStorageChanged) {
			try {
				await markContentMediaUsageCollectionStale(this.db, collection, "CONTENT_USAGE_STALE");
			} catch (error) {
				console.error(`[media-usage] Failed to mark ${collection} stale:`, error);
			}
		}

		if (hydrated.success && hydrated.data) {
			this.runAfterSaveHooks(contentItemToRecord(hydrated.data.item), collection, false);
		}

		if (hydrated.success) {
			return { ...hydrated, liveContentChanged };
		}
		return hydrated;
	}

	async handleContentDelete(collection: string, id: string) {
		if (this.hooks.hasHooks("content:beforeDelete")) {
			const { allowed } = await this.hooks.runContentBeforeDelete(id, collection);
			if (!allowed) {
				return {
					success: false,
					error: {
						code: "DELETE_BLOCKED",
						message: "Delete blocked by plugin hook",
					},
				};
			}
		}

		const sandboxAllowed = await this.runSandboxedBeforeDelete(id, collection);
		if (!sandboxAllowed) {
			return {
				success: false,
				error: {
					code: "DELETE_BLOCKED",
					message: "Delete blocked by sandboxed plugin hook",
				},
			};
		}

		const result = await handleContentDelete(this.db, collection, id);
		if (result.success) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.id]);
		}

		if (result.success) {
			this.runAfterDeleteHooks(id, collection, false);
		}

		return result;
	}

	async handleContentListTrashed(
		collection: string,
		params: { cursor?: string; limit?: number } = {},
	) {
		return handleContentListTrashed(this.db, collection, params);
	}

	async handleContentRestore(collection: string, id: string) {
		const result = await handleContentRestore(this.db, collection, id);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success) {
			this.runAfterRestoreHooks(contentItemToRecord(result.data.item), collection);
		}

		return result;
	}

	async handleContentPermanentDelete(collection: string, id: string) {
		const result = await handleContentPermanentDelete(this.db, collection, id);
		if (result.success) {
			await this.deleteContentUsageAfterSuccessfulPermanentDelete(collection, result.data.id);
		}

		if (result.success) {
			this.runAfterDeleteHooks(id, collection, true);
		}

		return result;
	}

	async handleContentCountTrashed(collection: string) {
		return handleContentCountTrashed(this.db, collection);
	}

	async handleContentDuplicate(collection: string, id: string, authorId?: string) {
		const result = await handleContentDuplicate(this.db, collection, id, authorId);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}
		return result;
	}

	async handleContentPublish(
		collection: string,
		id: string,
		options: {
			publishedAt?: string;
			requireScheduledDue?: boolean;
			expectedScheduledAt?: string;
		} = {},
	) {
		const result = await handleContentPublish(this.db, collection, id, options);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success && result.data) {
			this.runAfterPublishHooks(contentItemToRecord(result.data.item), collection);
		}

		return result;
	}

	async handleContentUnpublish(collection: string, id: string) {
		const result = await handleContentUnpublish(this.db, collection, id);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success && result.data) {
			this.runAfterUnpublishHooks(contentItemToRecord(result.data.item), collection);
		}

		return result;
	}

	async handleContentSchedule(collection: string, id: string, scheduledAt: string) {
		const result = await handleContentSchedule(this.db, collection, id, scheduledAt);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success && result.data) {
			this.runAfterScheduleHooks(contentItemToRecord(result.data.item), collection);
		}

		return result;
	}

	async handleContentUnschedule(collection: string, id: string) {
		const result = await handleContentUnschedule(this.db, collection, id);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}

		if (result.success && result.data) {
			this.runAfterUnscheduleHooks(contentItemToRecord(result.data.item), collection);
		}

		return result;
	}

	async handleContentCountScheduled(collection: string) {
		return handleContentCountScheduled(this.db, collection);
	}

	async handleContentDiscardDraft(collection: string, id: string) {
		const result = await handleContentDiscardDraft(this.db, collection, id);
		if (result.success && result.data) {
			await this.refreshContentUsageAfterSuccessfulWrite(collection, [result.data.item.id]);
		}
		return result;
	}

	async handleContentCompare(collection: string, id: string) {
		return handleContentCompare(this.db, collection, id);
	}

	async handleContentTranslations(collection: string, id: string) {
		return handleContentTranslations(this.db, collection, id);
	}

	async handleMediaList(params: {
		cursor?: string;
		page?: number;
		limit?: number;
		mimeType?: string | readonly string[];
		q?: string;
		folderId?: string | null;
	}) {
		return handleMediaList(this.db, params);
	}

	async handleMediaGet(id: string) {
		return handleMediaGet(this.db, id);
	}

	async handleMediaCreate(input: {
		filename: string;
		mimeType: string;
		size?: number;
		width?: number;
		height?: number;
		storageKey: string;
		contentHash?: string;
		blurhash?: string;
		dominantColor?: string;
		authorId?: string;
	}) {
		let processedInput = input;
		if (this.hooks.hasHooks("media:beforeUpload")) {
			const hookResult = await this.hooks.runMediaBeforeUpload({
				name: input.filename,
				type: input.mimeType,
				size: input.size || 0,
			});
			processedInput = {
				...input,
				filename: hookResult.file.name,
				mimeType: hookResult.file.type,
				size: hookResult.file.size,
			};
		}

		const result = await handleMediaCreate(this.db, processedInput);

		if (result.success && this.hooks.hasHooks("media:afterUpload")) {
			const item = result.data.item;
			const mediaItem: MediaItem = {
				id: item.id,
				filename: item.filename,
				mimeType: item.mimeType,
				size: item.size,
				url: `/media/${item.id}/${item.filename}`,
				createdAt: item.createdAt,
			};
			this.hooks
				.runMediaAfterUpload(mediaItem)
				.catch((err) => console.error("EmDash afterUpload hook error:", err));
		}

		return result;
	}

	async handleMediaUpdate(
		id: string,
		input: {
			alt?: string;
			caption?: string;
			width?: number;
			height?: number;
			folderId?: string | null;
			focalX?: number | null;
			focalY?: number | null;
		},
	) {
		const result = await handleMediaUpdate(this.db, id, input);
		if (result.success) {
			invalidateSiteSettingsCache();
		}
		return result;
	}

	async handleMediaDelete(id: string) {
		const result = await handleMediaDelete(this.db, id);
		if (result.success) {
			invalidateSiteSettingsCache();
		}
		return result;
	}

	async handleRevisionList(collection: string, entryId: string, params: { limit?: number } = {}) {
		return handleRevisionList(this.db, collection, entryId, params);
	}

	async handleRevisionGet(revisionId: string) {
		return handleRevisionGet(this.db, revisionId);
	}

	async handleRevisionRestore(revisionId: string, callerUserId: string) {
		const revisionRepo = new RevisionRepository(this.db);
		const revision = await revisionRepo.findById(revisionId);
		if (!revision) {
			return {
				success: false as const,
				error: {
					code: "NOT_FOUND",
					message: `Revision not found: ${revisionId}`,
				},
			};
		}

		const collectionInfo = await this.schemaRegistry.getCollectionWithFields(revision.collection);
		const usesDraftRevisions = collectionInfo?.supports?.includes("revisions") ?? false;

		if (!usesDraftRevisions) {
			const result = await handleRevisionRestore(this.db, revisionId, callerUserId);
			if (result.success) {
				await this.refreshContentUsageAfterSuccessfulWrite(revision.collection, [revision.entryId]);
			}
			return this.hydrateDraftData(result);
		}

		try {
			const contentRepo = new ContentRepository(this.db);
			const existing = await contentRepo.findById(revision.collection, revision.entryId);
			if (!existing) {
				return {
					success: false as const,
					error: {
						code: "NOT_FOUND",
						message: `Content item not found: ${revision.entryId}`,
					},
				};
			}

			const newDraft = await revisionRepo.create({
				collection: revision.collection,
				entryId: revision.entryId,
				data: revision.data,
				authorId: callerUserId,
			});

			try {
				const staged = await contentRepo.replaceDraftRevision(
					revision.collection,
					revision.entryId,
					newDraft.id,
					existing,
				);
				if (!staged) throw new ContentMutationConflictError();
			} catch (error) {
				try {
					await revisionRepo.deleteIfUnreferenced(
						revision.collection,
						revision.entryId,
						newDraft.id,
					);
				} catch (cleanupError) {
					console.error(
						`[emdash] Failed to clean up unrestored revision ${newDraft.id}:`,
						cleanupError,
					);
				}
				throw error;
			}

			after(async () => {
				try {
					await revisionRepo.pruneQueuedEntry(
						revision.collection,
						revision.entryId,
						newDraft.id,
						50,
					);
				} catch (error) {
					console.error(
						`[revisions] Failed to prune revisions for ${revision.collection}/${revision.entryId}:`,
						error,
					);
				}
			});

			const refetched = await handleContentGet(this.db, revision.collection, revision.entryId);
			const hydrated = await this.hydrateDraftData(refetched);
			if (hydrated.success) {
				await this.refreshContentUsageAfterSuccessfulWrite(revision.collection, [revision.entryId]);
			}
			return hydrated;
		} catch (error) {
			if (error instanceof ContentMutationConflictError) {
				return {
					success: false as const,
					error: { code: "CONFLICT", message: error.message },
				};
			}
			console.error("[emdash] revision restore failed:", error);
			return {
				success: false as const,
				error: {
					code: "REVISION_RESTORE_ERROR",
					message: "Failed to restore revision",
				},
			};
		}
	}

	private async refreshContentUsageAfterSuccessfulWrite(
		collection: string,
		contentIds: readonly string[],
	): Promise<void> {
		for (const contentId of new Set(contentIds)) {
			try {
				const work = await processMediaUsageWorkAfterWrite(this.db, collection, contentId);
				if (work.outcome !== "inactive") continue;
				await refreshContentMediaUsageAfterWrite(this.db, collection, contentId);
			} catch (error) {
				console.error(
					`[media-usage] Failed after content write ${collection}/${contentId}:`,
					error,
				);
				continue;
			}
		}
	}

	private async deleteContentUsageAfterSuccessfulPermanentDelete(
		collection: string,
		contentId: string,
	): Promise<void> {
		try {
			const work = await processMediaUsageWorkAfterWrite(this.db, collection, contentId);
			if (work.outcome !== "inactive") return;
			const result = await deleteContentMediaUsage(this.db, collection, contentId);
			if (!result.success) {
				console.error(
					`[media-usage] Usage delete for ${collection}/${contentId} finished with ${result.errorCode}`,
				);
			}
		} catch (error) {
			console.error(
				`[media-usage] Failed after permanent content delete ${collection}/${contentId}:`,
				error,
			);
		}
	}

	getPluginRouteMeta(pluginId: string, path: string): RouteMeta | null {
		if (!this.isPluginEnabled(pluginId)) return null;

		const routeKey = path.replace(LEADING_SLASH_PATTERN, "");

		const trustedPlugin = this.configuredPlugins.find((p) => p.id === pluginId);
		if (trustedPlugin) {
			const route = trustedPlugin.routes[routeKey];
			if (!route) return null;
			return buildRouteMeta(route);
		}

		const meta = sandboxedRouteMetaCache.get(pluginId);
		if (meta) {
			const routeMeta = meta.get(routeKey);
			if (routeMeta) return routeMeta;
		}

		if (routeKey === "admin") {
			const manifestMeta = marketplaceManifestCache.get(pluginId);
			if (manifestMeta?.admin?.pages?.length || manifestMeta?.admin?.widgets?.length) {
				return { public: false };
			}
			const entry = this.sandboxedPluginEntries.find((e) => e.id === pluginId);
			if (entry?.adminPages?.length || entry?.adminWidgets?.length) {
				return { public: false };
			}
		}

		if (this.findSandboxedPlugin(pluginId)) {
			return { public: false };
		}

		return null;
	}

	getRuntimePluginSettingsSchema(pluginId: string): Record<string, SettingField> | null {
		const meta = marketplaceManifestCache.get(pluginId);
		if (!meta) return null;
		return meta.admin?.settingsSchema ?? {};
	}

	async handlePluginApiRoute(
		pluginId: string,
		_method: string,
		path: string,
		request: Request,
		user?: RouteCallerInput | null,
	) {
		if (!this.isPluginEnabled(pluginId)) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: `Plugin not enabled: ${pluginId}` },
			};
		}

		return this.dispatchPluginApiRoute(pluginId, path, request, user);
	}

	async inspectPluginHealth(pluginId: string, request: Request, user?: RouteCallerInput | null) {
		return this.dispatchPluginApiRoute(
			pluginId,
			"/health",
			new Request(
				new URL(`/_emdash/api/plugins/${encodeURIComponent(pluginId)}/health`, request.url),
				{ method: "GET" },
			),
			user,
		);
	}

	private async dispatchPluginApiRoute(
		pluginId: string,
		path: string,
		request: Request,
		user?: RouteCallerInput | null,
	) {
		const caller = user ? toRouteCallerInfo(user) : undefined;

		const trustedPlugin = this.configuredPlugins.find((p) => p.id === pluginId);
		if (trustedPlugin) {
			const routeRegistry = new PluginRouteRegistry({
				...this.pipelineFactoryOptions,
				emailPipeline: this.email ?? undefined,
				cronReschedule: () => this.cronScheduler?.reschedule(),
				trustedProxyHeaders: getTrustedProxyHeaders(this.config),
			});
			routeRegistry.register(trustedPlugin);

			const routeKey = path.replace(LEADING_SLASH_PATTERN, "");

			const body = await parseRouteInput(request);

			return routeRegistry.invoke(pluginId, routeKey, { request, body, user: caller });
		}

		const sandboxedPlugin = this.findSandboxedPlugin(pluginId);
		if (sandboxedPlugin) {
			return this.handleSandboxedRoute(sandboxedPlugin, path, request, caller);
		}

		return {
			success: false,
			error: { code: "NOT_FOUND", message: `Plugin not found: ${pluginId}` },
		};
	}

	async getPluginMcpTools(pluginId?: string) {
		const tools: Array<{
			pluginId: string;
			name: string;
			description: string;
			route: string;
			permission: string;
			destructive: boolean;
			inputSchema: z.ZodType;
			outputSchema?: z.ZodType;
		}> = [];
		const seen = new Set<string>();

		for (const plugin of this.configuredPlugins) {
			if (pluginId && plugin.id !== pluginId) continue;
			for (const [name, tool] of Object.entries(plugin.mcp?.tools ?? {})) {
				const route = plugin.routes[tool.route];
				if (!route || route.public || !route.permission || !(route.permission in Permissions))
					continue;
				const key = `${plugin.id}__${name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				tools.push({
					pluginId: plugin.id,
					name,
					description: tool.description,
					route: tool.route,
					permission: route.permission,
					destructive: tool.destructive ?? false,
					inputSchema: tool.input,
					outputSchema: tool.output,
				});
			}
		}

		const addManifestTools = (id: string, mcp: PluginMcpManifestConfig | undefined) => {
			if (pluginId && id !== pluginId) return;
			for (const tool of mcp?.tools ?? []) {
				const key = `${id}__${tool.name}`;
				const routeMeta = this.getPluginRouteMeta(id, tool.route);
				if (
					seen.has(key) ||
					!routeMeta ||
					routeMeta.public ||
					routeMeta.permission !== tool.permission ||
					!(tool.permission in Permissions)
				) {
					continue;
				}
				seen.add(key);
				tools.push({
					pluginId: id,
					name: tool.name,
					description: tool.description,
					route: tool.route,
					permission: tool.permission,
					destructive: tool.destructive,
					inputSchema: z.fromJSONSchema({ ...tool.inputSchema }),
					outputSchema: tool.outputSchema ? z.fromJSONSchema({ ...tool.outputSchema }) : undefined,
				});
			}
		};

		for (const entry of this.sandboxedPluginEntries) addManifestTools(entry.id, entry.mcp);
		for (const [id, manifest] of marketplaceManifestCache) addManifestTools(id, manifest.mcp);

		return tools;
	}

	async getEnabledPluginMcpTools() {
		const [tools, states] = await Promise.all([
			this.getPluginMcpTools(),
			new PluginStateRepository(this.db).getAll(),
		]);
		const stateByPlugin = new Map(states.map((state) => [state.pluginId, state]));
		return tools.filter((tool) => {
			const state = stateByPlugin.get(tool.pluginId);
			if (
				!state?.mcpToolsEnabled ||
				state.status !== "active" ||
				!this.isPluginEnabled(tool.pluginId)
			) {
				return false;
			}
			const consented = state.mcpToolsConsent;
			return consented === this.serializePluginMcpConsent(tools, tool.pluginId);
		});
	}

	serializePluginMcpConsent(
		tools: Awaited<ReturnType<EmDashRuntime["getPluginMcpTools"]>>,
		pluginId: string,
	): string {
		return JSON.stringify(
			tools
				.filter((tool) => tool.pluginId === pluginId)
				.map((tool) => ({
					name: tool.name,
					description: tool.description,
					route: tool.route,
					permission: tool.permission,
					destructive: tool.destructive,
					inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
					...(tool.outputSchema
						? { outputSchema: z.toJSONSchema(tool.outputSchema, { target: "draft-7" }) }
						: {}),
				}))
				.toSorted((a, b) => a.name.localeCompare(b.name)),
		);
	}

	async handlePluginMcpTool(
		pluginId: string,
		toolName: string,
		route: string,
		input: unknown,
		actorId: string,
		request: Request,
		caller?: RouteCallerInput | null,
	) {
		const requestMeta = extractRequestMeta(request, getTrustedProxyHeaders(this.config));
		const audit = new AuditRepository(this.db);
		const headers = new Headers(request.headers);
		headers.delete("content-length");
		headers.delete("content-encoding");
		const internalRequest = new Request(request.url, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		const result = await this.handlePluginApiRoute(
			pluginId,
			"POST",
			route,
			internalRequest,
			caller,
		);
		await audit.log({
			actorId,
			actorIp: requestMeta.ip ?? undefined,
			action: "plugin_tool_invoke",
			resourceType: "plugin_mcp_tool",
			resourceId: `${pluginId}__${toolName}`,
			details: { pluginId, tool: toolName, route },
			status: result.success ? "success" : "failure",
		});
		return result;
	}

	async handlePluginMcpDenied(
		pluginId: string,
		toolName: string,
		route: string,
		actorId: string,
		request: Request,
		reason: string,
	): Promise<void> {
		const requestMeta = extractRequestMeta(request, getTrustedProxyHeaders(this.config));
		await new AuditRepository(this.db).log({
			actorId,
			actorIp: requestMeta.ip ?? undefined,
			action: "plugin_tool_invoke",
			resourceType: "plugin_mcp_tool",
			resourceId: `${pluginId}__${toolName}`,
			details: { pluginId, tool: toolName, route, reason },
			status: "denied",
		});
	}

	private findSandboxedPlugin(pluginId: string): SandboxedPluginInstance | undefined {
		for (const [key, plugin] of this.sandboxedPlugins) {
			if (key.startsWith(pluginId + ":")) {
				return plugin;
			}
		}
		return undefined;
	}

	private async normalizeMediaFields(
		collection: string,
		data: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		let collectionInfo;
		try {
			collectionInfo = await this.schemaRegistry.getCollectionWithFields(collection);
		} catch {
			return data;
		}
		if (!collectionInfo?.fields) return data;

		const imageFields = collectionInfo.fields.filter(
			(f) => f.type === "image" || f.type === "file",
		);
		const repeaterFields = collectionInfo.fields.filter(
			(f) => f.type === "repeater" && Array.isArray(f.validation?.subFields),
		);
		if (imageFields.length === 0 && repeaterFields.length === 0) return data;

		const getProvider = (id: string) => this.getMediaProvider(id);
		const result = { ...data };

		for (const field of imageFields) {
			const value = result[field.slug];
			if (value == null) continue;

			try {
				const normalized = await normalizeMediaValue(value, getProvider);
				if (normalized) {
					result[field.slug] = normalized;
				}
			} catch {}
		}

		for (const field of repeaterFields) {
			const value = result[field.slug];
			if (!Array.isArray(value)) continue;

			const mediaSubFieldSlugs = (field.validation?.subFields ?? [])
				.filter((sub) => sub.type === "image")
				.map((sub) => sub.slug);
			if (mediaSubFieldSlugs.length === 0) continue;

			const items: unknown[] = value;
			result[field.slug] = await Promise.all(
				items.map(async (item) => {
					if (!isRecord(item)) return item;
					const normalizedItem: Record<string, unknown> = { ...item };
					for (const slug of mediaSubFieldSlugs) {
						const subValue = normalizedItem[slug];
						if (subValue == null) continue;
						try {
							const normalized = await normalizeMediaValue(subValue, getProvider);
							if (normalized) {
								normalizedItem[slug] = normalized;
							}
						} catch {}
					}
					return normalizedItem;
				}),
			);
		}

		return result;
	}

	private async runSandboxedBeforeSave(
		content: Record<string, unknown>,
		collection: string,
		isNew: boolean,
	): Promise<Record<string, unknown>> {
		let result = content;

		for (const [pluginKey, plugin] of this.sandboxedPlugins) {
			const [id] = pluginKey.split(":");
			if (!id || !this.isPluginEnabled(id)) continue;

			try {
				const hookResult = await plugin.invokeHook("content:beforeSave", {
					content: result,
					collection,
					isNew,
				});
				if (hookResult && typeof hookResult === "object" && !Array.isArray(hookResult)) {
					const record: Record<string, unknown> = {};
					for (const [k, v] of Object.entries(hookResult)) {
						record[k] = v;
					}
					result = record;
				}
			} catch (error) {
				console.error(`EmDash: Sandboxed plugin ${id} beforeSave hook error:`, error);
			}
		}

		return result;
	}

	private async runSandboxedBeforeDelete(id: string, collection: string): Promise<boolean> {
		for (const [pluginKey, plugin] of this.sandboxedPlugins) {
			const [pluginId] = pluginKey.split(":");
			if (!pluginId || !this.isPluginEnabled(pluginId)) continue;

			try {
				const result = await plugin.invokeHook("content:beforeDelete", {
					id,
					collection,
				});
				if (result === false) {
					return false;
				}
			} catch (error) {
				console.error(`EmDash: Sandboxed plugin ${pluginId} beforeDelete hook error:`, error);
			}
		}

		return true;
	}

	private runAfterSaveHooks(
		content: Record<string, unknown>,
		collection: string,
		isNew: boolean,
	): void {
		after(async () => {
			if (this.hooks.hasHooks("content:afterSave")) {
				try {
					await this.hooks.runContentAfterSave(content, collection, isNew);
				} catch (err) {
					console.error("EmDash afterSave hook error:", err);
				}
			}

			const tasks: Promise<void>[] = [];
			for (const [pluginKey, plugin] of this.sandboxedPlugins) {
				const [id] = pluginKey.split(":");
				if (!id || !this.isPluginEnabled(id)) continue;

				tasks.push(
					(async () => {
						try {
							await plugin.invokeHook("content:afterSave", { content, collection, isNew });
						} catch (err) {
							console.error(`EmDash: Sandboxed plugin ${id} afterSave error:`, err);
						}
					})(),
				);
			}
			await Promise.allSettled(tasks);
		});
	}

	private runAfterDeleteHooks(id: string, collection: string, permanent: boolean): void {
		after(async () => {
			if (this.hooks.hasHooks("content:afterDelete")) {
				try {
					await this.hooks.runContentAfterDelete(id, collection, permanent);
				} catch (err) {
					console.error("EmDash afterDelete hook error:", err);
				}
			}

			const tasks: Promise<void>[] = [];
			for (const [pluginKey, plugin] of this.sandboxedPlugins) {
				const [pluginId] = pluginKey.split(":");
				if (!pluginId || !this.isPluginEnabled(pluginId)) continue;

				tasks.push(
					(async () => {
						try {
							await plugin.invokeHook("content:afterDelete", { id, collection, permanent });
						} catch (err) {
							console.error(`EmDash: Sandboxed plugin ${pluginId} afterDelete error:`, err);
						}
					})(),
				);
			}
			await Promise.allSettled(tasks);
		});
	}

	private runDeferredContentHook(
		name:
			| "content:afterPublish"
			| "content:afterUnpublish"
			| "content:afterRestore"
			| "content:afterSchedule"
			| "content:afterUnschedule",
		content: Record<string, unknown>,
		collection: string,
	): void {
		const label = name.slice("content:".length);

		after(async () => {
			if (this.hooks.hasHooks(name)) {
				try {
					switch (name) {
						case "content:afterPublish":
							await this.hooks.runContentAfterPublish(content, collection);
							break;
						case "content:afterUnpublish":
							await this.hooks.runContentAfterUnpublish(content, collection);
							break;
						case "content:afterRestore":
							await this.hooks.runContentAfterRestore(content, collection);
							break;
						case "content:afterSchedule":
							await this.hooks.runContentAfterSchedule(content, collection);
							break;
						case "content:afterUnschedule":
							await this.hooks.runContentAfterUnschedule(content, collection);
							break;
					}
				} catch (err) {
					console.error(`EmDash ${label} hook error:`, err);
				}
			}

			const tasks: Promise<void>[] = [];
			for (const [pluginKey, plugin] of this.sandboxedPlugins) {
				const [pluginId] = pluginKey.split(":");
				if (!pluginId || !this.isPluginEnabled(pluginId)) continue;

				tasks.push(
					(async () => {
						try {
							await plugin.invokeHook(name, { content, collection });
						} catch (err) {
							console.error(`EmDash: Sandboxed plugin ${pluginId} ${label} error:`, err);
						}
					})(),
				);
			}
			await Promise.allSettled(tasks);
		});
	}

	private runAfterPublishHooks(content: Record<string, unknown>, collection: string): void {
		this.runDeferredContentHook("content:afterPublish", content, collection);
	}

	private runAfterUnpublishHooks(content: Record<string, unknown>, collection: string): void {
		this.runDeferredContentHook("content:afterUnpublish", content, collection);
	}

	private runAfterRestoreHooks(content: Record<string, unknown>, collection: string): void {
		this.runDeferredContentHook("content:afterRestore", content, collection);
	}

	private runAfterScheduleHooks(content: Record<string, unknown>, collection: string): void {
		this.runDeferredContentHook("content:afterSchedule", content, collection);
	}

	private runAfterUnscheduleHooks(content: Record<string, unknown>, collection: string): void {
		this.runDeferredContentHook("content:afterUnschedule", content, collection);
	}

	private async handleSandboxedRoute(
		plugin: SandboxedPluginInstance,
		path: string,
		request: Request,
		user?: UserInfo,
	): Promise<{
		success: boolean;
		data?: unknown;
		error?: { code: string; message: string };
		status?: number;
	}> {
		const routeName = path.replace(LEADING_SLASH_PATTERN, "");

		const body = await parseRouteInput(request);

		try {
			const headers = sanitizeHeadersForSandbox(request.headers);
			const meta = extractRequestMeta(request, this.config);
			const result = await plugin.invokeRoute(routeName, body, {
				url: request.url,
				method: request.method,
				headers,
				meta,
				user,
			});
			return { success: true, data: result };
		} catch (error) {
			console.error(`EmDash: Sandboxed plugin route error:`, error);
			const sandboxRouteError = getSandboxRouteErrorDetails(error);
			if (sandboxRouteError) {
				return {
					success: false,
					status: sandboxRouteError.status,
					error: {
						code: sandboxRouteError.code,
						message: sandboxRouteError.message,
					},
				};
			}
			return {
				success: false,
				error: {
					code: "ROUTE_ERROR",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private pageContributionCache = new WeakMap<PublicPageContext, Promise<PageContributions>>();

	async collectPageContributions(page: PublicPageContext): Promise<PageContributions> {
		const cached = this.pageContributionCache.get(page);
		if (cached) return cached;

		const promise = this.doCollectPageContributions(page);
		this.pageContributionCache.set(page, promise);
		return promise;
	}

	private async doCollectPageContributions(page: PublicPageContext): Promise<PageContributions> {
		const metadata: PageMetadataContribution[] = [];
		const fragments: PageFragmentContribution[] = [];

		if (this.hooks.hasHooks("page:metadata")) {
			const results = await this.hooks.runPageMetadata({ page });
			for (const r of results) {
				metadata.push(...r.contributions);
			}
		}

		if (this.hooks.hasHooks("page:fragments")) {
			const results = await this.hooks.runPageFragments({ page });
			for (const r of results) {
				fragments.push(...r.contributions);
			}
		}

		for (const [pluginKey, plugin] of this.sandboxedPlugins) {
			const [id] = pluginKey.split(":");
			if (!id || !this.isPluginEnabled(id)) continue;

			try {
				const result = await plugin.invokeHook("page:metadata", { page });
				if (result != null) {
					const items = Array.isArray(result) ? result : [result];
					for (const item of items) {
						if (isValidMetadataContribution(item)) {
							metadata.push(item);
						}
					}
				}
			} catch (error) {
				console.error(`EmDash: Sandboxed plugin ${id} page:metadata error:`, error);
			}
		}

		return { metadata, fragments };
	}

	async collectPageMetadata(page: PublicPageContext): Promise<PageMetadataContribution[]> {
		const { metadata } = await this.collectPageContributions(page);
		return metadata;
	}

	async collectPageFragments(page: PublicPageContext): Promise<PageFragmentContribution[]> {
		const { fragments } = await this.collectPageContributions(page);
		return fragments;
	}

	private isPluginEnabled(pluginId: string): boolean {
		const status = this.pluginStates.get(pluginId);
		const defaultEnabled = this.sandboxedPluginEntries.find(
			(entry) => entry.id === pluginId,
		)?.defaultEnabled;
		return isPluginStateEnabled(status, defaultEnabled);
	}
}
