import type { APIContext } from "astro";
import { defineMiddleware } from "astro:middleware";
import type { Kysely } from "kysely";
// @ts-ignore - virtual module
import { buildTime as virtualBuildTime } from "virtual:emdash/build";
// @ts-ignore - virtual module
import virtualConfig from "virtual:emdash/config";
// @ts-ignore - virtual module
import {
	createCoalescingDialect as virtualCreateCoalescingDialect,
	createDialect as virtualCreateDialect,
	createRequestScopedDb as virtualCreateRequestScopedDb,
} from "virtual:emdash/dialect";
import type { RequestScopedDbOpts } from "virtual:emdash/dialect";
// @ts-ignore - virtual module
import { mediaProviders as virtualMediaProviders } from "virtual:emdash/media-providers";
// @ts-ignore - virtual module
import { plugins as virtualPlugins } from "virtual:emdash/plugins";
// @ts-ignore - virtual module
import * as virtualSandboxRunnerModule from "virtual:emdash/sandbox-runner";
// @ts-ignore - virtual module
import { sandboxedPlugins as virtualSandboxedPlugins } from "virtual:emdash/sandboxed-plugins";
// @ts-ignore - virtual module
import { createScheduler as virtualCreateScheduler } from "virtual:emdash/scheduler";
// @ts-ignore - virtual module
import { createStorage as virtualCreateStorage } from "virtual:emdash/storage";

import { after } from "../after.js";
import {
	createRecorder,
	flushRecorder,
	isInstrumentationEnabled,
} from "../database/instrumentation.js";
import {
	PendingMigrationsError,
	resolveRuntimeMigrationMode,
	type RuntimeMigrationMode,
} from "../database/migrations/policy.js";
import { createDeferredTaskTracker } from "../deferred-tasks.js";
import {
	DB_INIT_DEADLINE_MS,
	EmDashRuntime,
	type RuntimeDependencies,
	type SandboxedPluginEntry,
	type MediaProviderEntry,
	type CreateSchedulerFn,
} from "../emdash-runtime.js";
import { setI18nConfig } from "../i18n/config.js";
import type { Database, Storage } from "../index.js";
import { createPublicMediaUrlResolver } from "../media/url.js";
import { getLastContentWriteAt } from "../object-cache/index.js";
import type { SandboxRunnerFactory } from "../plugins/sandbox/types.js";
import type { ResolvedPlugin } from "../plugins/types.js";
import { invalidateUrlPatternCache } from "../query.js";
import {
	createRequestMetrics,
	getRequestContext,
	type RequestMetrics,
	runWithContext,
} from "../request-context.js";
import type { PublishedRef } from "../scheduled-publish.js";
import { isMissingTableError } from "../utils/db-errors.js";
import { createInitLock, type InitLock, initWithLock } from "../utils/init-lock.js";
import type { EmDashConfig } from "./integration/runtime.js";
import {
	ASTRO_COOKIES_SYMBOL,
	coordinateScopedDbLifecycle,
	finishScoped,
	requestEndedAuthenticated,
} from "./middleware/scoped-db.js";
import { wrapBodyForStreamMetrics } from "./middleware/stream-end-metrics.js";
import { prefetchLayoutData } from "./prefetch.js";
import { createPublicPluginApiRouteHandler } from "./public-plugin-api-routes.js";
import { resolveSessionUser } from "./session-user.js";
import type { EmDashHandlers } from "./types.js";

export type { EmDashRuntime } from "../emdash-runtime.js";

const RUNTIME_INIT_DEADLINE_MS = DB_INIT_DEADLINE_MS + 15_000;

const RUNTIME_INIT_ERROR_LOG_INTERVAL_MS = 30_000;
let lastRuntimeInitErrorLogAt = 0;

const SETUP_VERIFIED_KEY = Symbol.for("emdash:setup-verified");
const setupFlagStore = globalThis as Record<symbol, unknown>;

