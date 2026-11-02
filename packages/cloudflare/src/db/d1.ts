import { env } from "cloudflare:workers";
import type { CollectionDeletionGuardInput, CollectionDeletionGuardResult } from "emdash";
import { kyselyLogOption } from "emdash/database/instrumentation";
import { type Dialect, Kysely } from "kysely";

import { CoalescingD1Dialect } from "./coalescing-d1.js";
import { EmDashD1Dialect, RawBindingD1Dialect } from "./d1-dialect.js";
import { createD1SessionGuard, type D1SessionGuard } from "./d1-session-guard.js";

interface D1Config {
	binding: string;
	session?: "disabled" | "auto" | "primary-first";
	bookmarkCookie?: string;
	coalesce?: boolean;
}

const DEFAULT_BOOKMARK_COOKIE = "__em_d1_bookmark";
const COLLECTION_SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;
const STALE_DELETION_GUARD_PATTERN =
	/not null constraint failed:\s*_emdash_media_usage_collection_deletions\.collection_id/i;

let warnedCoalesceNoRuntimeSession = false;

const SESSION_GUARD_KEY = Symbol.for("emdash:d1-session-guard");

function getSessionGuard(): D1SessionGuard {
	const g = globalThis as Record<symbol, unknown>;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see do-sql.ts)
	let guard = g[SESSION_GUARD_KEY] as D1SessionGuard | undefined;
	if (!guard) {
		guard = createD1SessionGuard();
		g[SESSION_GUARD_KEY] = guard;
	}
	return guard;
}

const MAX_BOOKMARK_LENGTH = 1024;

function hasControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

export function createDialect(config: D1Config): Dialect {
	const db = getBinding(config);
	if (!db) {
		const example = JSON.stringify(
			{
				d1_databases: [
					{
						binding: config.binding,
						database_name: "your-database-name",
						database_id: "your-database-id",
					},
				],
			},
			null,
			2,
		);
		throw new Error(
			`D1 binding "${config.binding}" not found in environment. ` +
				`Check your wrangler.jsonc configuration:\n\n${example}`,
		);
	}
	if (config.coalesce && !isSessionEnabled(config)) {
		console.warn(
			'[emdash] d1({ coalesce: true }) has no effect without sessions — set session: "auto" (or "primary-first") to enable query coalescing.',
		);
	}
	return new RawBindingD1Dialect({ database: db });
}

export function createCoalescingDialect(config: D1Config): Dialect {
	const db = getBinding(config);
	if (!db) {
		throw new Error(`D1 binding "${config.binding}" not found in environment.`);
	}
	return new CoalescingD1Dialect({ database: db });
}

interface CookieJar {
	get(name: string): { value: string } | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
}

