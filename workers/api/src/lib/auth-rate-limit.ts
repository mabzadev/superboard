import type { Env } from "../types";
import { tokenDigest } from "./token-storage";

export type AuthRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function consumeDashboardAuthAttempt(
  env: Env,
  request: Request,
  scope: string,
  subject: unknown,
  maximumAttempts = 10,
): Promise<AuthRateLimitResult> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const normalizedSubject = String(subject || "unknown").trim().toLowerCase().slice(0, 320);
  const keyHash = await tokenDigest(`${scope}:${ip}:${normalizedSubject}`);
  const maximum = Math.max(1, Math.min(100, Math.floor(maximumAttempts)));
  const row = await env.DB.prepare(`
    INSERT INTO dashboard_auth_rate_limits
      (key_hash, window_started_at, attempt_count, updated_at)
    VALUES (?, datetime('now'), 1, datetime('now'))
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN datetime(window_started_at) < datetime('now', '-10 minutes')
          THEN datetime('now') ELSE window_started_at END,
      attempt_count = CASE
        WHEN datetime(window_started_at) < datetime('now', '-10 minutes')
          THEN 1 ELSE attempt_count + 1 END,
      updated_at = datetime('now')
    RETURNING attempt_count
  `).bind(keyHash).first<{ attempt_count: number }>();
  const attempts = Number(row?.attempt_count || maximum + 1);
  return { allowed: attempts <= maximum, retryAfterSeconds: 600 };
}

export function dashboardAuthRateLimitResponse(result: AuthRateLimitResult): Response {
  return Response.json(
    { error: "rate_limited", message: "Too many authentication attempts" },
    {
      status: 429,
      headers: {
        "retry-after": String(result.retryAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}

export async function cleanupDashboardAuthRateLimits(db: D1Database): Promise<number> {
  const result = await db.prepare(`
    DELETE FROM dashboard_auth_rate_limits
    WHERE datetime(window_started_at) < datetime('now', '-1 day')
  `).run();
  return Number(result.meta?.changes || 0);
}