function isSetupVerified(): boolean {
	return setupFlagStore[SETUP_VERIFIED_KEY] === true;
}

function markSetupVerified(): void {
	setupFlagStore[SETUP_VERIFIED_KEY] = true;
}

const RUNTIME_HOLDER_KEY = Symbol.for("emdash:runtime-holder");
interface RuntimeHolder {
	instance: EmDashRuntime | null;
	lock: InitLock;
}

function getRuntimeHolder(): RuntimeHolder {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis symbol slot, written only below
	let holder = setupFlagStore[RUNTIME_HOLDER_KEY] as RuntimeHolder | undefined;
	if (!holder) {
		holder = { instance: null, lock: createInitLock() };
		setupFlagStore[RUNTIME_HOLDER_KEY] = holder;
	}
	return holder;
}

let i18nInitialized = false;

function getConfig(): EmDashConfig | null {
	if (virtualConfig && typeof virtualConfig === "object") {
		if (!i18nInitialized) {
			i18nInitialized = true;
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- virtual module checked as object above
			const config = virtualConfig as Record<string, unknown>;
			if (config.i18n && typeof config.i18n === "object") {
				setI18nConfig(
					// eslint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-checked above
					config.i18n as {
						defaultLocale: string;
						locales: string[];
						fallback?: Record<string, string>;
					},
				);
			} else {
				setI18nConfig(null);
			}
		}

		return virtualConfig;
	}
	return null;
}

function getPlugins(): ResolvedPlugin[] {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- virtual module import is untyped (@ts-ignore above)
	return (virtualPlugins as ResolvedPlugin[]) || [];
}

function buildDependencies(
	config: EmDashConfig,
	migrationMode: RuntimeMigrationMode,
): RuntimeDependencies {
	/* eslint-disable typescript-eslint/no-unsafe-type-assertion --
	   The virtual:emdash/* imports above use @ts-ignore because tsgo/IDE
	   resolution can't see virtual-modules.d.ts in every consumer setup,
	   so they arrive as `any`. The casts here line each entry up with
	   RuntimeDependencies's expected shape. The contract is enforced by
	   the integration that populates these virtual modules. */
	const sandboxModule = virtualSandboxRunnerModule as Record<string, unknown>;
	return {
		config,
		migrationMode,
		plugins: getPlugins(),
		createDialect: virtualCreateDialect as (config: Record<string, unknown>) => unknown,
		createCoalescingDialect: virtualCreateCoalescingDialect as
			| ((config: Record<string, unknown>) => unknown)
			| undefined,
		createStorage: virtualCreateStorage as ((config: Record<string, unknown>) => Storage) | null,
		createScheduler: virtualCreateScheduler as CreateSchedulerFn | null,
		sandboxEnabled: sandboxModule.sandboxEnabled as boolean,
		sandboxBypassed: (sandboxModule.sandboxBypassed as boolean) ?? false,
		sandboxedPluginEntries: (virtualSandboxedPlugins as SandboxedPluginEntry[]) || [],
		createSandboxRunner: sandboxModule.createSandboxRunner as SandboxRunnerFactory | null,
		mediaProviderEntries: (virtualMediaProviders as MediaProviderEntry[]) || [],
	};
	/* eslint-enable typescript-eslint/no-unsafe-type-assertion */
}

async function getRuntime(
	config: EmDashConfig,
	migrationMode: RuntimeMigrationMode,
	initTimings?: Array<{ name: string; dur: number; desc?: string }>,
): Promise<EmDashRuntime> {
	const holder = getRuntimeHolder();
	return initWithLock(
		holder.lock,
		() => holder.instance,
		async (isCurrentClaim) => {
			const deps = buildDependencies(config, migrationMode);
			const runtime = await EmDashRuntime.create(deps, initTimings);
			if (isCurrentClaim()) {
				holder.instance = runtime;
			} else {
				runtime.stopCron().catch((error: unknown) => {
					console.error("[emdash] failed to stop superseded runtime's cron:", error);
				});
			}
			return runtime;
		},
		{
			deadlineMs: RUNTIME_INIT_DEADLINE_MS,
			anchor: (promise) => after(() => promise),
		},
	);
}

