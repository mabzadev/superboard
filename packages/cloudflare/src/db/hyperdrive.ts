import { env, waitUntil } from "cloudflare:workers";
import { kyselyLogOption } from "emdash/database/instrumentation";
import { FailFastPostgresDialect } from "emdash/database/pg-migration-lock";
import { type Dialect, Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

interface HyperdriveConfig {
	binding: string;
	max?: number;
	cachedBinding?: string;
	preferUncachedAfterWriteMs?: number;
}

const DEFAULT_PREFER_UNCACHED_AFTER_WRITE_MS = 60_000;

interface HyperdriveBinding {
	connectionString: string;
}

const DEFAULT_MAX = 5;

function createPool(connectionString: string, max: number): Pool {
	return new Pool({
		connectionString,
		max,
		idleTimeoutMillis: 0,
	});
}

export function createDialect(config: HyperdriveConfig): Dialect {
	const binding = requireBinding(config);
	return new FailFastPostgresDialect({ pool: createPool(binding.connectionString, 1) });
}

interface CookieJar {
	get(name: string): { value: string } | undefined;
	set(name: string, value: string, options: Record<string, unknown>): void;
}

export interface RequestScopedDbOpts {
	config: HyperdriveConfig;
	isAuthenticated: boolean;
	isWrite: boolean;
	canUseCachedBinding?: boolean;
	cookies: CookieJar;
	url: URL;
	lastContentWriteAt?: number;
	now?: number;
}

export interface RequestScopedDb {
	db: Kysely<any>;
	commit: () => void;
	close: () => void;
}

export function createRequestScopedDb(opts: RequestScopedDbOpts): RequestScopedDb | null {
	const bindingName = selectBindingName(opts.config, {
		isAuthenticated: opts.isAuthenticated,
		isWrite: opts.isWrite,
		canUseCachedBinding: opts.canUseCachedBinding,
		url: opts.url,
		lastContentWriteAt: opts.lastContentWriteAt,
		now: opts.now ?? Date.now(),
	});
	let binding = getBinding(bindingName);
	if (!binding?.connectionString && bindingName !== opts.config.binding) {
		binding = getBinding(opts.config.binding);
	}
	if (!binding?.connectionString) return null;

	const pool = createPool(binding.connectionString, opts.config.max ?? DEFAULT_MAX);
	const db = new Kysely<any>({
		dialect: new PostgresDialect({ pool }),
		log: kyselyLogOption(),
	});

	let closed = false;
	return {
		db,
		commit() {},
		close() {
			if (closed) return;
			closed = true;
			waitUntil(
				db.destroy().catch((error: unknown) => {
					console.error("[emdash][hyperdrive] failed to close request pool:", error);
				}),
			);
		},
	};
}

const EMDASH_BASE_PATH = "/_emdash";

function isEmDashInternalPath(url: URL): boolean {
	return url.pathname === EMDASH_BASE_PATH || url.pathname.startsWith(`${EMDASH_BASE_PATH}/`);
}

function preferUncachedDurationMs(config: HyperdriveConfig): number {
	if (config.preferUncachedAfterWriteMs !== undefined) {
		return config.preferUncachedAfterWriteMs;
	}
	return config.cachedBinding ? DEFAULT_PREFER_UNCACHED_AFTER_WRITE_MS : 0;
}

export function selectBindingName(
	config: HyperdriveConfig,
	opts: {
		isAuthenticated: boolean;
		isWrite: boolean;
		canUseCachedBinding?: boolean;
		url: URL;
		lastContentWriteAt?: number;
		now?: number;
	},
): string {
	if (
		config.cachedBinding &&
		(opts.canUseCachedBinding ??
			(!opts.isAuthenticated && !opts.isWrite && !isEmDashInternalPath(opts.url)))
	) {
		const duration = preferUncachedDurationMs(config);
		const lastWrite = opts.lastContentWriteAt ?? 0;
		const now = opts.now ?? Date.now();
		if (duration > 0 && lastWrite > 0 && now - lastWrite < duration) {
			return config.binding;
		}
		return config.cachedBinding;
	}
	return config.binding;
}

function getBinding(bindingName: string): HyperdriveBinding | null {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Worker binding accessed from untyped env object
	const binding = (env as Record<string, unknown>)[bindingName] as HyperdriveBinding | undefined;
	return binding ?? null;
}

function requireBinding(config: HyperdriveConfig): HyperdriveBinding {
	const binding = getBinding(config.binding);
	if (!binding) {
		const example = JSON.stringify(
			{ hyperdrive: [{ binding: config.binding, id: "<your-hyperdrive-id-here>" }] },
			null,
			2,
		);
		throw new Error(
			`Hyperdrive binding "${config.binding}" not found in environment. ` +
				`Check your wrangler.jsonc configuration:\n\n${example}\n\n` +
				`Hyperdrive also requires compatibility_flags: ["nodejs_compat"] and ` +
				`compatibility_date >= "2024-09-23".`,
		);
	}
	if (!binding.connectionString) {
		throw new Error(
			`Hyperdrive binding "${config.binding}" is present but has no connectionString. ` +
				`Ensure the binding points at a valid Hyperdrive configuration.`,
		);
	}
	return binding;
}
