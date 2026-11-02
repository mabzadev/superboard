import { after } from "../after.js";
import { getRequestContext } from "../request-context.js";
import { decode, encode } from "./codec.js";
import type {
	CreateObjectCacheBackendFn,
	ObjectCacheBackend,
	ObjectCacheRuntimeConfig,
} from "./types.js";

const DEFAULT_KEY_PREFIX = "em";
const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_REVALIDATE_MS = 1000;
const DEFAULT_TIMEOUT_MS = 2000;

interface BackendHolder {
	initialized: boolean;
	backend: ObjectCacheBackend | null;
	initPromise: Promise<ObjectCacheBackend | null> | null;
	config: Required<Pick<ObjectCacheRuntimeConfig, "keyPrefix">> & {
		defaultTtl: number;
		revalidate: number;
		timeout: number;
	};
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	if (!(ms > 0)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new Error(`object-cache ${label} timed out after ${ms}ms`));
		}, ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface EpochEntry {
	value: number;
	at: number;
	promise?: Promise<number>;
	promiseAt?: number;
}

const EPOCH_READ_GRACE_MS = 1_000;

function epochReadDeadline(): number {
	const timeout = holder.config.timeout > 0 ? holder.config.timeout : DEFAULT_TIMEOUT_MS;
	return timeout + EPOCH_READ_GRACE_MS;
}

function raceInFlightEpochRead(
	promise: Promise<number>,
	ms: number,
	fallback: number,
): Promise<number> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<number>((resolve) => {
		timer = setTimeout(resolve, Math.max(ms, 1), fallback);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const BACKEND_KEY = Symbol.for("emdash:object-cache:backend");
const EPOCH_KEY = Symbol.for("emdash:object-cache:epochs");
const PENDING_KEY = Symbol.for("emdash:object-cache:pending-bumps");
const LAST_CONTENT_WRITE_KEY = Symbol.for("emdash:object-cache:last-content-write");
const PENDING_CONTENT_WRITE_KEY = Symbol.for("emdash:object-cache:pending-content-write");
const g = globalThis as Record<symbol, unknown>;

const holder: BackendHolder =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[BACKEND_KEY] as BackendHolder | undefined) ??
	(() => {
		const h: BackendHolder = {
			initialized: false,
			backend: null,
			initPromise: null,
			config: {
				keyPrefix: DEFAULT_KEY_PREFIX,
				defaultTtl: DEFAULT_TTL_SECONDS,
				revalidate: DEFAULT_REVALIDATE_MS,
				timeout: DEFAULT_TIMEOUT_MS,
			},
		};
		g[BACKEND_KEY] = h;
		return h;
	})();

const epochCache: Map<string, EpochEntry> =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[EPOCH_KEY] as Map<string, EpochEntry> | undefined) ??
	(() => {
		const m = new Map<string, EpochEntry>();
		g[EPOCH_KEY] = m;
		return m;
	})();

const pendingBumps: Set<string> =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[PENDING_KEY] as Set<string> | undefined) ??
	(() => {
		const s = new Set<string>();
		g[PENDING_KEY] = s;
		return s;
	})();

interface LastContentWriteState {
	value: number;
	at: number;
	promise?: Promise<number>;
	promiseAt?: number;
}

const lastContentWrite: LastContentWriteState =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[LAST_CONTENT_WRITE_KEY] as LastContentWriteState | undefined) ??
	(() => {
		const s: LastContentWriteState = { value: 0, at: 0 };
		g[LAST_CONTENT_WRITE_KEY] = s;
		return s;
	})();

const contentWritePersist: { pending: boolean } =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[PENDING_CONTENT_WRITE_KEY] as { pending: boolean } | undefined) ??
	(() => {
		const s = { pending: false };
		g[PENDING_CONTENT_WRITE_KEY] = s;
		return s;
	})();
async function getBackend(): Promise<ObjectCacheBackend | null> {
	if (holder.initialized) return holder.backend;
	if (holder.initPromise) return holder.initPromise;

	holder.initPromise = (async () => {
		try {
			const mod: {
				createObjectCache?: CreateObjectCacheBackendFn;
				objectCacheConfig?: ObjectCacheRuntimeConfig;
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-ignore - virtual module
			} = await import("virtual:emdash/object-cache");

			const config = mod.objectCacheConfig ?? {};
			holder.config = {
				keyPrefix:
					typeof config.keyPrefix === "string" && config.keyPrefix.length > 0
						? config.keyPrefix
						: DEFAULT_KEY_PREFIX,
				defaultTtl:
					typeof config.defaultTtl === "number" && config.defaultTtl > 0
						? config.defaultTtl
						: DEFAULT_TTL_SECONDS,
				revalidate:
					typeof config.revalidate === "number" && config.revalidate >= 0
						? config.revalidate
						: DEFAULT_REVALIDATE_MS,
				timeout:
					typeof config.timeout === "number" && config.timeout >= 0
						? config.timeout
						: DEFAULT_TIMEOUT_MS,
			};

			holder.backend =
				typeof mod.createObjectCache === "function" ? mod.createObjectCache(config) : null;
		} catch (error) {
			if (import.meta.env?.DEV) {
				console.warn("[object-cache] backend unavailable:", error);
			}
			holder.backend = null;
		}
		holder.initialized = true;
		holder.initPromise = null;
		return holder.backend;
	})();

	return holder.initPromise;
}

