import { DurableObject } from "cloudflare:workers";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

const READ_PREFIXES = ["SELECT", "PRAGMA", "EXPLAIN", "WITH"];

export interface QueryResult {
	rows: Record<string, unknown>[];
	changes?: number;
}

export interface BatchStatement {
	sql: string;
	params?: unknown[];
}

interface Snapshot {
	tables: Record<string, Record<string, unknown>[]>;
	schema?: Record<
		string,
		{
			columns: string[];
			types?: Record<string, string>;
		}
	>;
	generatedAt: string;
}

export class EmDashPreviewDB extends DurableObject {
	query(sql: string, params?: unknown[]): QueryResult {
		const cursor = params?.length
			? this.ctx.storage.sql.exec(sql, ...params)
			: this.ctx.storage.sql.exec(sql);

		const rows: Record<string, unknown>[] = [];
		for (const row of cursor) {
			rows.push(row);
		}

		const isRead = READ_PREFIXES.some((p) => sql.trimStart().toUpperCase().startsWith(p));

		return {
			rows,
			changes: isRead ? undefined : cursor.rowsWritten,
		};
	}

	batch(statements: BatchStatement[]): void {
		this.ctx.storage.transactionSync(() => {
			for (const stmt of statements) {
				if (stmt.params?.length) {
					this.ctx.storage.sql.exec(stmt.sql, ...stmt.params);
				} else {
					this.ctx.storage.sql.exec(stmt.sql);
				}
			}
		});
	}

	invalidateSnapshot(): void {
		try {
			this.ctx.storage.sql.exec("DELETE FROM _emdash_do_meta WHERE key = 'snapshot_fetched_at'");
		} catch {}
	}

	getSnapshotMeta(): { generatedAt: string } | null {
		try {
			const row = this.ctx.storage.sql
				.exec("SELECT value FROM _emdash_do_meta WHERE key = 'snapshot_generated_at'")
				.one();
			const value = row.value;
			if (typeof value !== "string") return null;
			return { generatedAt: value };
		} catch {
			return null;
		}
	}

	async populateFromSnapshot(
		sourceUrl: string,
		signature: string,
		options?: { drafts?: boolean; ttl?: number },
	): Promise<{ generatedAt: string }> {
		const ttlMs = (options?.ttl ?? DEFAULT_TTL_MS / 1000) * 1000;

		try {
			const meta = this.ctx.storage.sql
				.exec("SELECT value FROM _emdash_do_meta WHERE key = 'snapshot_fetched_at'")
				.one();
			const fetchedAt = Number(meta.value);
			if (Date.now() - fetchedAt < ttlMs) {
				void this.ctx.storage.setAlarm(Date.now() + ttlMs);
				const gen = this.ctx.storage.sql
					.exec("SELECT value FROM _emdash_do_meta WHERE key = 'snapshot_generated_at'")
					.one();
				// eslint-disable-next-line typescript/no-base-to-string -- meta column stores a scalar timestamp value
				return { generatedAt: String(gen.value) };
			}
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("no such table")) {
				throw error;
			}
		}

		const url = `${sourceUrl}/_emdash/api/snapshot${options?.drafts ? "?drafts=true" : ""}`;
		const response = await fetch(url, {
			headers: { "X-Preview-Signature": signature },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(
				`Snapshot fetch failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ""}`,
			);
		}
		const snapshot: Snapshot = await response.json();

		this.ctx.storage.transactionSync(() => {
			this.dropAllTables();
			this.applySnapshot(snapshot);
		});

		void this.ctx.storage.setAlarm(Date.now() + ttlMs);

		return { generatedAt: snapshot.generatedAt };
	}

	setTtlAlarm(ttlSeconds: number): void {
		void this.ctx.storage.setAlarm(Date.now() + ttlSeconds * 1000);
	}

	override alarm(): void {
		this.dropAllTables();
	}

	private dropAllTables(): void {
		this.ctx.storage.sql.exec("PRAGMA foreign_keys = OFF");

		try {
			const tables = [
				...this.ctx.storage.sql.exec(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
				),
			];
			for (const row of tables) {
				// eslint-disable-next-line typescript/no-base-to-string -- sqlite_master.name is a scalar text column
				const name = String(row.name);
				if (!SAFE_IDENTIFIER.test(name)) {
					continue;
				}
				this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS "${name}"`);
			}
		} finally {
			this.ctx.storage.sql.exec("PRAGMA foreign_keys = ON");
		}
	}

	private applySnapshot(snapshot: Snapshot): void {
		const validateSnapshotIdentifier = (name: string, context: string) => {
			if (!SAFE_IDENTIFIER.test(name)) {
				throw new Error(`Invalid ${context} in snapshot: ${JSON.stringify(name)}`);
			}
		};

		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS _emdash_do_meta (key TEXT PRIMARY KEY, value TEXT)
		`);

		for (const [tableName, rows] of Object.entries(snapshot.tables)) {
			if (tableName === "_emdash_do_meta") continue;
			if (!rows.length) continue;

			validateSnapshotIdentifier(tableName, "table name");

			const schemaInfo = snapshot.schema?.[tableName];
			const columns = schemaInfo?.columns ?? Object.keys(rows[0]!);
			columns.forEach((c) => validateSnapshotIdentifier(c, `column name in ${tableName}`));

			const colDefs = columns
				.map((c) => {
					const colType = schemaInfo?.types?.[c] ?? "TEXT";
					const safeType = ["TEXT", "INTEGER", "REAL", "BLOB", "JSON"].includes(
						colType.toUpperCase(),
					)
						? colType.toUpperCase()
						: "TEXT";
					return `"${c}" ${safeType}`;
				})
				.join(", ");
			this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`);

			const placeholders = columns.map(() => "?").join(", ");
			const insertSql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;
			for (const row of rows) {
				const values = columns.map((c) => row[c] ?? null);
				this.ctx.storage.sql.exec(insertSql, ...values);
			}
		}

		this.ctx.storage.sql.exec(
			`INSERT OR REPLACE INTO _emdash_do_meta VALUES ('snapshot_fetched_at', ?), ('snapshot_generated_at', ?)`,
			String(Date.now()),
			snapshot.generatedAt,
		);
	}
}
