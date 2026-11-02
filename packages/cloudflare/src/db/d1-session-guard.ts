const SESSION_HANG_TIMEOUT_MS = 5_000;

const SELECT_PATTERN = /^select\b/i;

type SessionHealth = "unknown" | "healthy" | "broken";

interface StatementMeta {
	statement: D1PreparedStatement;
	sql: string;
	params: unknown[];
}

type RaceOutcome<T> = { timedOut: false; value: T } | { timedOut: true };

async function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<RaceOutcome<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then((value) => ({ timedOut: false as const, value })),
			new Promise<RaceOutcome<T>>((resolve) => {
				timer = setTimeout(resolve, ms, { timedOut: true });
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export interface D1SessionGuard {
	isBroken(): boolean;
	wrap(session: D1Database, fallback: D1Database): D1Database;
}

export function createD1SessionGuard(timeoutMs: number = SESSION_HANG_TIMEOUT_MS): D1SessionGuard {
	let health: SessionHealth = "unknown";
	const statementMeta = new WeakMap<D1PreparedStatement, StatementMeta>();

	function markBroken(): void {
		if (health === "broken") return;
		health = "broken";
		console.error(
			`[emdash] A D1 session query hung for ${timeoutMs}ms without settling. ` +
				"D1 read replica sessions appear to be broken in this environment — " +
				"falling back to the direct D1 binding and disabling sessions for the " +
				"rest of this isolate's life. Likely cause: the " +
				"`global_fetch_strictly_public` compatibility flag blocks the D1 " +
				"Sessions API (https://github.com/emdash-cms/emdash/issues/1273). " +
				'Remove the flag or set `d1({ session: "disabled" })` to silence this.',
		);
	}

	function markHealthy(): void {
		if (health === "unknown") health = "healthy";
	}

	function rejectAbandonedWrite(): never {
		throw new Error(
			`D1 session query hung for ${timeoutMs}ms and was abandoned. ` +
				"Refusing to re-run a non-SELECT statement on the direct binding " +
				"(the hung call might still complete, which would execute the " +
				"write twice). Retry the request — D1 sessions are now disabled " +
				"for this isolate.",
		);
	}

	async function guardedExec<T>(
		meta: StatementMeta,
		fallback: D1Database,
		run: (statement: D1PreparedStatement) => Promise<T>,
	): Promise<T> {
		if (health === "healthy") return run(meta.statement);
		if (health === "broken") {
			if (!SELECT_PATTERN.test(meta.sql.trim())) rejectAbandonedWrite();
			return run(fallback.prepare(meta.sql).bind(...meta.params));
		}
		const sessionCall = run(meta.statement);
		let outcome: RaceOutcome<T>;
		try {
			outcome = await raceTimeout(sessionCall, timeoutMs);
		} catch (error) {
			markHealthy();
			throw error;
		}
		if (!outcome.timedOut) {
			markHealthy();
			return outcome.value;
		}
		markBroken();
		sessionCall.catch(() => undefined);
		if (!SELECT_PATTERN.test(meta.sql.trim())) rejectAbandonedWrite();
		return run(fallback.prepare(meta.sql).bind(...meta.params));
	}

	function wrapStatement(meta: StatementMeta, fallback: D1Database): D1PreparedStatement {
		const wrapped = {
			bind(...params: unknown[]): D1PreparedStatement {
				return wrapStatement(
					{ statement: meta.statement.bind(...params), sql: meta.sql, params },
					fallback,
				);
			},
			all<T>(): Promise<D1Result<T>> {
				return guardedExec(meta, fallback, (statement) => statement.all<T>());
			},
			raw<T>(options?: { columnNames?: boolean }): Promise<T[]> {
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- mirrors the D1PreparedStatement.raw overloads, which the generic passthrough can't express
				return guardedExec(meta, fallback, (statement) =>
					// eslint-disable-next-line typescript/no-unsafe-type-assertion -- same: `raw({ columnNames })`'s boolean option only exists via the overload pair
					statement.raw(options as { columnNames: true }),
				) as Promise<T[]>;
			},
			first<T>(colName?: string): Promise<T | null> {
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- mirrors the D1PreparedStatement.first overloads, which the generic passthrough can't express
				return guardedExec(meta, fallback, (statement) =>
					colName === undefined ? statement.first<T>() : statement.first(colName),
				) as Promise<T | null>;
			},
			run<T>(): Promise<D1Result<T>> {
				return guardedExec(meta, fallback, (statement) => statement.run<T>());
			},
		};
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- structurally covers every D1PreparedStatement member the dialects use
		const statement = wrapped as unknown as D1PreparedStatement;
		statementMeta.set(statement, meta);
		return statement;
	}

	function wrap(session: D1Database, fallback: D1Database): D1Database {
		const wrapped = {
			prepare(sql: string): D1PreparedStatement {
				return wrapStatement({ statement: session.prepare(sql), sql, params: [] }, fallback);
			},
			async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
				const metas = statements.map(
					(statement) =>
						statementMeta.get(statement) ?? { statement, sql: "", params: [] as unknown[] },
				);
				function fallbackBatch(): Promise<D1Result<T>[]> {
					if (!metas.every((meta) => SELECT_PATTERN.test(meta.sql.trim()))) {
						throw new Error(
							`D1 session batch hung for ${timeoutMs}ms and was abandoned. ` +
								"Refusing to re-run it on the direct binding because it " +
								"contains non-SELECT statements. Retry the request — D1 " +
								"sessions are now disabled for this isolate.",
						);
					}
					return fallback.batch<T>(
						metas.map((meta) => fallback.prepare(meta.sql).bind(...meta.params)),
					);
				}
				const sessionStatements = metas.map((meta) => meta.statement);
				if (health === "healthy") return session.batch<T>(sessionStatements);
				if (health === "broken") return fallbackBatch();
				const sessionCall = session.batch<T>(sessionStatements);
				let outcome: RaceOutcome<D1Result<T>[]>;
				try {
					outcome = await raceTimeout(sessionCall, timeoutMs);
				} catch (error) {
					markHealthy();
					throw error;
				}
				if (!outcome.timedOut) {
					markHealthy();
					return outcome.value;
				}
				markBroken();
				sessionCall.catch(() => undefined);
				return fallbackBatch();
			},
		};
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- structurally covers every D1Database member the dialects use (prepare/batch)
		return wrapped as unknown as D1Database;
	}

	return {
		isBroken: () => health === "broken",
		wrap,
	};
}