export function __setObjectCacheBackendForTests(
	backend: ObjectCacheBackend | null,
	config?: Partial<BackendHolder["config"]>,
): void {
	holder.initialized = true;
	holder.initPromise = null;
	holder.backend = backend;
	holder.config = { ...holder.config, ...config };
	epochCache.clear();
	lastContentWrite.value = 0;
	lastContentWrite.at = 0;
	lastContentWrite.promise = undefined;
	lastContentWrite.promiseAt = undefined;
	contentWritePersist.pending = false;
}

function epochKey(namespace: string): string {
	return `${holder.config.keyPrefix}:epoch:${namespace}`;
}

function lastContentWriteKey(): string {
	return `${holder.config.keyPrefix}:last-content-write-at`;
}

function isContentNamespace(namespace: string): boolean {
	return namespace.startsWith("content:");
}
function valueKey(namespaces: readonly string[], key: string): string {
	return `${holder.config.keyPrefix}:${namespaces.join(",")}:${key}`;
}

interface CacheEnvelope<T> {
	e: number[];
	v: T;
}

function epochsMatch(stored: readonly number[], current: readonly number[]): boolean {
	if (stored.length !== current.length) return false;
	for (let i = 0; i < stored.length; i++) {
		if (stored[i] !== current[i]) return false;
	}
	return true;
}

function shouldBypass(): boolean {
	const ctx = getRequestContext();
	if (!ctx) return false;
	return ctx.editMode === true || ctx.preview !== undefined || ctx.dbIsIsolated === true;
}

async function getEpoch(namespace: string, backend: ObjectCacheBackend): Promise<number> {
	const now = Date.now();
	const cached = epochCache.get(namespace);
	if (cached && now - cached.at < holder.config.revalidate) {
		return cached.value;
	}
	if (cached?.promise) {
		const age = now - (cached.promiseAt ?? 0);
		const deadline = epochReadDeadline();
		if (age < deadline) {
			return raceInFlightEpochRead(cached.promise, deadline - age, cached.value);
		}
	}

	const promise = (async () => {
		let value: number;
		try {
			const raw = await withTimeout(
				backend.get(epochKey(namespace)),
				holder.config.timeout,
				"epoch read",
			);
			const parsed = raw === null ? 0 : Number(raw);
			value = Number.isFinite(parsed) ? parsed : 0;
		} catch {
			value = cached?.value ?? 0;
		}
		const merged = Math.max(value, epochCache.get(namespace)?.value ?? 0);
		epochCache.set(namespace, { value: merged, at: Date.now() });
		return merged;
	})();

	after(() =>
		promise.then(
			() => undefined,
			() => undefined,
		),
	);

	epochCache.set(namespace, {
		value: cached?.value ?? 0,
		at: cached?.at ?? 0,
		promise,
		promiseAt: now,
	});
	return promise;
}

export interface CachedQueryOptions<T> {
	namespace: string | readonly string[];
	key: string;
	load: () => Promise<T>;
	ttl?: number;
	cacheable?: (value: T) => boolean;
}

export async function cachedQuery<T>(options: CachedQueryOptions<T>): Promise<T> {
	const backend = await getBackend();
	if (!backend || shouldBypass()) {
		return options.load();
	}

	const namespaces =
		typeof options.namespace === "string" ? [options.namespace] : options.namespace;
	const fullKey = valueKey(namespaces, options.key);

	const epochsPromise = Promise.all(namespaces.map((ns) => getEpoch(ns, backend)));
	const rawPromise = withTimeout(backend.get(fullKey), holder.config.timeout, "read").catch(
		() => null,
	);
	const currentEpochs = await epochsPromise;
	const raw = await rawPromise;
	if (raw !== null) {
		const decoded = decode(raw);
		if (decoded !== undefined) {
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- value envelope written by this function
			const envelope = decoded as CacheEnvelope<T>;
			if (epochsMatch(envelope.e, currentEpochs)) {
				return envelope.v;
			}
		}
	}

	const value = await options.load();

	const cacheable = options.cacheable ? options.cacheable(value) : true;
	if (cacheable) {
		const ttl = options.ttl ?? holder.config.defaultTtl;
		after(async () => {
			try {
				const encoded = encode({ e: currentEpochs, v: value } satisfies CacheEnvelope<T>);
				await backend.set(fullKey, encoded, ttl);
			} catch (error) {
				if (import.meta.env?.DEV) {
					console.warn("[object-cache] set failed:", error);
				}
			}
		});
	}

	return value;
}

