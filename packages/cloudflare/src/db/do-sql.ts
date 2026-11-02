import { env } from "cloudflare:workers";
import type { CollectionDeletionGuardInput, CollectionDeletionGuardResult } from "emdash";
import { kyselyLogOption, recordRpc } from "emdash/database/instrumentation";
import { type Dialect, Kysely } from "kysely";

import { CoalescingDOSqlDialect } from "./coalescing-do-sql.js";
import type { EmDashDB } from "./do-sql-class.js";
import { type BookmarkSink, DOSqlDialect } from "./do-sql-dialect.js";
import type { DurableObjectsConfig, EmDashDBStub } from "./do-sql-types.js";

const DEFAULT_NAME = "emdash";
const DEFAULT_BOOKMARK_COOKIE = "__em_do_bookmark";

const MAX_BOOKMARK_LENGTH = 1024;

function hasControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

function getNamespace(config: DurableObjectsConfig): DurableObjectNamespace<EmDashDB> | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object
	const ns = (env as Record<string, unknown>)[config.binding] as
		| DurableObjectNamespace<EmDashDB>
		| undefined;
	return ns ?? null;
}

function bindingError(binding: string): Error {
	return new Error(
		`Durable Object binding "${binding}" not found in environment. ` +
			`Check your wrangler.jsonc configuration:\n\n` +
			`"durable_objects": {\n` +
			`  "bindings": [{ "name": "${binding}", "class_name": "EmDashDB" }]\n` +
			`},\n` +
			`"migrations": [{ "tag": "v1", "new_sqlite_classes": ["EmDashDB"] }]\n\n` +
			`For read replication also set:\n` +
			`"compatibility_flags": ["experimental", "replica_routing"]`,
	);
}

export async function executeCollectionDeletionGuard(
	config: DurableObjectsConfig,
	input: CollectionDeletionGuardInput,
): Promise<CollectionDeletionGuardResult> {
	const ns = getNamespace(config);
	if (!ns) throw bindingError(config.binding);
	const id = ns.idFromName(config.name ?? DEFAULT_NAME);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Rpc type limitation with unknown row types
	const stub = ns.get(id) as unknown as EmDashDBStub;
	return stub.executeCollectionDeletionGuard(input);
}

const SINGLETON_BOOKMARK_SINKS_KEY = Symbol.for("emdash:do-singleton-bookmark-sinks");
const g = globalThis as Record<symbol, unknown>;
const singletonBookmarkSinks: Map<string, BookmarkSink> =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see core request-cache.ts)
	(g[SINGLETON_BOOKMARK_SINKS_KEY] as Map<string, BookmarkSink> | undefined) ??
	(() => {
		const m = new Map<string, BookmarkSink>();
		g[SINGLETON_BOOKMARK_SINKS_KEY] = m;
		return m;
	})();

function getSingletonBookmarkSink(config: DurableObjectsConfig): BookmarkSink {
	const key = `${config.binding}:${config.name ?? DEFAULT_NAME}`;
	let sink = singletonBookmarkSinks.get(key);
	if (!sink) {
		sink = {};
		singletonBookmarkSinks.set(key, sink);
	}
	return sink;
}

export function createDialect(config: DurableObjectsConfig): Dialect {
	const ns = getNamespace(config);
	if (!ns) throw bindingError(config.binding);
	const id = ns.idFromName(config.name ?? DEFAULT_NAME);
	return new DOSqlDialect({
		resolveStub: () => ns.get(id),
		bookmarkSink: getSingletonBookmarkSink(config),
		onRpc: recordRpc,
	});
}

export function createCoalescingDialect(config: DurableObjectsConfig): Dialect {
	const ns = getNamespace(config);
	if (!ns) throw bindingError(config.binding);
	const id = ns.idFromName(config.name ?? DEFAULT_NAME);
	return new CoalescingDOSqlDialect({
		resolveStub: () => ns.get(id),
		bookmarkSink: getSingletonBookmarkSink(config),
		onRpc: recordRpc,
	});
}

interface CookieJar {
	get(name: string): { value: string } | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
}

export interface RequestScopedDbOpts {
	config: DurableObjectsConfig;
	isAuthenticated: boolean;
	endedAuthenticated?: () => boolean;
	isWrite: boolean;
	cookies: CookieJar;
	url: URL;
}

export interface RequestScopedDb {
	db: Kysely<any>;
	commit: () => void;
}

export function createRequestScopedDb(opts: RequestScopedDbOpts): RequestScopedDb | null {
	const sessionEnabled = opts.config?.session === "auto";
	if (!sessionEnabled && !opts.isWrite) return null;
	const ns = getNamespace(opts.config);
	if (!ns) return null;

	const id = ns.idFromName(opts.config.name ?? DEFAULT_NAME);
	const cookieName = opts.config.bookmarkCookie ?? DEFAULT_BOOKMARK_COOKIE;

	let stub: EmDashDBStub | undefined;
	const resolveStub = (): EmDashDBStub => {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Rpc type limitation with unknown row types
		return (stub ??= ns.get(id) as unknown as EmDashDBStub);
	};

	let readBookmark: string | undefined;
	if (sessionEnabled && opts.isAuthenticated) {
		const bookmark = opts.cookies.get(cookieName)?.value;
		if (
			bookmark &&
			bookmark.length > 0 &&
			bookmark.length <= MAX_BOOKMARK_LENGTH &&
			!hasControlChars(bookmark)
		) {
			readBookmark = bookmark;
		}
	}

	const bookmarkSink: BookmarkSink = {};
	const dialectConfig = {
		resolveStub,
		readBookmark,
		bookmarkSink,
		onRpc: recordRpc,
		forcePrimary: opts.isWrite,
	};
	const db = new Kysely<any>({
		dialect: sessionEnabled
			? new CoalescingDOSqlDialect(dialectConfig)
			: new DOSqlDialect(dialectConfig),
		log: kyselyLogOption(),
	});

	return {
		db,
		commit() {
			if (!sessionEnabled || (!opts.isAuthenticated && !opts.endedAuthenticated?.())) return;
			const newBookmark = bookmarkSink.latest;
			if (!newBookmark) return;
			if (newBookmark.length > MAX_BOOKMARK_LENGTH) return;
			opts.cookies.set(cookieName, newBookmark, {
				path: "/",
				httpOnly: true,
				sameSite: "lax",
				secure: opts.url.protocol === "https:",
				maxAge: 60 * 60 * 24,
			});
		},
	};
}

export { EmDashDB } from "./do-sql-class.js";
