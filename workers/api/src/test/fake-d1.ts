type D1Op = 'first' | 'all' | 'run';

export type FakeD1Call = {
  op: D1Op;
  sql: string;
  rawSql: string;
  args: unknown[];
};

type FakeD1Handler = (call: FakeD1Call) => unknown | Promise<unknown>;

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function createFakeD1(handler: FakeD1Handler): D1Database & { calls: FakeD1Call[] } {
  const calls: FakeD1Call[] = [];

  const execute = async (op: D1Op, rawSql: string, args: unknown[]) => {
    const call = { op, rawSql, sql: normalizeSql(rawSql), args };
    calls.push(call);
    const value = await handler(call);
    if (value === undefined) {
      throw new Error(`Unhandled fake D1 ${op}: ${call.sql} :: ${JSON.stringify(args)}`);
    }
    if (op === 'all') {
      return Array.isArray(value) ? { results: value } : value;
    }
    if (op === 'run') {
      return value === true ? { success: true, meta: { changes: 1 } } : value;
    }
    return value;
  };

  const db = {
    calls,
    prepare(rawSql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: () => execute('first', rawSql, args),
            all: () => execute('all', rawSql, args),
            run: () => execute('run', rawSql, args),
          };
        },
        first: () => execute('first', rawSql, []),
        all: () => execute('all', rawSql, []),
        run: () => execute('run', rawSql, []),
      };
    },
  };

  return db as D1Database & { calls: FakeD1Call[] };
}