export async function runScheduledTasks(
	options: { onPublished?: (refs: PublishedRef[]) => Promise<void> } = {},
): Promise<{ published: PublishedRef[] }> {
	const config = getConfig();
	if (!config) return { published: [] };
	return runOutsideRequest(config, (runtime) => runtime.runScheduledTasks(options));
}

export async function withEmDashRuntime<T>(
	run: (runtime: EmDashRuntime) => T | Promise<T>,
): Promise<T> {
	const config = getConfig();
	if (!config) {
		throw new Error(
			"EmDash is not configured — withEmDashRuntime() requires the emdash() Astro integration.",
		);
	}
	return runOutsideRequest(config, async (runtime) => run(runtime));
}

async function runOutsideRequest<T>(
	config: EmDashConfig,
	fn: (runtime: EmDashRuntime) => Promise<T>,
): Promise<T> {
	const migrationMode = resolveConfiguredMigrationMode(config);
	if (getRequestContext()) {
		const runtime = await getRuntime(config, migrationMode);
		return runOutsideRequestWithRuntime(config, runtime, fn);
	}

	const deferredTasks = createDeferredTaskTracker(() => {});
	const context = {
		editMode: false,
		metrics: createRequestMetrics(performance.now()),
		deferredTasks,
	};
	return runWithContext(context, async () => {
		const runtime = await (async () => {
			try {
				return await getRuntime(config, migrationMode);
			} finally {
				deferredTasks.settle();
				await deferredTasks.settled;
			}
		})();
		return runOutsideRequestWithRuntime(config, runtime, fn);
	});
}

async function runOutsideRequestWithRuntime<T>(
	config: EmDashConfig,
	runtime: EmDashRuntime,
	fn: (runtime: EmDashRuntime) => Promise<T>,
): Promise<T> {
	const scoped = createRequestScopedDb({
		config: config.database?.config,
		isAuthenticated: false,
		isWrite: true,
		canUseCachedBinding: false,
		cookies: NOOP_COOKIE_JAR,
		url: CRON_EVENT_URL,
	});
	if (!scoped) {
		return fn(runtime);
	}
	const { closed, deferredTasks, lifecycle } = coordinateScopedDbLifecycle(scoped);

	const parent = getRequestContext();
	const ctx = parent
		? { ...parent, db: scoped.db, deferredTasks }
		: {
				editMode: false,
				db: scoped.db,
				metrics: createRequestMetrics(performance.now()),
				deferredTasks,
			};
	try {
		return await runWithContext(ctx, () => fn(runtime));
	} finally {
		try {
			lifecycle.commit();
		} catch (error) {
			console.error("[emdash] event-scoped db commit failed:", error);
		}
		try {
			lifecycle.close?.();
		} catch (error) {
			console.error("[emdash] event-scoped db close failed:", error);
		}
		await closed;
	}
}

const NOOP_COOKIE_JAR = {
	get: () => undefined,
	set: () => {},
};

const CRON_EVENT_URL = new URL("https://cron.emdash.internal/");

function resolveConfiguredMigrationMode(config: EmDashConfig): RuntimeMigrationMode {
	const processOverride =
		typeof process !== "undefined" && process.env ? process.env.EMDASH_MIGRATIONS_MODE : undefined;
	const importMetaOverride = import.meta.env.EMDASH_MIGRATIONS_MODE;
	return resolveRuntimeMigrationMode(config.migrations, {
		dev: import.meta.env.DEV,
		override: processOverride ?? importMetaOverride,
	});
}

function pendingMigrationsResponse(error: PendingMigrationsError): Response {
	console.error("[emdash] database migrations are pending:", error.pending.join(", "));
	return migrationRequiredResponse();
}

