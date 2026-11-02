import { randomUUID } from "node:crypto";

import type { SqliteDialectConfig } from "kysely";
import { Kysely, SqliteAdapter, SqliteDialect } from "kysely";
import { Pool } from "pg";
import { describe } from "vitest";

import {
	getExactMigrationStatus,
	getMigrationStatus,
	runMigrations,
} from "../../../../../packages/core/src/database/migrations/runner.js";
import type {
	ExactMigrationStatus,
	MigrationStatus,
} from "../../../../../packages/core/src/database/migrations/runner.js";
import { FailFastPostgresDialect } from "../../../../../packages/core/src/database/pg-migration-lock.js";
import type { Database as DatabaseSchema } from "../../../../../packages/core/src/database/types.js";
import { openNodeSqliteDatabase } from "../../../../../packages/core/src/db/node-sqlite-compat.js";
import { waitForDeferredTasks } from "../../../../../packages/core/src/deferred-tasks.js";
import { SchemaRegistry } from "../../../../../packages/core/src/schema/registry.js";
import { resetTaxonomyDefsCacheForTests } from "../../../../../packages/core/src/taxonomies/index.js";

function resetSchemaCachesForTests(): void {
	resetTaxonomyDefsCacheForTests();
}

export const PG_CONNECTION_STRING = process.env.EMDASH_TEST_PG ?? "";

export const hasPgTestDatabase = PG_CONNECTION_STRING.length > 0;

export function createTestDatabase(): Kysely<DatabaseSchema> {
	resetSchemaCachesForTests();
	const sqlite = openNodeSqliteDatabase(":memory:");

	return new Kysely<DatabaseSchema>({
		dialect: new SqliteDialect({
			database: sqlite,
		}),
	});
}

export async function setupTestDatabase(): Promise<Kysely<DatabaseSchema>> {
	const db = createTestDatabase();
	await runMigrations(db);
	return db;
}

export async function setupTestDatabaseWithCollections(): Promise<Kysely<DatabaseSchema>> {
	const db = await setupTestDatabase();
	const registry = new SchemaRegistry(db);

	await registry.createCollection({
		slug: "post",
		label: "Posts",
		labelSingular: "Post",
	});
	await registry.createField("post", {
		slug: "title",
		label: "Title",
		type: "string",
	});
	await registry.createField("post", {
		slug: "content",
		label: "Content",
		type: "portableText",
	});

	await registry.createCollection({
		slug: "page",
		label: "Pages",
		labelSingular: "Page",
	});
	await registry.createField("page", {
		slug: "title",
		label: "Title",
		type: "string",
	});
	await registry.createField("page", {
		slug: "content",
		label: "Content",
		type: "portableText",
	});

	return db;
}

export async function teardownTestDatabase(db: Kysely<DatabaseSchema>): Promise<void> {
	await waitForDeferredTasks();
	await db.destroy();
}

export const D1_COMPOUND_SELECT_LIMIT = 5;

class LimitedCompoundSelectAdapter extends SqliteAdapter {
	constructor(readonly compoundSelectLimit: number) {
		super();
	}
}

class LimitedCompoundSelectDialect extends SqliteDialect {
	readonly #limit: number;

	constructor(config: SqliteDialectConfig, limit: number) {
		super(config);
		this.#limit = limit;
	}

