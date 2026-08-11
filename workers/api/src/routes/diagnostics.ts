import { Hono, type Context } from 'hono';
import { Env } from '../types';
import { timingSafeEqual } from '../lib/secrets';
import { readJsonObjectLimited } from '@superboard/contracts/request-body';

const diagnostics = new Hono<{ Bindings: Env }>();

async function params(c: any): Promise<Record<string, any>> {
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  if (c.req.method === 'GET') return query;
  const body = await readJsonObjectLimited(c.req.raw, 1024 * 1024);
  return { ...query, ...body };
}

type DiagnosticsContext = Context<{ Bindings: Env }>;

async function authError(c: DiagnosticsContext): Promise<Response | null> {
  const expected = c.env.DIAGNOSTICS_API_KEY;
  const provided = c.req.header('x-diagnostics-key')
    || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !provided || !await timingSafeEqual(provided, expected)) {
    return c.json({ error: 'Unauthorized', message: 'Invalid or missing API key' }, 401);
  }
  return null;
}

async function withAuth(c: DiagnosticsContext, handler: () => Promise<Response> | Response) {
  const denied = await authError(c);
  if (denied) return denied;
  return handler();
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function nowIso() {
  return new Date().toISOString();
}

function logAt(level: string, payload: unknown) {
  const text = JSON.stringify(payload);
  if (level === 'debug') console.debug(text);
  else if (level === 'warn' || level === 'warning') console.warn(text);
  else if (level === 'error' || level === 'fatal') console.error(text);
  else console.log(text);
}

async function recordDiagnosticLog(c: any, level: string, operation: string, message: string, payload: unknown, durationMs = 0) {
  await c.env.DB.prepare(`
    INSERT INTO diagnostics_logs (level, source, message, context, operation, payload, test_key, hostname, duration_ms)
    VALUES (?, 'worker', ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    level,
    message,
    JSON.stringify(payload),
    operation,
    JSON.stringify(payload),
    (payload as any)?.test_id || (payload as any)?.test_key || null,
    'cloudflare-worker',
    durationMs,
  ).run().catch((error: unknown) => {
    console.error(JSON.stringify({
      event: 'diagnostics_log_insert_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

async function timed<T>(errors: any[], operation: string, fn: () => Promise<T>): Promise<number | null> {
  const start = performance.now();
  try {
    await fn();
    return Math.round((performance.now() - start) * 100) / 100;
  } catch (error: any) {
    errors.push({ operation, error: error?.message || String(error) });
    return null;
  }
}

async function testLogs(c: any) {
  const body = await params(c);
  const level = String(body.level || 'info').toLowerCase();
  const message = String(body.message || 'Test log message');
  const count = clampNumber(body.count, 1, 1, 100);
  const logs = [];

  for (let i = 0; i < count; i += 1) {
    const payload = {
      test_id: crypto.randomUUID(),
      message: `${message} (${i + 1}/${count})`,
      hostname: 'cloudflare-worker',
      process_type: 'worker',
      environment: c.env.ENVIRONMENT || 'production',
      timestamp: nowIso(),
      request_ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
      iteration: i + 1,
    };
    logAt(level, payload);
    await recordDiagnosticLog(c, level, 'test_logs', payload.message, payload);
    logs.push(payload);
  }

  return c.json({
    status: 'ok',
    logs_generated: count,
    level,
    hostname: 'cloudflare-worker',
    process_type: 'worker',
    environment: c.env.ENVIRONMENT || 'production',
    logs,
  });
}

async function testDiagnostics(c: any) {
  const body = await params(c);
  const iterations = clampNumber(body.iterations, 10, 1, 100);
  const includeSlow = body.include_slow === true || body.include_slow === 'true';
  const cleanup = body.cleanup !== false && body.cleanup !== 'false';
  const testRunKey = `diag_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const started = performance.now();
  const d1Errors: any[] = [];
  const kvErrors: any[] = [];
  const d1Operations = [];
  const kvOperations = [];
  let created = 0;

  for (let i = 0; i < iterations; i += 1) {
    const testKey = `${testRunKey}_${i}`;
    const row: Record<string, number | null> = {};
    row.select_1 = await timed(d1Errors, 'select_1', async () => {
      await c.env.DB.prepare('SELECT 1 AS test').first();
    });
    row.count_users = await timed(d1Errors, 'count_users', async () => {
      await c.env.DB.prepare('SELECT COUNT(*) AS total FROM users').first();
    });
    row.insert = await timed(d1Errors, 'insert', async () => {
      await c.env.DB.prepare(`
        INSERT INTO diagnostics_logs (level, source, message, context, operation, payload, test_key, hostname, duration_ms)
        VALUES ('info', 'diagnostics', ?, '{}', 'insert', ?, ?, 'cloudflare-worker', 0)
      `).bind(`diagnostics ${testKey}`, JSON.stringify({ iteration: i, timestamp: nowIso() }), testKey).run();
      created += 1;
    });
    row.select_by_key = await timed(d1Errors, 'select_by_key', async () => {
      await c.env.DB.prepare('SELECT id FROM diagnostics_logs WHERE test_key = ? LIMIT 1').bind(testKey).first();
    });
    row.update = await timed(d1Errors, 'update', async () => {
      await c.env.DB.prepare('UPDATE diagnostics_logs SET operation = ?, duration_ms = ?, updated_at = datetime("now") WHERE test_key = ?')
        .bind('updated', row.insert || 0, testKey).run();
    });
    if (includeSlow && i === 0) {
      row.slow_query = await timed(d1Errors, 'slow_query', async () => {
        await c.env.DB.prepare('SELECT COUNT(*) AS total FROM events e1 LEFT JOIN events e2 ON e2.project_id = e1.project_id').first();
      });
    }
    d1Operations.push(row);

    const kvKey = `diagnostics:test:${testRunKey}:${i}`;
    const kvRow: Record<string, number | null> = {};
    kvRow.put = await timed(kvErrors, 'put', async () => {
      await c.env.KV.put(kvKey, JSON.stringify({ iteration: i, timestamp: nowIso() }), { expirationTtl: 60 });
    });
    kvRow.get = await timed(kvErrors, 'get', async () => {
      await c.env.KV.get(kvKey);
    });
    kvRow.delete = await timed(kvErrors, 'delete', async () => {
      await c.env.KV.delete(kvKey);
    });
    kvOperations.push(kvRow);
  }

  let deleted = 0;
  if (cleanup) {
    const cleanupResult = await c.env.DB.prepare('DELETE FROM diagnostics_logs WHERE test_key LIKE ?')
      .bind(`${testRunKey}%`).run();
    deleted = cleanupResult.meta?.changes || 0;
  }

  const totalMs = Math.round((performance.now() - started) * 100) / 100;
  const results = {
    timestamp: nowIso(),
    hostname: 'cloudflare-worker',
    environment: c.env.ENVIRONMENT || 'production',
    iterations,
    d1: {
      operations: d1Operations,
      total_ms: totalMs,
      errors: d1Errors,
      records_created: created,
      records_deleted: deleted,
    },
    kv: {
      operations: kvOperations,
      errors: kvErrors,
    },
    summary: {
      d1: {
        total_ms: totalMs,
        avg_ms_per_iteration: Math.round((totalMs / iterations) * 100) / 100,
        records_created: created,
        records_deleted: deleted,
        errors: d1Errors.length,
      },
      kv: {
        errors: kvErrors.length,
      },
      status: d1Errors.length === 0 && kvErrors.length === 0 ? 'healthy' : 'degraded',
    },
  };
  console.log(JSON.stringify({ event: 'diagnostics_test', summary: results.summary }));
  return c.json(results);
}

async function testException(c: any): Promise<Response> {
  const body = await params(c);
  const type = String(body.type || 'standard');
  const message = String(body.message || 'Test exception from diagnostics');
  console.error(JSON.stringify({ event: 'diagnostics_test_exception', type, message, timestamp: nowIso() }));
  if (type === 'argument') throw new TypeError(message);
  if (type === 'runtime') throw new Error(message);
  throw new Error(message);
}

diagnostics.get('/test_logs', (c) => withAuth(c, () => testLogs(c)));
diagnostics.post('/test_logs', (c) => withAuth(c, () => testLogs(c)));
diagnostics.get('/test_diagnostics', (c) => withAuth(c, () => testDiagnostics(c)));
diagnostics.post('/test_diagnostics', (c) => withAuth(c, () => testDiagnostics(c)));
diagnostics.get('/test_exception', (c) => withAuth(c, () => testException(c)));
diagnostics.post('/test_exception', (c) => withAuth(c, () => testException(c)));

export default diagnostics;