function migrationRequiredResponse(): Response {
	return new Response(
		"Database migrations are required. Apply the deployment migration manifest and retry.",
		{
			status: 503,
			headers: { "Retry-After": "60" },
		},
	);
}

function finalizeResponse(
	response: Response,
	serverTimings?: Array<{ name: string; dur: number; desc?: string }>,
): Response {
	const res = new Response(response.body, response);
	const astroCookies = Reflect.get(response, ASTRO_COOKIES_SYMBOL);
	if (astroCookies !== undefined) {
		Reflect.set(res, ASTRO_COOKIES_SYMBOL, astroCookies);
	}
	if (!res.headers.has("X-Content-Type-Options")) {
		res.headers.set("X-Content-Type-Options", "nosniff");
	}
	if (!res.headers.has("Referrer-Policy")) {
		res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	}
	if (!res.headers.has("Permissions-Policy")) {
		res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
	}
	if (!res.headers.has("Content-Security-Policy")) {
		res.headers.set("X-Frame-Options", "SAMEORIGIN");
	}
	if (serverTimings && serverTimings.length > 0) {
		res.headers.set(
			"Server-Timing",
			serverTimings
				.map((t) => {
					const dur = Math.round(t.dur);
					return t.desc ? `${t.name};dur=${dur};desc="${t.desc}"` : `${t.name};dur=${dur}`;
				})
				.join(", "),
		);
	}
	return res;
}

function pushMetricsTimings(
	timings: Array<{ name: string; dur: number; desc?: string }>,
	metrics: RequestMetrics,
): void {
	if (metrics.dbCount > 0) {
		timings.push({ name: "db.total", dur: metrics.dbTotalMs, desc: "DB total" });
		timings.push({ name: "db.count", dur: metrics.dbCount, desc: "Query count" });
		if (metrics.dbFirstOffset !== null) {
			timings.push({ name: "db.first", dur: metrics.dbFirstOffset, desc: "First query at" });
		}
		if (metrics.dbLastOffset !== null) {
			timings.push({ name: "db.last", dur: metrics.dbLastOffset, desc: "Last query at" });
		}
	}
	if (metrics.rpcCount > 0) {
		timings.push({ name: "rpc.count", dur: metrics.rpcCount, desc: "DB round trips" });
	}
	if (metrics.cacheHits + metrics.cacheMisses > 0) {
		timings.push({ name: "cache.hit", dur: metrics.cacheHits, desc: "Cache hits" });
		timings.push({ name: "cache.miss", dur: metrics.cacheMisses, desc: "Cache misses" });
	}
}

const PUBLIC_RUNTIME_ROUTES = new Set(["/sitemap.xml", "/robots.txt"]);
const SITEMAP_COLLECTION_RE = /^\/sitemap-[a-z][a-z0-9_]*\.xml$/;

function createRequestScopedDb(
	opts: RequestScopedDbOpts,
): { db: Kysely<Database>; commit: () => void; close?: () => void } | null {
	if (typeof virtualCreateRequestScopedDb !== "function") return null;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- adapter returns Kysely<unknown>; cast to Database since core owns that type
	const fn = virtualCreateRequestScopedDb as (
		o: RequestScopedDbOpts,
	) => { db: Kysely<Database>; commit: () => void; close?: () => void } | null;
	return fn(opts);
}

const buildDate = virtualBuildTime ? new Date(virtualBuildTime) : null;

function applyBuildValidator(context: APIContext): void {
	if (context.isPrerendered || !buildDate || !context.cache?.enabled) return;
	context.cache.set({ lastModified: buildDate });
}