	override createAdapter(): SqliteAdapter {
		return new LimitedCompoundSelectAdapter(this.#limit);
	}
}

export interface CompoundSelectTestDatabase {
	db: Kysely<DatabaseSchema>;
	statements: string[];
}

export async function setupTestDatabaseWithCompoundSelectLimit(
	limit: number | null = D1_COMPOUND_SELECT_LIMIT,
): Promise<CompoundSelectTestDatabase> {
	resetSchemaCachesForTests();
	const sqlite = openNodeSqliteDatabase(":memory:");
	const statements: string[] = [];
	const prepare = sqlite.prepare.bind(sqlite);
	sqlite.prepare = ((source: string) => {
		statements.push(source);
		const terms = source.split(/\b(?:UNION|INTERSECT|EXCEPT)\b/i).length;
		if (limit !== null && terms > limit) {
			throw new Error("too many terms in compound SELECT: SQLITE_ERROR");
		}
		return prepare(source);
	}) as typeof sqlite.prepare;

	const config = { database: sqlite };
	const dialect =
		limit === null ? new SqliteDialect(config) : new LimitedCompoundSelectDialect(config, limit);
	const db = new Kysely<DatabaseSchema>({ dialect });
	await runMigrations(db);
	return { db, statements };
}

function assertSafeIdentifier(id: string): void {
	if (!/^[a-z][a-z0-9_]*$/.test(id) || id.length > 63) {
		throw new Error(`Unsafe SQL identifier: ${id}`);
	}
}

function workerDatabaseName(): string {
	const raw = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);
	const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_");
	const name = `emdash_test_w_${slug}`;
	assertSafeIdentifier(name);
	return name;
}

function withDatabase(connectionString: string, database: string): string {
	const url = new URL(connectionString);
	url.pathname = `/${database}`;
	return url.toString();
}

let workerConnPromise: Promise<string> | null = null;
function getWorkerConnectionString(): Promise<string> {
	if (!workerConnPromise) {
		workerConnPromise = (async () => {
			const dbName = workerDatabaseName();
			const admin = new Pool({ connectionString: PG_CONNECTION_STRING, max: 1 });
			try {
				const { rows } = await admin.query<{ exists: number }>(
					"SELECT 1 AS exists FROM pg_database WHERE datname = $1",
					[dbName],
				);
				if (rows.length === 0) {
					await createDatabaseWithRetry(admin, dbName);
				}
			} finally {
				await admin.end();
			}
			return withDatabase(PG_CONNECTION_STRING, dbName);
		})();
	}
	return workerConnPromise;
}

async function createDatabaseWithRetry(admin: Pool, dbName: string): Promise<void> {
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			await admin.query(`CREATE DATABASE ${dbName}`);
			return;
		} catch (error) {
			const msg = String(error instanceof Error ? error.message : error);
			if (/already exists|duplicate_database/i.test(msg)) return;
			if (attempt < 9 && /being accessed by other users/i.test(msg)) {
				await new Promise((resolve) => setTimeout(resolve, 50 + attempt * 50));
				continue;
			}
			throw error;
		}
	}
}

let sharedPool: Pool | null = null;

async function getSharedPool(): Promise<Pool> {
	if (!sharedPool) {
		const connectionString = await getWorkerConnectionString();
		sharedPool = new Pool({ connectionString, max: 10 });
	}
	return sharedPool;
}

let schemaCounter = 0;
function uniqueSchemaName(): string {
	const seq = (schemaCounter++).toString(36);
	const rand = randomUUID().replace(/-/g, "").slice(0, 12);
	return `test_${seq}_${rand}`;
}

export interface PgTestContext {
	db: Kysely<DatabaseSchema>;
	schemaName: string;
}

export async function createTestPostgresDatabase(): Promise<PgTestContext> {
	resetSchemaCachesForTests();
	const connectionString = await getWorkerConnectionString();
	const pool = await getSharedPool();
	const schemaName = uniqueSchemaName();

	const client = await pool.connect();
	try {
		await client.query(`CREATE SCHEMA ${schemaName}`);
	} finally {
		client.release();
	}

	const testPool = new Pool({
		connectionString,
		max: 5,
		options: `-c search_path=${schemaName},public`,
	});

	const db = new Kysely<DatabaseSchema>({
		dialect: new FailFastPostgresDialect({ pool: testPool }),
	});

	return { db, schemaName };
}

export async function setupTestPostgresDatabase(): Promise<PgTestContext> {
	const ctx = await createTestPostgresDatabase();
	await runMigrations(ctx.db, { migrationTableSchema: ctx.schemaName });
	return ctx;
}

