import type { Kysely } from "kysely";
import { sql } from "kysely";

import { apiError } from "../api/error.js";
import type { Database } from "../database/types.js";

const IP_PATTERN = /^[\da-fA-F.:]+$/;

export interface RateLimitResult {
	allowed: boolean;
	count: number;
	limit: number;
}

export async function checkRateLimit(
	db: Kysely<Database>,
	ip: string | null,
	endpoint: string,
	maxRequests: number,
	windowSeconds: number,
): Promise<RateLimitResult> {
	if (!ip) {
		return { allowed: true, count: 0, limit: maxRequests };
	}

	const windowStart = new Date(
		Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000,
	).toISOString();
	const key = `${ip}:${endpoint}`;

	const result = await sql<{ count: number }>`
		INSERT INTO _emdash_rate_limits (key, "window", count)
		VALUES (${key}, ${windowStart}, 1)
		ON CONFLICT (key, "window")
		DO UPDATE SET count = _emdash_rate_limits.count + 1
		RETURNING count
	`.execute(db);

	const count = result.rows[0]?.count ?? 1;

	if (Math.random() < 0.01) {
		cleanupExpiredRateLimits(db).catch(() => {});
	}

	return {
		allowed: count <= maxRequests,
		count,
		limit: maxRequests,
	};
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
	const response = apiError("RATE_LIMITED", "Too many requests. Please try again later.", 429);
	response.headers.set("Retry-After", String(retryAfterSeconds));
	return response;
}

export function getClientIp(request: Request, trustedHeaders: string[] = []): string | null {
	const headers = request.headers;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- CF Workers runtime shape
	const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;

	if (cf) {
		const cfIp = headers.get("cf-connecting-ip")?.trim();
		if (cfIp && IP_PATTERN.test(cfIp)) {
			return cfIp;
		}

		const xff = headers.get("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first && IP_PATTERN.test(first)) {
				return first;
			}
		}
	}

	for (const name of trustedHeaders) {
		const value = readIpFromHeader(headers, name);
		if (value) return value;
	}

	return null;
}

function readIpFromHeader(headers: Headers, name: string): string | null {
	const value = headers.get(name);
	if (!value) return null;
	if (name.toLowerCase().endsWith("forwarded-for")) {
		const first = value.split(",")[0]?.trim();
		if (!first) return null;
		return IP_PATTERN.test(first) ? first : null;
	}
	const trimmed = value.trim();
	if (!trimmed) return null;
	return IP_PATTERN.test(trimmed) ? trimmed : null;
}

export async function cleanupExpiredRateLimits(
	db: Kysely<Database>,
	maxAgeSeconds = 3600,
): Promise<number> {
	const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();

	const result = await sql`
		DELETE FROM _emdash_rate_limits WHERE "window" < ${cutoff}
	`.execute(db);

	return Number(result.numAffectedRows ?? 0);
}