export const onRequest = defineMiddleware(async (context, next) => {
	const { request, locals, cookies } = context;
	const url = context.url;

	if (!url.pathname.startsWith("/_emdash") && virtualConfig?.authProviders) {
		const isPluginFastRoute = virtualConfig.authProviders.some(
			(p: { routes?: { pattern?: string }[] }) =>
				p.routes?.some((r: { pattern?: string }) => r.pattern && url.pathname === r.pattern),
		);
		if (isPluginFastRoute) {
			return finalizeResponse(await next());
		}
	}

	applyBuildValidator(context);

	const queryRecorder = isInstrumentationEnabled()
		? createRecorder(url.pathname, request.method, request.headers.get("x-perf-phase") ?? "default")
		: undefined;

	const metrics = createRequestMetrics(performance.now());

	const run = async (): Promise<Response> => {
		const config = getConfig();
		const migrationMode = config ? resolveConfiguredMigrationMode(config) : "auto";
		const isEmDashRoute = url.pathname.startsWith("/_emdash");
		const isPublicRuntimeRoute =
			PUBLIC_RUNTIME_ROUTES.has(url.pathname) || SITEMAP_COLLECTION_RE.test(url.pathname);

		const hasEditCookie = cookies.get("emdash-edit-mode")?.value === "true";
		const hasPreviewToken = url.searchParams.has("_preview");

		const playgroundDb = locals.__playgroundDb;

		const hasSessionCookie = cookies.get("astro-session") !== undefined;
		const sessionUser =
			context.isPrerendered || !hasSessionCookie ? null : await resolveSessionUser(context.session);

		const hasBearerAuth = (request.headers.get("authorization") ?? "")
			.toLowerCase()
			.startsWith("bearer ");
		const isWrite = request.method !== "GET" && request.method !== "HEAD";
		const isAuthenticated = !!sessionUser || hasBearerAuth;
		const endedAuthenticated = () => requestEndedAuthenticated(isAuthenticated, cookies);
		const canUseCachedBinding =
			!isAuthenticated &&
			!isWrite &&
			!playgroundDb &&
			!isEmDashRoute &&
			!hasEditCookie &&
			!hasPreviewToken;

		if (!isEmDashRoute && !isPublicRuntimeRoute && !hasEditCookie && !hasPreviewToken) {
			if (!sessionUser && !playgroundDb) {
				const timings: Array<{ name: string; dur: number; desc?: string }> = [];
				const mwStart = performance.now();

				if (migrationMode === "auto" && !isSetupVerified() && !context.isPrerendered) {
					const t0 = performance.now();
					try {
						const { getDb } = await import("../loader.js");
						const db = await getDb();
						await db.selectFrom("_emdash_migrations").selectAll().limit(1).execute();
						markSetupVerified();
					} catch (error) {
						if (isMissingTableError(error)) {
							return context.redirect("/_emdash/admin/setup");
						}
						console.error("Setup probe failed (non-fatal):", error);
					}
					timings.push({ name: "setup", dur: performance.now() - t0, desc: "Setup probe" });
				}

				if (config) {
					const initSubTimings: Array<{ name: string; dur: number; desc?: string }> = [];
					const t0 = performance.now();
					try {
						const runtime = await getRuntime(config, migrationMode, initSubTimings);
						markSetupVerified();
						const handlePublicPluginApiRoute = createPublicPluginApiRouteHandler(runtime);
						// eslint-disable-next-line typescript/no-unsafe-type-assertion -- partial object; getPageRuntime() only checks for the page-contribution methods
						locals.emdash = {
							handlePublicPluginApiRoute,
							collectPageMetadata: runtime.collectPageMetadata.bind(runtime),
							collectPageFragments: runtime.collectPageFragments.bind(runtime),
							getPublicMediaUrl: createPublicMediaUrlResolver(runtime.storage),
							storage: runtime.storage,
						} as EmDashHandlers;
					} catch (error) {
						if (error instanceof PendingMigrationsError) {
							return pendingMigrationsResponse(error);
						}
						if (migrationMode === "manual" && isMissingTableError(error)) {
							console.error(
								"[emdash] database schema is unavailable in manual migration mode:",
								error,
							);
							return migrationRequiredResponse();
						}
						if (Date.now() - lastRuntimeInitErrorLogAt >= RUNTIME_INIT_ERROR_LOG_INTERVAL_MS) {
							lastRuntimeInitErrorLogAt = Date.now();
							console.error("[emdash] runtime init failed (page renders without CMS data):", error);
						}
					}
					timings.push({ name: "rt", dur: performance.now() - t0, desc: "Runtime init" });
					for (const sub of initSubTimings) timings.push(sub);
				}

				const lastContentWriteAt =
					canUseCachedBinding && config?.database?.needsLastContentWriteAt
						? await getLastContentWriteAt()
						: undefined;
				const anonScoped = createRequestScopedDb({
					config: config?.database?.config,
					isAuthenticated,
					endedAuthenticated,
					isWrite,
					canUseCachedBinding,
					cookies,
					url,
					lastContentWriteAt,
				});
				const runAnon = async () => {
					const t0 = performance.now();
					const response = await next();
					timings.push({ name: "render", dur: performance.now() - t0, desc: "Page render" });
					timings.push({ name: "mw", dur: performance.now() - mwStart, desc: "Total middleware" });
					pushMetricsTimings(timings, metrics);
					return wrapBodyForStreamMetrics(finalizeResponse(response, timings));
				};
				if (anonScoped) {
					const { deferredTasks, lifecycle } = coordinateScopedDbLifecycle(anonScoped);
					const parent = getRequestContext();
					const ctx = parent
						? { ...parent, db: anonScoped.db, deferredTasks }
						: { editMode: false, db: anonScoped.db, metrics, deferredTasks };
					const acceptsHtml = (request.headers.get("accept") ?? "")
						.split(",", 1)[0]!
						.trim()
						.startsWith("text/html");
					return runWithContext(ctx, async () => {
						if (acceptsHtml) after(() => prefetchLayoutData());
						return finishScoped(lifecycle, runAnon);
					});
				}
				return runAnon();
			}
		}

		if (!config) {
			console.error("EmDash: No configuration found");
			return finalizeResponse(await next());
		}

		const doInit = async () => {
			const timings: Array<{ name: string; dur: number; desc?: string }> = [];
			const mwStart = performance.now();

			try {
				const initSubTimings: Array<{ name: string; dur: number; desc?: string }> = [];
				let t0 = performance.now();
				const runtime = await getRuntime(config, migrationMode, initSubTimings);
				timings.push({ name: "rt", dur: performance.now() - t0, desc: "Runtime init" });
				for (const sub of initSubTimings) timings.push(sub);

				markSetupVerified();

				locals.emdash = {
					handleContentList: runtime.handleContentList.bind(runtime),
					handleContentGet: runtime.handleContentGet.bind(runtime),
					handleContentAuthors: runtime.handleContentAuthors.bind(runtime),
					handleContentCreate: runtime.handleContentCreate.bind(runtime),
					handleContentUpdate: runtime.handleContentUpdate.bind(runtime),
					handleContentDelete: runtime.handleContentDelete.bind(runtime),

					handleContentListTrashed: runtime.handleContentListTrashed.bind(runtime),
					handleContentRestore: runtime.handleContentRestore.bind(runtime),
					handleContentPermanentDelete: runtime.handleContentPermanentDelete.bind(runtime),
					handleContentCountTrashed: runtime.handleContentCountTrashed.bind(runtime),
					handleContentGetIncludingTrashed: runtime.handleContentGetIncludingTrashed.bind(runtime),

					handleContentDuplicate: runtime.handleContentDuplicate.bind(runtime),

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

					inspectPluginHealth: runtime.inspectPluginHealth.bind(runtime),
					handlePluginApiRoute: runtime.handlePluginApiRoute.bind(runtime),
					handlePublicPluginApiRoute: createPublicPluginApiRouteHandler(runtime),
					getPluginRouteMeta: runtime.getPluginRouteMeta.bind(runtime),
					getPluginMcpTools: runtime.getPluginMcpTools.bind(runtime),
					getEnabledPluginMcpTools: runtime.getEnabledPluginMcpTools.bind(runtime),
					serializePluginMcpConsent: runtime.serializePluginMcpConsent.bind(runtime),
					handlePluginMcpTool: runtime.handlePluginMcpTool.bind(runtime),
					handlePluginMcpDenied: runtime.handlePluginMcpDenied.bind(runtime),

					getMediaProvider: runtime.getMediaProvider.bind(runtime),
					getMediaProviderList: runtime.getMediaProviderList.bind(runtime),

					collectPageMetadata: runtime.collectPageMetadata.bind(runtime),
					collectPageFragments: runtime.collectPageFragments.bind(runtime),

					ensureSearchHealthy: runtime.ensureSearchHealthy.bind(runtime),

					storage: runtime.storage,
					get db() {
						return runtime.db;
					},
					getPublicMediaUrl: createPublicMediaUrlResolver(runtime.storage),
					hooks: runtime.hooks,
					email: runtime.email,
					configuredPlugins: runtime.configuredPlugins,
					sandboxedPluginEntries: runtime.sandboxedPluginEntries,

					config,

					getManifest: runtime.getManifest.bind(runtime),

					invalidateUrlPatternCache,

					getSandboxRunner: runtime.getSandboxRunner.bind(runtime),
					isSandboxBypassed: runtime.isSandboxBypassed.bind(runtime),

					syncMarketplacePlugins: runtime.syncMarketplacePlugins.bind(runtime),

					syncRegistryPlugins: runtime.syncRegistryPlugins.bind(runtime),

					setPluginStatus: runtime.setPluginStatus.bind(runtime),
				};
			} catch (error) {
				if (error instanceof PendingMigrationsError) {
					return pendingMigrationsResponse(error);
				}
				if (migrationMode === "manual" && isMissingTableError(error)) {
					console.error("[emdash] database schema is unavailable in manual migration mode:", error);
					return migrationRequiredResponse();
				}
				console.error("EmDash middleware error:", error);
			}

			const lastContentWriteAt =
				canUseCachedBinding && config?.database?.needsLastContentWriteAt
					? await getLastContentWriteAt()
					: undefined;
			const scoped = createRequestScopedDb({
				config: config?.database?.config,
				isAuthenticated,
				endedAuthenticated,
				isWrite,
				canUseCachedBinding,
				cookies: context.cookies,
				url,
				lastContentWriteAt,
			});

			const renderAndFinalize = async () => {
				const t0 = performance.now();
				const response = await next();
				timings.push({ name: "render", dur: performance.now() - t0, desc: "Page render" });
				timings.push({ name: "mw", dur: performance.now() - mwStart, desc: "Total middleware" });
				pushMetricsTimings(timings, metrics);
				return wrapBodyForStreamMetrics(finalizeResponse(response, timings));
			};

			if (scoped) {
				const { deferredTasks, lifecycle } = coordinateScopedDbLifecycle(scoped);
				const parent = getRequestContext();
				const ctx = parent
					? { ...parent, db: scoped.db, deferredTasks }
					: { editMode: false, db: scoped.db, metrics, deferredTasks };
				return runWithContext(ctx, () => finishScoped(lifecycle, renderAndFinalize));
			}

			return renderAndFinalize();
		};

		if (playgroundDb) {
			const editMode = context.cookies.get("emdash-edit-mode")?.value === "true";
			const parent = getRequestContext();
			const ctx = parent
				? { ...parent, editMode, db: playgroundDb, dbIsIsolated: true }
				: { editMode, db: playgroundDb, dbIsIsolated: true, metrics };
			return runWithContext(ctx, doInit);
		}
		return doInit();
	};

	try {
		return await runWithContext({ editMode: false, queryRecorder, metrics }, run);
	} finally {
		if (queryRecorder && !queryRecorder.deferredFlush) flushRecorder(queryRecorder);
	}
});

export default onRequest;