export async function setupTestPostgresDatabaseWithCollections(): Promise<PgTestContext> {
	const ctx = await setupTestPostgresDatabase();
	const registry = new SchemaRegistry(ctx.db);

	await registry.createCollection({
		slug: "post",
		label: "Posts",
		labelSingular: "Post",
	});
	await registry.createField("post", {
		slug: "title",
		label: "Title",
		type: "string",
	});
	await registry.createField("post", {
		slug: "content",
		label: "Content",
		type: "portableText",
	});

	await registry.createCollection({
		slug: "page",
		label: "Pages",
		labelSingular: "Page",
	});
	await registry.createField("page", {
		slug: "title",
		label: "Title",
		type: "string",
	});
	await registry.createField("page", {
		slug: "content",
		label: "Content",
		type: "portableText",
	});

	return ctx;
}

export async function teardownTestPostgresDatabase(ctx: PgTestContext): Promise<void> {
	await waitForDeferredTasks();
	await ctx.db.destroy();

	const pool = await getSharedPool();
	const client = await pool.connect();
	try {
		await client.query(`DROP SCHEMA IF EXISTS ${ctx.schemaName} CASCADE`);
	} finally {
		client.release();
	}
}

export async function destroySharedPool(): Promise<void> {
	if (sharedPool) {
		await sharedPool.end();
		sharedPool = null;
	}
}

export type DialectName = "sqlite" | "postgres";

export interface DialectTestContext {
	db: Kysely<DatabaseSchema>;
	dialect: DialectName;
	pgCtx?: PgTestContext;
}

export async function createForDialect(dialect: DialectName): Promise<DialectTestContext> {
	if (dialect === "postgres") {
		const pgCtx = await createTestPostgresDatabase();
		return { db: pgCtx.db, dialect, pgCtx };
	}
	const db = createTestDatabase();
	return { db, dialect };
}

export async function setupForDialect(dialect: DialectName): Promise<DialectTestContext> {
	if (dialect === "postgres") {
		const pgCtx = await setupTestDatabase_pg();
		return { db: pgCtx.db, dialect, pgCtx };
	}
	const db = await setupTestDatabase();
	return { db, dialect };
}

export async function setupForDialectWithCollections(
	dialect: DialectName,
): Promise<DialectTestContext> {
	if (dialect === "postgres") {
		const pgCtx = await setupTestPostgresDatabaseWithCollections();
		return { db: pgCtx.db, dialect, pgCtx };
	}
	const db = await setupTestDatabaseWithCollections();
	return { db, dialect };
}

export async function teardownForDialect(ctx: DialectTestContext | undefined): Promise<void> {
	if (!ctx) return;
	if (ctx.pgCtx) {
		await teardownTestPostgresDatabase(ctx.pgCtx);
	} else {
		await teardownTestDatabase(ctx.db);
	}
}

export function runMigrationsForDialect(ctx: DialectTestContext): Promise<{ applied: string[] }> {
	return runMigrations(ctx.db, { migrationTableSchema: ctx.pgCtx?.schemaName });
}

export function getMigrationStatusForDialect(ctx: DialectTestContext): Promise<MigrationStatus> {
	return getMigrationStatus(ctx.db, { migrationTableSchema: ctx.pgCtx?.schemaName });
}

export function getExactMigrationStatusForDialect(
	ctx: DialectTestContext,
): Promise<ExactMigrationStatus> {
	return getExactMigrationStatus(ctx.db, { migrationTableSchema: ctx.pgCtx?.schemaName });
}

const setupTestDatabase_pg = setupTestPostgresDatabase;

export function describeEachDialect(name: string, fn: (dialect: DialectName) => void): void {
	const dialects: DialectName[] = ["sqlite"];
	if (hasPgTestDatabase) {
		dialects.push("postgres");
	}

	for (const dialect of dialects) {
		describe(`${name} [${dialect}]`, () => {
			fn(dialect);
		});
	}
}