export interface RequestScopedDbOpts {
	config: D1Config;
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

export async function executeCollectionDeletionGuard(
	config: D1Config,
	input: CollectionDeletionGuardInput,
): Promise<CollectionDeletionGuardResult> {
	assertCollectionDeletionInput(input);
	const binding = getBinding(config);
	if (!binding) throw new Error(`D1 binding "${config.binding}" not found in environment.`);
	return input.action === "fence"
		? executeFenceBatch(binding, input)
		: executeDropBatch(binding, input);
}

async function executeFenceBatch(
	binding: D1Database,
	input: Extract<CollectionDeletionGuardInput, { action: "fence" }>,
): Promise<CollectionDeletionGuardResult> {
	const tableName = `ec_${input.collectionSlug}`;
	const contentPredicate = input.forceDelete
		? ""
		: `AND NOT EXISTS (SELECT 1 FROM "${tableName}" WHERE deleted_at IS NULL LIMIT 1)`;
	const update = binding
		.prepare(`
			UPDATE _emdash_media_usage_index_status
			SET capture_state = 'deleting',
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
			WHERE adapter_id = 'content-media'
				AND scope_type = 'collection'
				AND scope_key = ?
				AND collection_id = ?
				AND capture_state = 'active'
				AND EXISTS (
					SELECT 1 FROM _emdash_collections
					WHERE id = ? AND slug = ?
				)
				AND EXISTS (
					SELECT 1 FROM _emdash_media_usage_collection_deletions
					WHERE collection_id = ?
						AND collection_slug = ?
						AND state = 'leased'
						AND phase = 'fence'
						AND lease_token = ?
						AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				)
				${contentPredicate}
			RETURNING collection_id
		`)
		.bind(
			input.collectionSlug,
			input.collectionId,
			input.collectionId,
			input.collectionSlug,
			input.collectionId,
			input.collectionSlug,
			input.leaseToken,
		);
	const diagnostic = binding
		.prepare(`
			SELECT CASE
				WHEN EXISTS (
					SELECT 1 FROM _emdash_media_usage_collection_deletions
					WHERE collection_id = ?
						AND collection_slug = ?
						AND state = 'leased'
						AND phase = 'fence'
						AND lease_token = ?
						AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
				)
				AND EXISTS (
					SELECT 1 FROM _emdash_media_usage_index_status
					WHERE adapter_id = 'content-media'
						AND scope_type = 'collection'
						AND scope_key = ?
						AND collection_id = ?
						AND capture_state = 'active'
				)
				AND EXISTS (SELECT 1 FROM "${tableName}" WHERE deleted_at IS NULL LIMIT 1)
				THEN 'has_content'
				ELSE 'stale'
			END AS outcome
		`)
		.bind(
			input.collectionId,
			input.collectionSlug,
			input.leaseToken,
			input.collectionSlug,
			input.collectionId,
		);
	if (input.forceDelete) {
		const updated = await update.all<{ collection_id: string }>();
		return updated.results.length > 0 ? { outcome: "fenced" } : { outcome: "stale" };
	}
	const [updated, observed] = await binding.batch<{ collection_id: string } | { outcome: string }>([
		update,
		diagnostic,
	]);
	if (updated?.results.length) return { outcome: "fenced" };
	const diagnosticRow = observed?.results[0];
	return diagnosticRow && "outcome" in diagnosticRow && diagnosticRow.outcome === "has_content"
		? { outcome: "has_content" }
		: { outcome: "stale" };
}

async function executeDropBatch(
	binding: D1Database,
	input: Extract<CollectionDeletionGuardInput, { action: "drop" }>,
): Promise<CollectionDeletionGuardResult> {
	const contentTable = `ec_${input.collectionSlug}`;
	const ftsTable = `_emdash_fts_${input.collectionSlug}`;
	const guardId = `__emdash_guard:${input.collectionId}:${input.leaseToken}`;
	const guardSlug = `__emdash_guard_slug:${input.collectionId}:${input.leaseToken}`;
	try {
		await binding.batch([
			binding
				.prepare(`
					INSERT INTO _emdash_media_usage_collection_deletions (
						collection_id, collection_slug, force_delete, state, phase,
						next_attempt_at, lease_token, lease_expires_at
					)
					VALUES (
						(
							SELECT ?
							FROM _emdash_media_usage_collection_deletions
							WHERE collection_id = ?
								AND collection_slug = ?
								AND state = 'leased'
								AND phase = 'table'
								AND lease_token = ?
								AND lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
						),
						?, 0, 'leased', 'table',
						strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?,
						strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 minute')
					)
				`)
				.bind(
					guardId,
					input.collectionId,
					input.collectionSlug,
					input.leaseToken,
					guardSlug,
					input.leaseToken,
				),
			binding.prepare(`DROP TRIGGER IF EXISTS "${ftsTable}_insert"`),
			binding.prepare(`DROP TRIGGER IF EXISTS "${ftsTable}_update"`),
			binding.prepare(`DROP TRIGGER IF EXISTS "${ftsTable}_delete"`),
			binding.prepare(`DROP TABLE IF EXISTS "${ftsTable}"`),
			binding.prepare(`DROP TABLE IF EXISTS "${contentTable}"`),
			binding
				.prepare(
					"DELETE FROM _emdash_media_usage_collection_deletions WHERE collection_id = ? AND collection_slug = ?",
				)
				.bind(guardId, guardSlug),
		]);
	} catch (error) {
		if (STALE_DELETION_GUARD_PATTERN.test(deepErrorMessage(error))) {
			return { outcome: "stale" };
		}
		throw error;
	}
	return { outcome: "dropped" };
}

function assertCollectionDeletionInput(input: CollectionDeletionGuardInput): void {
	if (!input.collectionId || !input.leaseToken) {
		throw new Error("Collection deletion guard requires a collection ID and lease token");
	}
	if (!COLLECTION_SLUG_PATTERN.test(input.collectionSlug) || input.collectionSlug.length > 63) {
		throw new Error("Collection deletion guard requires a valid collection slug");
	}
}

function deepErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.cause ? `${error.message}: ${deepErrorMessage(error.cause)}` : error.message;
	}
	return String(error);
}

export function createRequestScopedDb(opts: RequestScopedDbOpts): RequestScopedDb | null {
	if (!isSessionEnabled(opts.config)) return null;
	const sessionGuard = getSessionGuard();
	if (sessionGuard.isBroken()) return null;
	const binding = getBinding(opts.config);
	if (!binding || typeof binding.withSession !== "function") {
		if (opts.config.coalesce && binding && !warnedCoalesceNoRuntimeSession) {
			warnedCoalesceNoRuntimeSession = true;
			console.warn(
				"[emdash] d1({ coalesce: true }) has no effect: the D1 binding does not support sessions (withSession() is unavailable at runtime). Query coalescing requires D1 sessions.",
			);
		}
		return null;
	}

	const cookieName = opts.config.bookmarkCookie ?? DEFAULT_BOOKMARK_COOKIE;
	const configConstraint =
		opts.config.session === "primary-first" ? "first-primary" : "first-unconstrained";

	let constraint: string = configConstraint;
	if (opts.isWrite) {
		constraint = "first-primary";
	} else if (opts.isAuthenticated) {
		const bookmark = opts.cookies.get(cookieName)?.value;
		if (
			bookmark &&
			bookmark.length > 0 &&
			bookmark.length <= MAX_BOOKMARK_LENGTH &&
			!hasControlChars(bookmark)
		) {
			constraint = bookmark;
		}
	}

	const session = binding.withSession(constraint);
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- session is structurally compatible with the subset D1Dialect uses
	const sessionAsDatabase = sessionGuard.wrap(session as unknown as D1Database, binding);
	const dialect = opts.config.coalesce
		? new CoalescingD1Dialect({ database: sessionAsDatabase })
		: new EmDashD1Dialect({ database: sessionAsDatabase });
	const db = new Kysely<any>({
		dialect,
		log: kyselyLogOption(),
	});

	return {
		db,
		commit() {
			if (!opts.isAuthenticated && !opts.endedAuthenticated?.()) return;
			const newBookmark = session.getBookmark?.();
			if (!newBookmark) return;
			opts.cookies.set(cookieName, newBookmark, {
				path: "/",
				httpOnly: true,
				sameSite: "lax",
				secure: opts.url.protocol === "https:",
			});
		},
	};
}

function isSessionEnabled(config: D1Config): boolean {
	return !!config.session && config.session !== "disabled";
}

function getBinding(config: D1Config): D1Database | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object
	const db = (env as Record<string, unknown>)[config.binding] as D1Database | undefined;
	return db ?? null;
}