export async function isObjectCacheActive(): Promise<boolean> {
	const backend = await getBackend();
	return backend !== null && !shouldBypass();
}

function stampLastContentWrite(): void {
	const stamp = Math.max(lastContentWrite.value + 1, Date.now());
	lastContentWrite.value = stamp;
	lastContentWrite.at = stamp;
	lastContentWrite.promise = undefined;
	lastContentWrite.promiseAt = undefined;

	if (contentWritePersist.pending) return;
	contentWritePersist.pending = true;
	after(async () => {
		contentWritePersist.pending = false;
		try {
			const backend = await getBackend();
			if (!backend) return;
			const latest = lastContentWrite.value;
			await backend.set(lastContentWriteKey(), String(latest));
		} catch (error) {
			console.error("[object-cache] last-content-write stamp failed:", error);
		}
	});
}

export async function getLastContentWriteAt(): Promise<number> {
	const local = lastContentWrite.value;
	const now = Date.now();
	if (now - lastContentWrite.at < holder.config.revalidate) {
		return local;
	}

	const backend = await getBackend();
	if (!backend) return local;

	if (lastContentWrite.promise) {
		const age = now - (lastContentWrite.promiseAt ?? 0);
		const deadline = epochReadDeadline();
		if (age < deadline) {
			return raceInFlightEpochRead(lastContentWrite.promise, deadline - age, local);
		}
	}

	const promise = (async () => {
		let value: number;
		try {
			const raw = await withTimeout(
				backend.get(lastContentWriteKey()),
				holder.config.timeout,
				"last-content-write read",
			);
			const parsed = raw === null ? 0 : Number(raw);
			value = Number.isFinite(parsed) ? parsed : 0;
		} catch {
			value = lastContentWrite.value;
		}
		const merged = Math.max(value, lastContentWrite.value);
		lastContentWrite.value = merged;
		lastContentWrite.at = Date.now();
		lastContentWrite.promise = undefined;
		lastContentWrite.promiseAt = undefined;
		return merged;
	})();

	after(() =>
		promise.then(
			() => undefined,
			() => undefined,
		),
	);

	lastContentWrite.promise = promise;
	lastContentWrite.promiseAt = now;
	return promise;
}

export function invalidateObjectCache(namespace: string): void {
	const prev = epochCache.get(namespace)?.value ?? 0;
	const stamp = Math.max(prev + 1, Date.now());
	epochCache.set(namespace, { value: stamp, at: stamp });

	if (isContentNamespace(namespace)) {
		stampLastContentWrite();
	}

	if (pendingBumps.has(namespace)) return;
	pendingBumps.add(namespace);
	after(async () => {
		pendingBumps.delete(namespace);
		try {
			const backend = await getBackend();
			if (!backend) return;
			const latest = epochCache.get(namespace)?.value ?? stamp;
			await backend.set(epochKey(namespace), String(latest));
		} catch (error) {
			console.error("[object-cache] epoch bump failed for", namespace, error);
		}
	});
}
export const CacheNamespace = {
	SETTINGS: "settings",
	MENUS: "menus",
	TAXONOMIES: "taxonomies",
	BYLINES: "bylines",
	SCHEMA: "schema",
	COMMENTS: "comments",
} as const;

export function contentNamespace(collection: string): string {
	return `content:v2:${collection}`;
}

function legacyContentNamespace(collection: string): string {
	return `content:${collection}`;
}

export function contentCacheNamespaces(collection: string): readonly string[] {
	return [contentNamespace(collection), legacyContentNamespace(collection)];
}

export function contentNamespaces(collection: string): readonly string[] {
	return [...contentCacheNamespaces(collection), CacheNamespace.BYLINES, CacheNamespace.TAXONOMIES];
}

export function invalidateCollectionCache(collection: string): void {
	for (const namespace of contentCacheNamespaces(collection)) {
		invalidateObjectCache(namespace);
	}
}

export function invalidateTaxonomyObjectCache(): void {
	invalidateObjectCache(CacheNamespace.TAXONOMIES);
}

export function invalidateBylineObjectCache(): void {
	invalidateObjectCache(CacheNamespace.BYLINES);
}

export function invalidateMenuObjectCache(): void {
	invalidateObjectCache(CacheNamespace.MENUS);
}

export function invalidateSchemaObjectCache(): void {
	invalidateObjectCache(CacheNamespace.SCHEMA);
}

export function invalidateCommentObjectCache(): void {
	invalidateObjectCache(CacheNamespace.COMMENTS);
}

export type {
	ObjectCacheBackend,
	ObjectCacheDescriptor,
	ObjectCacheRuntimeConfig,
} from "./types.js";
